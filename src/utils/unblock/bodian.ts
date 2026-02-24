/**
 * 波点音乐解锁
 * 移植自 SPlayer/server/unblock/bodian.ts
 */
import md5 from "md5";
import { unblockGet, unblockPost, unblockLog } from "./http";
import type { SongUrlResult } from "./types";

/**
 * 生成随机设备 ID
 */
const getRandomDeviceId = () => {
    const min = 0;
    const max = 100000000000;
    const randomNum = Math.floor(Math.random() * (max - min + 1)) + min;
    return randomNum.toString();
};

const deviceId = getRandomDeviceId();

interface SongInfo {
    MUSICRID: string;
    SONGNAME: string;
    DURATION: number;
    ALBUMID: string;
    ALBUM: string;
    ARTIST: string;
    ARTISTID: string;
}

const format = (song: SongInfo) => ({
    id: song.MUSICRID.split("_").pop(),
    name: song.SONGNAME,
    duration: song.DURATION * 1000,
    album: { id: song.ALBUMID, name: song.ALBUM },
    artists: song.ARTIST.split("&").map((name: string, index: number) => ({
        id: index ? null : song.ARTISTID,
        name,
    })),
});

/**
 * 生成签名
 */
const generateSign = (str: string) => {
    const url = new URL(str);
    const currentTime = Date.now();
    str += `&timestamp=${currentTime}`;
    const filteredChars = str
        .substring(str.indexOf("?") + 1)
        .replace(/[^a-zA-Z0-9]/g, "")
        .split("")
        .sort();
    const dataToEncrypt = `kuwotest${filteredChars.join("")}${url.pathname}`;
    const hash = md5(dataToEncrypt);
    return `${str}&sign=${hash}`;
};

/**
 * 搜索歌曲
 */
const search = async (info: string): Promise<string | null> => {
    try {
        const keyword = encodeURIComponent(info.replace(" - ", " "));
        const url =
            "http://search.kuwo.cn/r.s?&correct=1&vipver=1&stype=comprehensive&encoding=utf8" +
            "&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=" +
            keyword;

        unblockLog.log("🔍 Bodian: 搜索请求 URL:", url);
        const result = await unblockGet(url);
        unblockLog.log("📦 Bodian: HTTP 状态:", result.status);
        unblockLog.log("📦 Bodian: 搜索结果数据类型:", typeof result.data);

        // 如果返回的是字符串，尝试 JSON.parse
        let data: Record<string, unknown>;
        if (typeof result.data === "string") {
            unblockLog.log("📦 Bodian: 原始响应内容:", result.data.substring(0, 300));
            try {
                data = JSON.parse(result.data);
            } catch {
                unblockLog.error("❌ Bodian: JSON 解析失败");
                return null;
            }
        } else {
            data = result.data as Record<string, unknown>;
        }

        unblockLog.log("📦 Bodian: 解析后数据keys:", Object.keys(data || {}));

        if (
            !data ||
            !data.content ||
            (data.content as unknown[]).length < 2 ||
            !(data.content as Record<string, unknown>[])[1].musicpage ||
            ((data.content as Record<string, unknown>[])[1].musicpage as Record<string, unknown[]>).abslist.length < 1
        ) {
            unblockLog.warn("⚠️ Bodian: 搜索结果为空或格式不正确");
            return null;
        }

        const musicPage = (data.content as Record<string, unknown>[])[1].musicpage as Record<string, unknown[]>;
        const list = (musicPage.abslist as SongInfo[]).map(format);
        if (list[0] && !list[0]?.id) return null;
        unblockLog.log("🔍 Bodian: 搜索到歌曲 ID:", list[0].id, "名称:", list[0].name);
        return list[0].id || null;
    } catch (error) {
        unblockLog.error("❌ Get BodianSongId Error:", error);
        return null;
    }
};

/**
 * 发送广告请求（获取免费播放资格）
 */
const sendAdFreeRequest = async () => {
    try {
        const adurl =
            "http://bd-api.kuwo.cn/api/service/advert/watch?uid=-1&token=&timestamp=1724306124436&sign=15a676d66285117ad714e8c8371691da";
        const headers = {
            "user-agent": "Dart/2.19 (dart:io)",
            "plat": "ar",
            "channel": "aliopen",
            "devid": deviceId,
            "ver": "3.9.0",
            "host": "bd-api.kuwo.cn",
            "qimei36": "1e9970cbcdc20a031dee9f37100017e1840e",
            "content-type": "application/json; charset=utf-8",
        };
        const data = JSON.stringify({
            type: 5,
            subType: 5,
            musicId: 0,
            adToken: "",
        });
        return await unblockPost(adurl, data, headers);
    } catch (error) {
        unblockLog.error("❌ Get Bodian Ad Free Error:", error);
        return null;
    }
};

/**
 * 获取波点音乐歌曲 URL
 */
const getBodianSongUrl = async (keyword: string): Promise<SongUrlResult> => {
    try {
        if (!keyword) return { code: 404, url: null };
        const songId = await search(keyword);
        if (!songId) {
            unblockLog.warn("⚠️ Bodian: 搜索歌曲失败，未找到 songId, keyword:", keyword);
            return { code: 404, url: null };
        }
        unblockLog.log("🔍 Bodian: 找到 songId:", songId, "keyword:", keyword);

        const headers = {
            "user-agent": "Dart/2.19 (dart:io)",
            "plat": "ar",
            "channel": "aliopen",
            "devid": deviceId,
            "ver": "3.9.0",
            "host": "bd-api.kuwo.cn",
            "X-Forwarded-For": "1.0.1.114",
        };

        let audioUrl = `http://bd-api.kuwo.cn/api/play/music/v2/audioUrl?&br=${"320kmp3"}&musicId=${songId}`;
        audioUrl = generateSign(audioUrl);
        unblockLog.log("🔗 Bodian: 请求 audioUrl:", audioUrl);

        await sendAdFreeRequest();
        const result = await unblockGet(audioUrl, headers);

        // 添加详细日志
        unblockLog.log("📦 Bodian: API 返回数据类型:", typeof result.data);

        const data = result.data as Record<string, unknown>;
        if (typeof data === "object" && data?.data) {
            const innerData = data.data as Record<string, string>;
            if (innerData?.audioUrl) {
                const urlMatch = innerData.audioUrl;
                unblockLog.log("🔗 BodianSong URL:", urlMatch);
                return { code: 200, url: urlMatch };
            }
        }

        unblockLog.warn("⚠️ Bodian: 未获取到 audioUrl");
        return { code: 404, url: null };
    } catch (error) {
        unblockLog.error("❌ Get BodianSong URL Error:", error);
        return { code: 404, url: null };
    }
};

export default getBodianSongUrl;
