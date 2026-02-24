/**
 * 本地解锁模块统一入口
 * 替代服务器端 /api/unblock 接口
 */
import { SongUnlockServer } from "@/core/player/SongManager";
import type { SongUrlResult } from "./types";
import getKuwoSongUrl from "./kuwo";
import getBodianSongUrl from "./bodian";
import getGequbaoSongUrl from "./gequbao";
import getNeteaseSongUrl from "./netease";
import { unblockLog } from "./http";

/**
 * 本地解锁歌曲 URL
 * @param id 歌曲 ID（网易云使用）
 * @param keyword 搜索关键词（其他源使用）
 * @param server 解锁服务器类型
 * @returns 解锁结果
 */
export async function localUnlockSongUrl(
    id: number,
    keyword: string,
    server: SongUnlockServer
): Promise<SongUrlResult> {
    unblockLog.log(`🔓 本地解锁开始: server=${server}, id=${id}, keyword=${keyword}`);

    try {
        let result: SongUrlResult;

        switch (server) {
            case SongUnlockServer.NETEASE:
                result = await getNeteaseSongUrl(id);
                break;
            case SongUnlockServer.KUWO:
                result = await getKuwoSongUrl(keyword);
                break;
            case SongUnlockServer.BODIAN:
                result = await getBodianSongUrl(keyword);
                break;
            case SongUnlockServer.GEQUBAO:
                result = await getGequbaoSongUrl(keyword);
                break;
            default:
                unblockLog.warn(`⚠️ 未知的解锁服务器类型: ${server}`);
                result = { code: 404, url: null };
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
