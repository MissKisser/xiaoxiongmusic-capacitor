/**
 * 「我喜欢的音乐」视图的红心变更同步
 *
 * 红心写操作成功后广播一次变更事件，展示「我喜欢的音乐」的视图据此：
 *
 * 1. **乐观更新**：立即把变更落到本地列表（曲目出现 / 消失）与计数上，
 *    用户点完红心立刻看到「我喜欢的音乐」变了，不必手动刷新；
 * 2. **有界重拉**：后台重新读取上游，直到上游读到的数据已反映该变更。
 *
 * 上游是多节点复制，读到的可能是写操作之前的旧快照，
 * 因此重拉未反映变更时保留本地的乐观状态，只把上游的其余部分同步过来，
 * 不把界面回退成旧数据；重拉与乐观状态的补回在同一批渲染内完成，不会闪烁。
 *
 * @author Hackerdallas
 */

import type { SongType } from "@/types/main";
import type { ApiPlatform } from "@/types/shared";
import { onLikedSongsChanged, type LikedSongsChange } from "@/utils/likedEvents";

/**
 * 收敛重拉的等待间隔（毫秒）
 *
 * 逐次拉长，覆盖上游多节点复制的延迟窗口。
 */
const RETRY_DELAYS = [2500, 8000, 18000, 35000];

/** 视图同步参数 */
export interface LikedSongsSyncOptions {
  /** 视图当前展示的平台 */
  platform: () => ApiPlatform;
  /** 乐观更新：把一次红心变更立即落到视图数据上 */
  applyChange: (change: LikedSongsChange) => void;
  /** 视图当前的曲目列表 */
  currentTracks: () => SongType[];
  /** 重拉：重新读取上游「我喜欢的音乐」 */
  reload: () => Promise<void>;
  /** 是否需要处理该变更（缺省为全部处理） */
  shouldHandle?: (change: LikedSongsChange) => boolean;
}

/**
 * 判断上游读到的曲目是否已反映该红心变更
 *
 * 判据是歌曲的逻辑 id：酷狗是 mixSongId、QQ 音乐是 songid、网易云是歌曲 id，
 * 同一首歌的不同文件版本（不同内容哈希）共享同一个逻辑 id，
 * 因此跨版本也能正确判定。
 * @param tracks 上游读到的曲目
 * @param change 红心变更
 * @returns 是否已反映
 */
const isSettled = (tracks: SongType[], change: LikedSongsChange): boolean => {
  const id = Number(change.song.id);
  if (!Number.isFinite(id)) return true;
  const present = tracks.some((track) => Number(track.id) === id);
  return present === change.liked;
};

/**
 * 让「我喜欢的音乐」视图跟随红心写操作实时更新
 *
 * @param options 同步参数
 * @returns 取消订阅函数
 */
export const useLikedSongsSync = (options: LikedSongsSyncOptions): (() => void) => {
  /** 尚未被上游反映的变更 */
  const pending = new Map<string, LikedSongsChange>();
  /** 是否正在收敛 */
  let converging = false;

  /**
   * 收敛：重拉上游，直到待定变更全部被上游反映
   */
  const converge = async (): Promise<void> => {
    if (converging) return;
    converging = true;
    try {
      let attempt = 0;
      while (pending.size > 0 && attempt < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[attempt];
        attempt += 1;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        await options.reload();
        const tracks = options.currentTracks();
        // 已反映的变更出队
        for (const [key, change] of pending) {
          if (isSettled(tracks, change)) pending.delete(key);
        }
        if (pending.size === 0) return;
        // 上游尚未反映：把乐观状态补回，与重拉同批渲染，界面不闪烁
        for (const change of pending.values()) options.applyChange(change);
      }
      if (pending.size > 0) {
        console.warn("上游未在重试窗口内反映红心变更，保留本地状态");
      }
    } catch (error) {
      console.error("「我喜欢的音乐」同步失败：", error);
    } finally {
      converging = false;
    }
  };

  return onLikedSongsChanged((change) => {
    if (change.platform !== options.platform()) return;
    if (options.shouldHandle && !options.shouldHandle(change)) return;
    pending.set(`${change.platform}:${change.song.id}`, change);
    options.applyChange(change);
    void converge();
  });
};
