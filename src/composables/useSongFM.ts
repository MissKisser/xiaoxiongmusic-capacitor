/**
 * 平台刷歌交互（QQ 音乐 / 酷狗音乐推荐流）
 *
 * 对应网易云的「私人 FM」：同一套控制语义——
 * 播放 / 暂停走通用播放器，下一首在推荐流池内推进（池尽自动补取），
 * 第三个按钮是「换一批」：平台推荐流是只读接口，没有「不喜欢」反馈能力，
 * 该按钮改为重新取一批推荐流。
 *
 * 首页卡片与侧边栏「刷歌」入口共用本模块，保证两个入口行为一致。
 *
 * @author Hackerdallas
 */

import { computed } from "vue";
import { usePlayerController } from "@/core/player/PlayerController";
import { useSongManager } from "@/core/player/SongManager";
import { useMusicStore, useStatusStore } from "@/stores";

export const useSongFM = () => {
  const musicStore = useMusicStore();
  const statusStore = useStatusStore();

  const player = usePlayerController();
  const songManager = useSongManager();

  /** 当前推荐流曲目 */
  const fmSong = computed(() => musicStore.personalFMSong);

  /** 播放图标：处于刷歌模式时按播放状态切换 */
  const playIcon = computed<string>(() =>
    statusStore.personalFmMode ? (statusStore.playStatus ? "Pause" : "Play") : "Play",
  );

  /**
   * 确保推荐流可用
   *
   * 推荐流列表属于全局音乐 store：为空或不属于当前平台时重新取数。
   * @returns 是否有可用曲目
   */
  const ensureSongFM = async (): Promise<boolean> => {
    await songManager.initPersonalFM();
    return !!musicStore.personalFMSong?.id;
  };

  /**
   * 进入刷歌
   *
   * 进入推荐流模式并打开全屏播放器，与网易云「私人漫游」入口同形态。
   * @returns 是否成功进入
   */
  const enterSongFM = async (): Promise<boolean> => {
    if (!(await ensureSongFM())) return false;
    statusStore.personalFmMode = true;
    statusStore.shuffleMode = "off";
    await player.playSong();
    statusStore.showFullPlayer = true;
    return true;
  };

  /**
   * 播放 / 暂停
   *
   * 未进入刷歌时先取推荐流再起播。
   */
  const fmPlayOrPause = async () => {
    if (statusStore.personalFmMode) {
      await player.playOrPause();
      return;
    }
    if (!(await ensureSongFM())) {
      window.$message.error("开启刷歌出错，请重试");
      return;
    }
    statusStore.personalFmMode = true;
    statusStore.shuffleMode = "off";
    await player.playSong();
  };

  /**
   * 下一首
   *
   * 在推荐流池内推进，池内曲目播完时自动补取下一批。
   */
  const fmPlayNext = async () => {
    statusStore.personalFmMode = true;
    statusStore.shuffleMode = "off";
    await player.nextOrPrev("next");
  };

  /**
   * 换一批
   *
   * 重新取一批推荐流；已在刷歌模式下时接着播放新一批的首曲。
   */
  const fmRefresh = async () => {
    await songManager.refreshPersonalFM();
    if (statusStore.personalFmMode) await player.playSong();
  };

  return {
    fmSong,
    playIcon,
    ensureSongFM,
    enterSongFM,
    fmPlayOrPause,
    fmPlayNext,
    fmRefresh,
  };
};
