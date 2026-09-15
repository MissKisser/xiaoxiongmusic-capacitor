/**
 * 网易云盘解锁
 * 移植自 SPlayer/server/unblock/index.ts
 */
import { unblockGet, unblockLog } from "./http";
import type { SongUrlResult } from "./types";
import { useSettingStore } from "@/stores";
import { isIos } from "@/utils/env";
import { diagLog } from "@/utils/diag";

/** 应用音质设置到 GD 音质参数的映射（128/192/320/740/999） */
const brMap: Record<string, number> = {
    standard: 128,
    higher: 192,
    exhigh: 320,
    lossless: 740,
    hires: 999,
    jyeffect: 999,
    sky: 999,
    jymaster: 999,
};

/**
 * 解析当前音质设置对应的 GD 请求参数
 * iOS 的 WKWebView 音频元素无法解码无损 FLAC，上限压至 320 保证返回 MP3 形态
 */
const resolveBr = (): number => {
    let br = 320;
    try {
        br = brMap[useSettingStore().songLevel] ?? 320;
    } catch {
        // 设置读取失败保持默认
    }
    if (isIos && br > 320) br = 320;
    return br;
};

/**
 * 获取网易云盘歌曲 URL
 * 使用 GD音乐台 API
 */
const getNeteaseSongUrl = async (id: number | string): Promise<SongUrlResult> => {
    try {
        if (!id) return { code: 404, url: null };

        const baseUrl = "https://music-api.gdstudio.xyz/api.php";
        const br = resolveBr();
        diagLog(`GD取歌 id=${id} br=${br}`);
        const url = `${baseUrl}?types=url&id=${id}&br=${br}`;

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
        if (br !== 999) {
            try {
                const fallback = await unblockGet(`${baseUrl}?types=url&id=${id}&br=999`);
                const fallbackUrl = (fallback.data as Record<string, string>)?.url;
                if (fallbackUrl) {
                    unblockLog.log("🔗 NeteaseSongUrl 兜底 URL:", fallbackUrl);
                    return { code: 200, url: fallbackUrl };
                }
            } catch {
                // 兜底失败继续走 404
            }
        }
        return { code: 404, url: null };
    } catch (error) {
        unblockLog.error("❌ Get NeteaseSongUrl Error:", error);
        return { code: 404, url: null };
    }
};

export default getNeteaseSongUrl;
