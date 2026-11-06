/**
 * 本地解锁模块统一入口
 *
 * 全部音源在端侧完成检索与取链：
 * - 网易云按歌曲 ID 直取直链；
 * - 酷我 / 波点 / 歌曲宝按「歌名 - 歌手」关键词寻址；
 * - 咪咕 / 长青聚合 / 落雪音源 / 星海音源 / 小鱼音源 / 吉祥音源按
 *   「歌名 + 歌手 + 时长」目标信息寻址，可选携带平台内主键直查。
 *
 * 目标信息构造与关键词拼回的口径与 xiaoxiongmusic-server/unblock 的路由层保持一致。
 */
import { SongUnlockServer } from "@/types/shared";
import { gateSearchResult } from "./duration-gate";
import type { SongUrlResult } from "./types";
import getKuwoSongUrl from "./kuwo";
import getBodianSongUrl from "./bodian";
import getGequbaoSongUrl from "./gequbao";
import getNeteaseSongUrl from "./netease";
import getMiguSongUrl from "./migu";
import getChangqingSongUrl from "./changqing";
import getLxmusicSongUrl from "./lxmusic";
import getXinghaiSongUrl from "./xinghai";
import getFishSongUrl from "./fish";
import getJiexiangSongUrl from "./jiexiang";
import { parseDurationParam, parseKeyword, buildTarget, type MatchTarget } from "./match";
import { unblockLog } from "./http";

/**
 * 换源寻址上下文
 *
 * 部分音源按「歌名 + 歌手 + 时长」三重校验候选，
 * 并对按平台内 id 寻址的源支持直查，故这些上下文需要一并传入。
 */
export interface UnlockRequestContext {
    /** 歌曲声明时长（秒） */
    duration?: number;
    /** 歌曲来源平台（netease / qqmusic / kugou） */
    platform?: string;
    /** 平台内歌曲主键（QQ mid / 酷狗 hash / 网易云歌曲 id） */
    platformId?: string;
}

/**
 * 构造匹配目标信息
 *
 * 口径与服务端路由层一致：请求显式带歌名 / 歌手时优先取显式值，
 * 否则按关键词拆分（按最后一个「-」切分并 trim）。
 * 歌手只认显式传入的值：只给歌名时，仅当关键词整体就是「歌名-歌手」形式
 * （拆出的歌名与显式歌名完全一致）才沿用关键词里的歌手，否则按缺歌手处理。
 * @param keyword 搜索关键词（形如「歌名-歌手」）
 * @param songName 歌曲名（显式值，优先于关键词拆分）
 * @param artist 歌手名（显式值，优先于关键词拆分）
 * @param duration 歌曲声明时长（秒），可选
 * @returns 匹配目标信息
 */
export const buildMatchTarget = (
    keyword: string,
    songName: string,
    artist: string,
    duration?: number | string,
): MatchTarget => {
    const trimmedKeyword = (keyword || "").trim();
    const parsedDuration = parseDurationParam(duration);
    const trimmedSongName = (songName || "").trim();
    const trimmedArtist = (artist || "").trim();
    if (!trimmedSongName && !trimmedArtist) {
        return buildTarget(trimmedKeyword, parsedDuration);
    }
    const parsed = parseKeyword(trimmedKeyword);
    if (trimmedArtist) {
        return { title: trimmedSongName || parsed.title, artist: trimmedArtist, duration: parsedDuration };
    }
    const keywordArtist = parsed.title === trimmedSongName ? parsed.artist : "";
    return { title: trimmedSongName, artist: keywordArtist, duration: parsedDuration };
};

/**
 * 把目标信息拼回「歌名 - 歌手」关键词
 *
 * 酷我 / 波点 / 歌曲宝三个换源模块的入参仍是关键词（内部按最后一个「-」切分），
 * 歌手名自身含「-」时切分会错位，故把歌手名中的「-」统一替换为空格；
 * 匹配侧的归一化会剥离分隔符，判定结果与原名一致。
 *
 * 缺歌手时歌名里的「-」同样会被下游当成「歌名-歌手」的分隔符，
 * 凭空拆出一个歌手并据此放行（会匹配到同名不同版本的曲目），
 * 故缺歌手且歌名含「-」时补一个不带歌手的「-」：
 * 下游切分出的后半段为空，歌手仍为空，按缺歌手拒绝而不是按拆出来的歌手放行。
 * @param target 目标歌曲信息
 * @returns 关键词
 */
export const formatKeyword = (target: MatchTarget): string => {
    const artist = target.artist.replace(/-/g, " ");
    if (artist) return `${target.title} - ${artist}`;
    return target.title.includes("-") ? `${target.title} -` : target.title;
};

/** 第三方平台歌曲误用网易云直查时的拒绝文案（A-05 铁律） */
export const NETEASE_ID_SPACE_REASON = "第三方平台歌曲不支持按 ID 直查网易云";

/**
 * 需要胜者终审的检索类源及其日志名
 *
 * 这些源的校验只比对候选元数据时长；长青/落雪源内已有真实音频时长闸门，
 * 直查类源按平台 ID 寻址天然同曲，均不需要终审。
 */
const DURATION_GATE_SOURCES: Partial<Record<SongUnlockServer, string>> = {
    [SongUnlockServer.KUWO]: "酷我",
    [SongUnlockServer.BODIAN]: "波点",
    [SongUnlockServer.GEQUBAO]: "歌曲宝",
    [SongUnlockServer.MIGU]: "咪咕",
};

/**
 * 本地解锁歌曲 URL
 * @param id 歌曲 ID（网易云使用）
 * @param songName 歌曲名（用于匹配验证）
 * @param artist 歌手名（用于匹配验证）
 * @param server 解锁服务器类型
 * @param context 换源寻址上下文（时长 / 平台 / 平台内 id）
 * @returns 解锁结果（成功时携带直链体积校验标记 lengthVerified）
 */
export async function localUnlockSongUrl(
    id: number,
    songName: string,
    artist: string,
    server: SongUnlockServer,
    context?: UnlockRequestContext
): Promise<SongUrlResult> {
    // 构建 keyword 用于搜索
    const keyword = `${songName}-${artist}`;
    unblockLog.log(`🔓 本地解锁开始: server=${server}, id=${id}, songName=${songName}, artist=${artist}, keyword=${keyword}`);

    try {
        const target = buildMatchTarget(keyword, songName, artist, context?.duration);
        const platformOptions = {
            platform: context?.platform,
            platformId: context?.platformId,
        };
        let result: SongUrlResult;

        switch (server) {
            case SongUnlockServer.NETEASE:
                // A-05 铁律纵深防御：第三方平台歌曲 ID 与网易云不在同一编号空间，
                // 平台明确非网易云时不得拿该 ID 直查网易云，宁可失败也不播错歌。
                if (context?.platform && context.platform !== "netease") {
                    unblockLog.warn(
                        `⚠️ 已拦截跨平台网易云直查: platform=${context.platform}, id=${id}`
                    );
                    result = { code: 404, url: null, reason: NETEASE_ID_SPACE_REASON };
                    break;
                }
                result = await getNeteaseSongUrl(id);
                break;
            case SongUnlockServer.KUWO:
                result = await getKuwoSongUrl(formatKeyword(target), target.duration);
                break;
            case SongUnlockServer.BODIAN:
                result = await getBodianSongUrl(formatKeyword(target), target.duration);
                break;
            case SongUnlockServer.GEQUBAO:
                result = await getGequbaoSongUrl(formatKeyword(target), target.duration);
                break;
            case SongUnlockServer.MIGU:
                result = await getMiguSongUrl(target);
                break;
            case SongUnlockServer.CHANGQING:
                result = await getChangqingSongUrl(target, platformOptions);
                break;
            case SongUnlockServer.LXMUSIC:
                result = await getLxmusicSongUrl(target, platformOptions);
                break;
            case SongUnlockServer.XINGHAI:
                result = await getXinghaiSongUrl(target, platformOptions);
                break;
            case SongUnlockServer.FISH:
                result = await getFishSongUrl(target, platformOptions);
                break;
            case SongUnlockServer.JIEXIANG:
                result = await getJiexiangSongUrl(target, platformOptions);
                break;
            default:
                unblockLog.warn(`⚠️ 未知的解锁服务器类型: ${server}`);
                result = { code: 404, url: null };
        }

        // 检索类源胜者终审：候选元数据时长进入灰区时读直链真实音频时长复核，
        // 疑似同名异版则改判失败，交由竞速编排让位次胜者
        // （长青/落雪源内已有真实音频时长闸门，不重复终审）。
        if (DURATION_GATE_SOURCES[server]) {
            result = await gateSearchResult(result, target.duration, DURATION_GATE_SOURCES[server]);
        }

        // 详细日志输出
        unblockLog.log(`🔓 本地解锁结果: server=${server}, code=${result.code}, url=${result.url ? result.url.substring(0, 100) : 'null'}`);
        unblockLog.log(`🔓 完整结果: ${JSON.stringify(result)}`);
        return result;
    } catch (error) {
        unblockLog.error(`❌ 本地解锁异常: server=${server}`, error);
        unblockLog.error(`❌ 错误详情: ${JSON.stringify(error)}`);
        return { code: 404, url: null };
    }
}

// 导出类型和子模块
export type { SongUrlResult } from "./types";
export { unblockLog } from "./http";
