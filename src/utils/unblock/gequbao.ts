/**
 * 歌曲宝解锁
 * 移植自 SPlayer/server/unblock/gequbao.ts
 */
import { unblockGet, unblockPost, unblockLog } from "./http";
import type { SongUrlResult } from "./types";

/**
 * 生成随机会话 ID（替代 Node.js crypto.randomBytes）
 */
const generateRandomSessionId = (): string => {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * 搜索歌曲
 */
const search = async (keyword: string): Promise<string | null> => {
    try {
        const searchUrl = `https://www.gequbao.com/s/${encodeURIComponent(keyword)}`;
        unblockLog.log("🔍 Gequbao: 搜索请求 URL:", searchUrl);
        const response = await unblockGet(searchUrl);
        unblockLog.log("📦 Gequbao: HTTP 状态:", response.status);
        const data = typeof response.data === 'string' ? response.data : '';
        unblockLog.log("📦 Gequbao: 响应长度:", data.length);

        const match = data.match(
            /<a href="\/music\/(\d+)" target="_blank" class="music-link d-block">/,
        );
        if (match && match[1]) {
            unblockLog.log("🔍 Gequbao: 找到歌曲 ID:", match[1]);
            return match[1];
        }
        unblockLog.warn("⚠️ Gequbao: 未在页面中匹配到歌曲链接");
        return null;
    } catch (error) {
        unblockLog.error("❌ Get GequbaoSongId Error:", error);
        return null;
    }
};

/**
 * 获取播放 ID
 */
const getPlayId = async (id: string): Promise<string | null> => {
    try {
        const url = `https://www.gequbao.com/music/${id}`;
        unblockLog.log("🔍 Gequbao: 获取 playId URL:", url);
        const response = await unblockGet(url);
        const data = typeof response.data === 'string' ? response.data : '';

        const match = data.match(/"play_id":"(.*?)"/);
        if (match && match[1]) {
            unblockLog.log("🔍 Gequbao: 找到 playId:", match[1]);
            return match[1];
        }
        unblockLog.warn("⚠️ Gequbao: 未在页面中匹配到 play_id");
        return null;
    } catch (error) {
        unblockLog.error("❌ Get GequbaoPlayId Error:", error);
        return null;
    }
};

/**
 * 获取歌曲宝歌曲 URL
 */
const getGequbaoSongUrl = async (keyword: string): Promise<SongUrlResult> => {
    try {
        if (!keyword) return { code: 404, url: null };

        const id = await search(keyword);
        if (!id) {
            unblockLog.warn("⚠️ Gequbao: 搜索歌曲失败，未找到 ID, keyword:", keyword);
            return { code: 404, url: null };
        }

        const playId = await getPlayId(id);
        if (!playId) {
            unblockLog.warn("⚠️ Gequbao: 获取 playId 失败");
            return { code: 404, url: null };
        }

        const url = "https://www.gequbao.com/api/play-url";
        const headers = {
            "accept": "application/json, text/javascript, */*; q=0.01",
            "accept-language": "zh-CN,zh;q=0.9",
            "cache-control": "no-cache",
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "pragma": "no-cache",
            "priority": "u=1, i",
            "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "x-requested-with": "XMLHttpRequest",
            "cookie": `server_name_session=${generateRandomSessionId()}`,
            "Referer": `https://www.gequbao.com/music/${id}`,
        };

        const body = `id=${encodeURIComponent(playId)}`;
        unblockLog.log("🔍 Gequbao: 请求播放 URL, playId:", playId);
        const response = await unblockPost(url, body, headers);
        unblockLog.log("📦 Gequbao: API 响应状态:", response.status);
        unblockLog.log("📦 Gequbao: API 响应内容:", JSON.stringify(response.data).substring(0, 300));

        const data = response.data as Record<string, unknown>;

        if (data.code === 1 && data.data) {
            const innerData = data.data as Record<string, string>;
            if (innerData.url) {
                unblockLog.log("🔗 GequbaoSong URL:", innerData.url);
                return { code: 200, url: innerData.url };
            }
        }
        unblockLog.warn("⚠️ Gequbao: API 未返回有效 URL, code:", data.code);
        return { code: 404, url: null };
    } catch (error) {
        unblockLog.error("❌ Get GequbaoSong URL Error:", error);
        return { code: 404, url: null };
    }
};

export default getGequbaoSongUrl;
