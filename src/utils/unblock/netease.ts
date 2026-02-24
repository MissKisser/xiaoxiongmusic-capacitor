/**
 * 网易云盘解锁
 * 移植自 SPlayer/server/unblock/index.ts
 */
import { unblockGet, unblockLog } from "./http";
import type { SongUrlResult } from "./types";

/**
 * 获取网易云盘歌曲 URL
 * 使用 GD音乐台 API
 */
const getNeteaseSongUrl = async (id: number | string): Promise<SongUrlResult> => {
    try {
        if (!id) return { code: 404, url: null };

        const baseUrl = "https://music-api.gdstudio.xyz/api.php";
        const url = `${baseUrl}?types=url&id=${id}`;

        unblockLog.log("🔍 Netease: 请求 URL:", url);
        const result = await unblockGet(url);
        unblockLog.log("📦 Netease: HTTP 状态:", result.status);
        unblockLog.log("📦 Netease: 响应类型:", typeof result.data);
        unblockLog.log("📦 Netease: 响应内容:", JSON.stringify(result.data).substring(0, 500));

        const data = result.data as Record<string, string>;

        const songUrl = data?.url;
        if (songUrl) {
            unblockLog.log("🔗 NeteaseSongUrl URL:", songUrl);
            return { code: 200, url: songUrl };
        }

        unblockLog.warn("⚠️ Netease: 响应中没有 url 字段");
        return { code: 404, url: null };
    } catch (error) {
        unblockLog.error("❌ Get NeteaseSongUrl Error:", error);
        return { code: 404, url: null };
    }
};

export default getNeteaseSongUrl;
