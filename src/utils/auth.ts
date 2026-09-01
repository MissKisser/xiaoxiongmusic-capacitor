import { getCookie, removeCookie, setCookies } from "./cookie";
import type { UserLikeDataType, CoverType, ArtistType, SongType } from "@/types/main";
import {
  userAccount,
  userDetail,
  userSubcount,
  userLike,
  userDj,
  userMv,
  userArtist,
  userAlbum,
  userPlaylist,
} from "@/api/user";
import { likeSong, songDetail } from "@/api/song";
import { formatCoverList, formatArtistsList, formatSongsList } from "@/utils/format";
import { useDataStore, useMusicStore } from "@/stores";
import { logout, refreshLogin } from "@/api/login";
import { debounce, isFunction, uniqBy, type DebouncedFunc } from "lodash-es";
import { isBeforeSixAM } from "./time";
import { dailyRecommend } from "@/api/rec";
import { isElectron } from "./env";
import { likePlaylist, playlistDetail, playlistAllSongs, playlistTracks } from "@/api/playlist";
import { likeArtist } from "@/api/artist";
import { likeAlbum } from "@/api/album";
import { radioSub } from "@/api/radio";
import router from "@/router";

/**
 * 用户是否登录
 * @returns 0 - 未登录 / 1 - 正常登录 / 2 - UID 登录
 */
export const isLogin = (): 0 | 1 | 2 => {
  const dataStore = useDataStore();
  if (!dataStore.userLoginStatus) return 0;
  if (dataStore.loginType === "uid") return 2;
  return getCookie("MUSIC_U") ? 1 : 0;
};
// 退出登录
export const toLogout = async (): Promise<void> => {
  const dataStore = useDataStore();
  await logout();
  // 去除 cookie
  removeCookie("MUSIC_U");
  removeCookie("__csrf");
  sessionStorage.clear();
  // 清除用户数据
  await dataStore.clearUserData();
  // 跳转首页
  router.push("/");
  window.$message.success("成功退出登录");
};

// 刷新登录
export const refreshLoginData = async () => {
  // lastLoginTime 是否超过 3 天
  const lastLoginTime = localStorage.getItem("lastLoginTime");
  // 超时时长
  const timeout = 3 * 24 * 60 * 60 * 1000;
  if (lastLoginTime && Date.now() - Number(lastLoginTime) > timeout) {
    // 刷新登录
    const result = await refreshLogin();
    if (result?.code === 200) {
      setCookies(result.cookie);
      localStorage.setItem("lastLoginTime", Date.now().toString());
    }
    return result;
  }
};

// 更新用户信息
export const updateUserData = async () => {
  try {
    if (!isLogin()) return;
    const dataStore = useDataStore();
    // userId
    const accountRes = await userAccount();
    console.log("👤 [Debug] userAccount 原始响应:", JSON.stringify(accountRes).substring(0, 500));

    // 兼容 profile 为 null 的情况
    const profile = accountRes.profile || accountRes.data?.profile;
    if (!profile) {
      console.warn("⚠️ [Debug] 未从 userAccount 获取到 profile 信息");
      return;
    }

    const userId = profile.userId;
    // 获取用户信息
    const userDetailData = await userDetail(userId);
    const userData = Object.assign(profile, userDetailData);
    // 获取用户订阅信息
    const subcountData = await userSubcount();
    // 更改用户信息
    dataStore.userData = {
      userId,
      userType: userData.userType,
      vipType: userData.vipType,
      name: userData.nickname,
      level: userData.level,
      avatarUrl: userData.avatarUrl,
      backgroundUrl: userData.backgroundUrl,
      createTime: userData.createTime,
      createDays: userData.createDays,
      artistCount: subcountData.artistCount,
      djRadioCount: subcountData.djRadioCount,
      mvCount: subcountData.mvCount,
      subPlaylistCount: subcountData.subPlaylistCount,
      createdPlaylistCount: subcountData.createdPlaylistCount,
    };
    // 获取用户喜欢数据
    const allUserLikeResult = await Promise.allSettled([
      updateUserLikeSongs(),
      updateUserLikePlaylist(),
      updateUserLikeArtists(),
      updateUserLikeAlbums(),
      updateUserLikeMvs(),
      updateUserLikeDjs(),
      // 每日推荐
      updateDailySongsData(),
    ]);
    // 若部分失败
    const hasFailed = allUserLikeResult.some((result) => result.status === "rejected");
    if (hasFailed) throw new Error("Failed to update some user data");
    // 首页"我喜欢的音乐"卡片依赖歌单列表数据，需在喜欢数据就绪后拉取
    await updateLikedSongsList().catch((error) => {
      console.error("❌ Error updating liked songs list:", error);
    });
  } catch (error) {
    console.error("❌ Error updating user data:", error);
    throw error;
  }
};

// 更新用户信息 - 特殊登录模式
export const updateSpecialUserData = async (userData?: any) => {
  try {
    const dataStore = useDataStore();
    if (!userData) {
      const result = await userDetail(dataStore.userData.userId);
      userData = result?.profile;
    }
    // 更改用户信息
    dataStore.userData = {
      userId: userData.userId,
      userType: userData.userType,
      vipType: userData.vipType,
      name: userData.nickname,
      level: userData.level,
      avatarUrl: userData.avatarUrl,
      backgroundUrl: userData.backgroundUrl,
      createTime: userData.createTime,
      createDays: userData.createDays,
    };
    // 获取用户喜欢数据
    await updateUserLikePlaylist();
  } catch (error) {
    console.error("❌ Error updating special user data:", error);
    throw error;
  }
};

// 更新用户喜欢歌曲
export const updateUserLikeSongs = async () => {
  const dataStore = useDataStore();
  if (!isLogin() || !dataStore.userData.userId) return;
  const result = await userLike(dataStore.userData.userId);
  dataStore.setUserLikeData("songs", result.ids);
};

// 更新用户喜欢歌单
export const updateUserLikePlaylist = async () => {
  const dataStore = useDataStore();
  const userId = dataStore.userData.userId;
  if (!isLogin() || !userId) return;
  if (dataStore.loginType === "uid") {
    const result = await userPlaylist(30, 0, userId);
    dataStore.setUserLikeData("playlists", formatCoverList(result.playlist));
    return;
  }
  // 计算数量
  const { createdPlaylistCount, subPlaylistCount } = dataStore.userData;
  const number = (createdPlaylistCount || 0) + (subPlaylistCount || 0) || 50;
  const result = await userPlaylist(number, 0, userId);
  dataStore.setUserLikeData("playlists", formatCoverList(result.playlist));
};

// 更新用户喜欢歌手
export const updateUserLikeArtists = async () => {
  await setUserLikeDataLoop(userArtist, formatArtistsList, "artists");
};

/**
 * 更新我喜欢的音乐歌单数据
 *
 * 首页"我喜欢的音乐"卡片读取 likeSongsList,该数据原本仅在访问
 * 我喜欢页面或应用启动恢复时填充,登录后需主动拉取一次,否则卡片为空。
 * @returns 是否成功
 */
export const updateLikedSongsList = async (): Promise<boolean> => {
  const dataStore = useDataStore();
  if (!isLogin() || !dataStore.userData.userId) return false;
  // 缓存与喜欢列表一致时跳过，避免重复拉取
  const likedIds = dataStore.userLikeData.songs;
  const cachedIds = dataStore.likeSongsList.data.map((s) => s.id);
  if (cachedIds.length > 0 && cachedIds.length === likedIds.length) {
    const likedSet = new Set(likedIds);
    if (cachedIds.every((id) => likedSet.has(id))) return true;
  }
  // 我喜欢的音乐是用户第一个创建的歌单
  const likedId = Number(dataStore.userLikeData.playlists[0]?.id);
  if (!likedId) return false;
  // 歌单详情
  const detailRes = await playlistDetail(likedId);
  const detail = formatCoverList(detailRes.playlist)[0];
  if (!detail) return false;
  // 歌单歌曲:800 首以内直接批量详情,超出按 500/页分页拉取
  let songs: SongType[] = [];
  if ((detail.count as number) < 800 && Array.isArray(detailRes.privileges)) {
    const ids: number[] = detailRes.privileges.map((s: any) => s.id as number);
    songs = uniqBy(formatSongsList((await songDetail(ids)).songs), "id");
  } else {
    const collected: SongType[] = [];
    const limit = 500;
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const result = await playlistAllSongs(likedId, limit, offset);
      const page = formatSongsList(result.songs);
      collected.push(...page);
      offset += limit;
      hasMore = page.length > 0 && offset < (detail.count as number);
    }
    songs = uniqBy(collected, "id");
  }
  await dataStore.setLikeSongsList(detail, songs);
  return true;
};

// 更新用户喜欢专辑
export const updateUserLikeAlbums = async () => {
  await setUserLikeDataLoop(userAlbum, formatCoverList, "albums");
};

// 更新用户喜欢电台
export const updateUserLikeDjs = async () => {
  await setUserLikeDataLoop(userDj, formatCoverList, "djs");
};

// 更新用户喜欢MV
export const updateUserLikeMvs = async () => {
  await setUserLikeDataLoop(userMv, formatCoverList, "mvs");
};

// 喜欢歌曲
export const toLikeSong: DebouncedFunc<(song: SongType, like: boolean) => Promise<void>> = debounce(
  async (song: SongType, like: boolean): Promise<void> => {
    try {
      if (!isLogin()) {
        window.$message.warning("请登录后使用");
        return;
      }
      if (isLogin() === 2) {
        window.$message.warning("该登录模式暂不支持该操作");
        return;
      }
      const dataStore = useDataStore();
      const { id, path, type } = song;
      if (path || type === "streaming") {
        window.$message.warning("该类型歌曲暂未实现");
        return;
      }
      const likeList = dataStore.userLikeData.songs;
      const exists = likeList.includes(id);
      await likeSong(id, like);
      if (like && !exists) {
        likeList.push(id);
        window.$message.success("已添加到我喜欢的音乐");
      } else if (!like && exists) {
        likeList.splice(likeList.indexOf(id), 1);
        window.$message.success("已取消喜欢");
      } else if (like && exists) {
        window.$message.info("我喜欢的音乐中已存在该歌曲");
      }
      // 更新
      dataStore.setUserLikeData("songs", likeList);
      // ipc
      if (isElectron) window.electron.ipcRenderer.send("like-status-change", like);
    } catch (error) {
      window.$message.error(`${like ? "喜欢" : "取消"}音乐时发生错误`);
      console.error("❌ 更新喜欢歌曲时失败:", error);
    }
  },
  300,
  { leading: true, trailing: false },
);

const toLikeSomething = (
  actionName: string,
  thingName: string,
  request: () => (id: number, t: 1 | 2) => Promise<{ code: number }>,
  update: () => Promise<void>,
): DebouncedFunc<(id: number, like: boolean) => Promise<void>> =>
  debounce(
    async (id: number, like: boolean): Promise<void> => {
      // 错误情况
      if (!id) return;
      if (!isLogin()) {
        window.$message.warning("请登录后使用");
        return;
      }
      if (isLogin() === 2) {
        window.$message.warning("该登录模式暂不支持该操作");
        return;
      }
      // 请求
      const { code } = await request()(id, like ? 1 : 2);
      if (code === 200) {
        window.$message.success((like ? "" : "取消") + actionName + thingName + "成功");
        // 更新
        await update();
      } else {
        window.$message.success((like ? "" : "取消") + actionName + thingName + "失败，请重试");
        return;
      }
    },
    300,
    { leading: true, trailing: false },
  );

// 收藏/取消收藏歌单
export const toLikePlaylist = toLikeSomething(
  "收藏",
  "歌单",
  () => likePlaylist,
  updateUserLikePlaylist,
);

// 收藏/取消收藏专辑
export const toLikeAlbum = toLikeSomething("收藏", "专辑", () => likeAlbum, updateUserLikeAlbums);

// 收藏/取消收藏歌手
export const toLikeArtist = toLikeSomething(
  "收藏",
  "歌手",
  () => likeArtist,
  updateUserLikeArtists,
);

// 订阅/取消订阅播客
export const toSubRadio = toLikeSomething("订阅", "播客", () => radioSub, updateUserLikeDjs);

// 循环获取用户喜欢数据
const setUserLikeDataLoop = async <T>(
  apiFunction: (limit: number, offset: number) => Promise<any>,
  formatFunction: (data: any[]) => T[],
  key: keyof UserLikeDataType,
) => {
  const dataStore = useDataStore();
  const userId = dataStore.userData.userId;
  if (!isLogin() || !userId) return;

  let offset = 0;
  const allData: T[] = [];
  const limit = 50; // 限制每页50条

  while (true) {
    try {
      const result = await apiFunction(limit, offset);
      // 根据不同 API 提取数据字段
      let data: any[] = [];
      if (key === "djs") {
        data = result.djRadios || [];
      } else if (key === "playlists") {
        data = result.playlist || [];
      } else {
        data = result.data || [];
      }

      if (!Array.isArray(data) || data.length === 0) {
        break; // 没有更多数据
      }

      // 格式化并合并数据
      const formattedData = formatFunction(data);
      allData.push(...formattedData);

      // 数据少于分页大小，说明已是最后一页
      if (data.length < limit) {
        break;
      }

      offset += limit;
    } catch (error) {
      console.error(`Error fetching ${key} data at offset ${offset}:`, error);
      break;
    }
  }
  // 保存数据
  if (key === "artists") {
    dataStore.setUserLikeData(key, allData as ArtistType[]);
  } else if (key === "playlists" || key === "albums" || key === "mvs" || key === "djs") {
    dataStore.setUserLikeData(key, allData as CoverType[]);
  } else {
    console.error(`Unsupported key in setUserLikeDataLoop: ${key}`);
  }

  console.log(`✅ Fetched ${allData.length} ${key} for user ${userId}`);
  return allData;
};

/**
 * 更新每日推荐
 * @param refresh 是否强制刷新
 */
export const updateDailySongsData = async (refresh = false) => {
  try {
    const musicStore = useMusicStore();
    if (!isLogin()) {
      musicStore.dailySongsData = { timestamp: null, list: [] };
      return;
    }
    const { timestamp, list } = musicStore.dailySongsData;
    // 是否需要刷新
    if (!refresh && list.length > 0 && timestamp && !isBeforeSixAM(timestamp)) return;
    // 获取每日推荐
    const result = await dailyRecommend("songs");
    const songsData = formatSongsList(result.data.dailySongs);
    // 更新数据
    musicStore.dailySongsData = { timestamp: Date.now(), list: songsData };
    if (refresh) window.$message.success("每日推荐更新成功");
  } catch (error) {
    console.error("❌ Error updating daily songs data:", error);
    throw error;
  }
};

/**
 * 删除歌曲
 * @param pid 歌单id
 * @param ids 要删除的歌曲id
 */
export const deleteSongs = async (pid: number, ids: number[], callback?: () => void) => {
  try {
    window.$dialog.warning({
      title: "删除歌曲",
      content: ids?.length > 1 ? "确定删除这些选中的歌曲吗？" : "确定删除这个歌曲吗？",
      positiveText: "删除",
      negativeText: "取消",
      onPositiveClick: async () => {
        const result = await playlistTracks(pid, ids, "del");
        // 服务端透传网易云响应体（{code: 200}），以 code 字段判定结果
        if (result?.code === 200) {
          if (isFunction(callback)) callback();
          window.$message.success("删除成功");
        } else {
          window.$message.error(result?.msg || result?.message || "删除歌曲失败，请重试");
        }
      },
    });
  } catch (error) {
    console.error("❌ Error deleting songs:", error);
    throw error;
  }
};
