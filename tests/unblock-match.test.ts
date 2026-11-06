/**
 * 三重校验打分纯函数单测 (unblock/match.ts)
 *
 * 覆盖四块判据：
 * 1. 阈值常量与失败原因文案：与服务端 unblock/match.ts 逐字一致；
 * 2. 文本归一化与相似度：HTML 实体解码、繁简转换、括号剥离、版本变体折半、
 *    主/副歌手分档、时长容差与接近度；
 * 3. 三重校验与排序：权重合成、通过条件（含时长 0 分拦截）、排序稳定性、最优候选选取；
 * 4. 入参解析与体积口径：keyword 拆分、时长参数解析、体积估算与占位/残缺文件判定文案。
 *
 * 被测模块为零依赖纯函数，无需 DOM 桩，不发起任何网络请求。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    TITLE_SCORE_LIMIT,
    MISSING_TITLE_REASON,
    MISSING_ARTIST_REASON,
    UPSTREAM_UNAVAILABLE_REASON,
    NO_CANDIDATE_REASON,
    MATCH_FAILED_REASON,
    FETCH_FAILED_REASON,
    TRIAL_ONLY_REASON,
    normalizeText,
    extractEmbeddedText,
    titleSimilarity,
    artistSimilarity,
    durationTolerance,
    durationSimilarity,
    scoreCandidate,
    rankCandidates,
    pickBestCandidate,
    parseKeyword,
    parseDurationParam,
    buildTarget,
    expectedAudioBytes,
    isPlausibleAudioLength,
    type MatchCandidate,
} from "../src/utils/unblock/match";

describe("阈值常量与失败原因文案", () => {
    it("歌名相似度下限为 0.75", () => {
        assert.equal(TITLE_SCORE_LIMIT, 0.75);
    });

    it("失败原因文案与服务端逐字一致", () => {
        assert.equal(MISSING_TITLE_REASON, "缺少歌名信息，无法安全换源");
        assert.equal(MISSING_ARTIST_REASON, "缺少歌手信息，无法安全换源");
        assert.equal(UPSTREAM_UNAVAILABLE_REASON, "上游检索服务不可用");
        assert.equal(NO_CANDIDATE_REASON, "该源未检索到候选歌曲");
        assert.equal(MATCH_FAILED_REASON, "候选未通过歌名/歌手/时长校验");
        assert.equal(FETCH_FAILED_REASON, "候选未取到可用直链");
        assert.equal(TRIAL_ONLY_REASON, "该曲在此源仅提供试听片段，无完整版权资源");
    });
});

describe("文本归一化 normalizeText", () => {
    it("解码 HTML 实体并去除标点空白、转小写", () => {
        assert.equal(normalizeText("Hello! World?"), "helloworld");
        assert.equal(normalizeText("A&amp;B"), "ab");
        assert.equal(normalizeText("It&#039;s&quot;ok&quot;"), "itsok");
    });

    it("繁体转简体后与简体形态一致", () => {
        assert.equal(normalizeText("朋友們"), normalizeText("朋友们"));
        assert.equal(normalizeText("髮如雪"), "发如雪");
        assert.equal(normalizeText("春嬌與志明"), "春娇与志明");
    });

    it("空值安全", () => {
        assert.equal(normalizeText(""), "");
        assert.equal(normalizeText(null as unknown as string), "");
    });
});

describe("剩余文本提取 extractEmbeddedText", () => {
    it("候选歌名内嵌请求歌名时返回剩余文本", () => {
        assert.equal(
            extractEmbeddedText("春娇与志明", "春娇与志明 街道办GDC / 欧阳耀莹"),
            "街道办gdc欧阳耀莹"
        );
    });

    it("候选歌名不含请求歌名时返回空串", () => {
        assert.equal(extractEmbeddedText("晴天", "夜曲"), "");
    });
});

describe("歌名相似度 titleSimilarity", () => {
    it("完全一致得 1", () => {
        assert.equal(titleSimilarity("晴天", "晴天"), 1);
    });

    it("繁简差异不拉低相似度", () => {
        assert.equal(titleSimilarity("发如雪", "髮如雪"), 1);
    });

    it("候选内嵌歌手时按子串分给满分", () => {
        assert.equal(titleSimilarity("春娇与志明", "春娇与志明：街道办GDC、欧阳耀莹"), 1);
    });

    it("命中版本变体标记时折半", () => {
        assert.equal(titleSimilarity("晴天", "晴天 (Live)"), 0.5);
        assert.equal(titleSimilarity("晴天", "晴天（DJ版）"), 0.5);
        assert.equal(titleSimilarity("青花瓷", "青花瓷（伴奏）"), 0.5);
    });

    it("请求侧含同一标记时不折半（同一版本的发行说明不算变体）", () => {
        assert.equal(titleSimilarity("晴天 (Live)", "晴天 (Live)"), 1);
    });

    it("同名不同歌相似度低于阈值", () => {
        assert.ok(titleSimilarity("晴天", "夜曲") < TITLE_SCORE_LIMIT);
    });
});

describe("歌手相似度 artistSimilarity", () => {
    it("请求侧无歌手返回 0（不放行）", () => {
        assert.equal(artistSimilarity("", "周杰伦"), 0);
    });

    it("候选侧无歌手返回 0", () => {
        assert.equal(artistSimilarity("周杰伦", ""), 0);
    });

    it("主歌手命中给满分", () => {
        assert.equal(artistSimilarity("周杰伦", "周杰伦"), 1);
        assert.equal(artistSimilarity("周杰伦", "周杰伦、费玉清"), 1);
    });

    it("副歌手单独命中的分值低于歌手阈值", () => {
        const secondary = artistSimilarity("周深", "蛋ZAI、周深");
        assert.ok(secondary > 0);
        assert.ok(secondary <= 0.4);
        assert.ok(secondary < 0.5);
    });

    it("无关歌手按 Jaccard 压低", () => {
        assert.equal(artistSimilarity("周杰伦", "张学友"), 0);
    });
});

describe("时长容差与接近度", () => {
    it("容差取 max(8 秒, 6%)", () => {
        assert.equal(durationTolerance(100), 8);
        assert.equal(durationTolerance(50), 8);
        assert.equal(durationTolerance(200), 12);
    });

    it("缺时长或非法时长不参与校验（返回 null）", () => {
        assert.equal(durationSimilarity(undefined, undefined), null);
        assert.equal(durationSimilarity(100, undefined), null);
        assert.equal(durationSimilarity(undefined, 100), null);
        assert.equal(durationSimilarity(0, 100), null);
        assert.equal(durationSimilarity(100, 0), null);
        assert.equal(durationSimilarity(-5, 100), null);
    });

    it("容差内线性计分，超出容差记 0 分", () => {
        assert.equal(durationSimilarity(200, 200), 1);
        assert.equal(durationSimilarity(206, 200), 0.5);
        assert.equal(durationSimilarity(212, 200), 0);
        assert.equal(durationSimilarity(213, 200), 0);
        assert.equal(durationSimilarity(188, 200), 0);
    });
});

describe("三重校验 scoreCandidate / rankCandidates / pickBestCandidate", () => {
    const target = { title: "晴天", artist: "周杰伦", duration: 200 };

    it("权重合成为 0.45 歌名 + 0.35 歌手 + 0.2 时长", () => {
        const detail = scoreCandidate(
            { id: "1", title: "晴天", artist: "周杰伦、费玉清", duration: 206 },
            target
        );
        assert.equal(detail.titleScore, 1);
        assert.equal(detail.artistScore, 1);
        assert.equal(detail.durationScore, 0.5);
        assert.ok(Math.abs(detail.score - (0.45 + 0.35 + 0.2 * 0.5)) < 1e-9);
        assert.equal(detail.passed, true);
    });

    it("候选缺时长时按时长满分合成且不拦截", () => {
        const detail = scoreCandidate({ id: "1", title: "晴天", artist: "周杰伦" }, target);
        assert.equal(detail.durationScore, null);
        assert.ok(Math.abs(detail.score - 1) < 1e-9);
        assert.equal(detail.passed, true);
    });

    it("时长超出容差记 0 分并拦截通过", () => {
        const detail = scoreCandidate(
            { id: "1", title: "晴天", artist: "周杰伦", duration: 224 },
            target
        );
        assert.equal(detail.durationScore, 0);
        assert.equal(detail.passed, false);
    });

    it("版本变体歌名折半后被歌名阈值拦截", () => {
        const detail = scoreCandidate({ id: "1", title: "晴天 (Live)", artist: "周杰伦" }, target);
        assert.equal(detail.titleScore, 0.5);
        assert.equal(detail.passed, false);
    });

    it("排序：通过的优先，其次综合得分降序，同分保持检索顺序", () => {
        const candidates: MatchCandidate[] = [
            { id: "a", title: "晴天", artist: "周杰伦", duration: 224 },
            { id: "b", title: "夜曲", artist: "周杰伦", duration: 200 },
            { id: "c", title: "晴天", artist: "周杰伦", duration: 200 },
            { id: "d", title: "晴天", artist: "周杰伦", duration: 202 },
        ];
        const ranked = rankCandidates(candidates, target);
        assert.deepEqual(
            ranked.map((item) => item.candidate.id),
            ["c", "d", "a", "b"]
        );
        assert.deepEqual(ranked.map((item) => item.passed), [true, true, false, false]);
    });

    it("pickBestCandidate 取首个通过校验的候选，无通过时返回 null", () => {
        assert.equal(pickBestCandidate(
            [
                { id: "a", title: "夜曲", artist: "周杰伦", duration: 200 },
                { id: "b", title: "晴天", artist: "周杰伦", duration: 200 },
            ],
            target
        )?.id, "b");
        assert.equal(pickBestCandidate(
            [{ id: "a", title: "夜曲", artist: "张学友", duration: 200 }],
            target
        ), null);
    });
});

describe("入参解析 parseKeyword / parseDurationParam / buildTarget", () => {
    it("按最后一个「-」拆出歌名与歌手", () => {
        assert.deepEqual(parseKeyword("晴天-周杰伦"), { title: "晴天", artist: "周杰伦" });
        assert.deepEqual(parseKeyword("晴天 - 周杰伦"), { title: "晴天", artist: "周杰伦" });
        assert.deepEqual(parseKeyword("A-B-C"), { title: "A-B", artist: "C" });
    });

    it("无分隔符时歌手为空", () => {
        assert.deepEqual(parseKeyword("晴天"), { title: "晴天", artist: "" });
        assert.deepEqual(parseKeyword("-晴天"), { title: "-晴天", artist: "" });
        assert.deepEqual(parseKeyword(""), { title: "", artist: "" });
    });

    it("时长参数解析接受正数字符串与数字，其余返回 undefined", () => {
        assert.equal(parseDurationParam("269"), 269);
        assert.equal(parseDurationParam(269.4), 269.4);
        assert.equal(parseDurationParam(""), undefined);
        assert.equal(parseDurationParam("abc"), undefined);
        assert.equal(parseDurationParam(0), undefined);
        assert.equal(parseDurationParam(-5), undefined);
        assert.equal(parseDurationParam(undefined), undefined);
    });

    it("buildTarget 组装请求侧目标信息", () => {
        assert.deepEqual(buildTarget("晴天-周杰伦", 269), {
            title: "晴天",
            artist: "周杰伦",
            duration: 269,
        });
        assert.deepEqual(buildTarget("晴天-周杰伦", parseDurationParam("abc")), {
            title: "晴天",
            artist: "周杰伦",
            duration: undefined,
        });
    });
});

describe("体积估算与占位/残缺判定 expectedAudioBytes / isPlausibleAudioLength", () => {
    it("按「时长 × 码率」估算字节数", () => {
        assert.equal(expectedAudioBytes(240, 128), 3840000);
        assert.equal(expectedAudioBytes(240, 320), 9600000);
    });

    it("长度未知时不等同于校验通过", () => {
        assert.deepEqual(isPlausibleAudioLength(null, 240, 128), {
            ok: true,
            verified: false,
            reason: "长度探测失败，未能完成体积校验",
        });
    });

    it("候选缺时长且请求为长曲目时按占位特征与字节下限拦截", () => {
        assert.deepEqual(isPlausibleAudioLength(185336, undefined, 128, 300), {
            ok: false,
            verified: true,
            reason: "体积 185336B 命中占位文件特征（≤190000B）",
        });
        assert.deepEqual(isPlausibleAudioLength(300000, undefined, 128, 300), {
            ok: true,
            verified: true,
            reason: "候选无时长，已按字节下限校验",
        });
    });

    it("候选与请求均无时长时标记未完成校验", () => {
        assert.deepEqual(isPlausibleAudioLength(300000, undefined, 128, undefined), {
            ok: true,
            verified: false,
            reason: "候选与请求均无时长，无法完成体积校验",
        });
        assert.deepEqual(isPlausibleAudioLength(100000, undefined, 128, 30), {
            ok: true,
            verified: false,
            reason: "候选与请求均无时长，无法完成体积校验",
        });
    });

    it("体积明显小于最低码率预期时拦截", () => {
        assert.deepEqual(isPlausibleAudioLength(100000, 240, 128), {
            ok: false,
            verified: true,
            reason: "体积 100000B 明显小于 240s@32k 的预期 960000B",
        });
    });

    it("命中占位特征优先按占位文案拦截", () => {
        assert.deepEqual(isPlausibleAudioLength(150000, 60, 128), {
            ok: false,
            verified: true,
            reason: "体积 150000B 命中占位文件特征（≤190000B）",
        });
    });

    it("体积符合预期时通过且无备注", () => {
        assert.deepEqual(isPlausibleAudioLength(3840000, 240, 128), {
            ok: true,
            verified: true,
            reason: "",
        });
    });
});
