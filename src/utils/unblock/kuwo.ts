/**
 * 酷我音乐解锁
 * 移植自 SPlayer/server/unblock/kuwo.ts
 */
import { encryptQuery } from "./kwDES";
import { unblockGet, unblockLog } from "./http";
import type { SongUrlResult } from "./types";

/**
 * 获取酷我音乐歌曲 ID
 * @param keyword 搜索关键词
 * @param songName 原始歌曲名（用于匹配验证）
 */
const getKuwoSongId = async (keyword: string, songName?: string): Promise<string | null> => {
    try {
        const url =
            "http://search.kuwo.cn/r.s?&correct=1&stype=comprehensive&encoding=utf8&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=" +
            encodeURIComponent(keyword);
        unblockLog.log("🔍 Kuwo: 搜索请求 URL:", url);

        const result = await unblockGet(url);
        unblockLog.log("📦 Kuwo: HTTP 状态:", result.status);
        unblockLog.log("📦 Kuwo: 搜索结果数据类型:", typeof result.data);

        // 如果返回的是字符串，尝试 JSON.parse
        let data: Record<string, unknown>;
        if (typeof result.data === "string") {
            unblockLog.log("📦 Kuwo: 原始响应内容:", result.data.substring(0, 300));
            try {
                data = JSON.parse(result.data);
            } catch {
                unblockLog.error("❌ Kuwo: JSON 解析失败");
                return null;
            }
        } else {
            data = result.data as Record<string, unknown>;
        }

        unblockLog.log("📦 Kuwo: 解析后数据keys:", Object.keys(data || {}));

        if (
            !data ||
            !data.content ||
            (data.content as unknown[]).length < 2 ||
            !(data.content as Record<string, unknown>[])[1].musicpage ||
            ((data.content as Record<string, unknown>[])[1].musicpage as Record<string, unknown[]>).abslist.length < 1
        ) {
            unblockLog.warn("⚠️ Kuwo: 搜索结果为空或格式不正确, keyword:", keyword);
            return null;
        }

        const musicPage = (data.content as Record<string, unknown>[])[1].musicpage as Record<string, unknown[]>;
        const firstSong = musicPage.abslist[0] as Record<string, string>;
        const songId = firstSong.MUSICRID;
        const songName = firstSong.SONGNAME;
        unblockLog.log("🔍 Kuwo: 找到歌曲 songId:", songId, "songName:", songName);

        // 是否与原曲吻合（使用传入的 songName 进行验证，避免 split("-") 解析错误）
        const originalName = songName || (keyword?.split("-")?.[0] ?? keyword);
        if (foundSongName && !foundSongName.includes(originalName)) {
            unblockLog.warn("⚠️ Kuwo: 歌曲名不匹配, 期望:", originalName, "实际:", foundSongName);
            return null;
        }
        return songId.slice("MUSIC_".length);
    } catch (error) {
        unblockLog.error("❌ Get KuwoSongId Error:", error);
        return null;
    }
};

/**
 * 获取酷我音乐歌曲 URL
 * @param keyword 搜索关键词
 * @param songName 原始歌曲名（用于匹配验证）
 */
const getKuwoSongUrl = async (keyword: string, songName?: string): Promise<SongUrlResult> => {
    try {
        if (!keyword) return { code: 404, url: null };
        const songId = await getKuwoSongId(keyword, songName);
        if (!songId) return { code: 404, url: null };

        // 请求地址
        const PackageName = "kwplayer_ar_5.1.0.0_B_jiakong_vh.apk";
        const url =
            "http://mobi.kuwo.cn/mobi.s?f=kuwo&q=" +
            encryptQuery(
                `corp=kuwo&source=${PackageName}&p2p=1&type=convert_url2&sig=0&format=mp3` +
                "&rid=" +
                songId,
            );

        const result = await unblockGet(url, {
            "User-Agent": "okhttp/3.10.0",
        });

        const responseText = typeof result.data === "string" ? result.data : JSON.stringify(result.data);
        if (responseText) {
            const urlMatch = responseText.match(/http[^\s$"]+/);
            if (urlMatch && urlMatch[0]) {
                unblockLog.log("🔗 KuwoSong URL:", urlMatch[0]);
                return { code: 200, url: urlMatch[0] };
            }
        }
        return { code: 404, url: null };
    } catch (error) {
        unblockLog.error("❌ Get KuwoSong URL Error:", error);
        return { code: 404, url: null };
    }
};

export default getKuwoSongUrl;
