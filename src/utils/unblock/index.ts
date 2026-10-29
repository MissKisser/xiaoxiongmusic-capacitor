/**
 * 本地解锁模块统一入口
 *
 * 分发两类换源：
 * - 本地直连源（网易云 / 酷我 / 波点 / 歌曲宝）：端侧自行完成检索与取链；
 * - 远程回退源（咪咕 / 长青聚合 / 落雪音源 / 星海音源 / 小鱼音源 / 吉祥音源）：端侧无本地实现，
 *   服务端有同源实现，统一改为请求远程解锁服务，避免这些源被当成未知类型恒定 404 空转。
 */
import { SongUnlockServer } from "@/core/player/SongManager";
import type { SongUrlResult } from "./types";
import getKuwoSongUrl from "./kuwo";
import getBodianSongUrl from "./bodian";
import getGequbaoSongUrl from "./gequbao";
import getNeteaseSongUrl from "./netease";
import { isRemoteUnlockServer, requestRemoteUnlock } from "./remote";
import { unblockLog } from "./http";

/**
 * 换源寻址上下文
 *
 * 远程回退源走的是服务端同源实现，服务端按「歌名 + 歌手 + 时长」三重校验候选，
 * 并对按平台内 id 寻址的源支持直查，故这些上下文需要一并传给服务端。
 */
export interface UnlockRequestContext {
    /** 歌曲声明时长（秒） */
    duration?: number;
    /** 歌曲来源平台（netease / qqmusic / kugou） */
    platform?: string;
    /** 平台内歌曲主键（QQ mid / 酷狗 hash） */
    platformId?: string;
}

/**
 * 本地解锁歌曲 URL
 * @param id 歌曲 ID（网易云使用）
 * @param songName 歌曲名（用于匹配验证）
 * @param artist 歌手名（用于匹配验证）
 * @param server 解锁服务器类型
 * @param context 换源寻址上下文（时长 / 平台 / 平台内 id）
 * @returns 解锁结果
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
        let result: SongUrlResult;

        switch (server) {
            case SongUnlockServer.NETEASE:
                result = await getNeteaseSongUrl(id);
                break;
            case SongUnlockServer.KUWO:
                result = await getKuwoSongUrl(keyword, songName);
                break;
            case SongUnlockServer.BODIAN:
                result = await getBodianSongUrl(keyword);
                break;
            case SongUnlockServer.GEQUBAO:
                result = await getGequbaoSongUrl(keyword);
                break;
            default:
                if (isRemoteUnlockServer(server)) {
                    // 咪咕 / 长青聚合 / 落雪音源 / 星海音源 / 小鱼音源 / 吉祥音源：端侧无实现，改走远程解锁服务
                    result = await requestRemoteUnlock(server, {
                        keyword,
                        songName,
                        artist,
                        duration: context?.duration,
                        platform: context?.platform,
                        platformId: context?.platformId,
                    });
                    break;
                }
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
