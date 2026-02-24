import { encryptQuery } from "./kwDES.js";
import type { SongUrlResult } from "./unblock.d.ts";
import { serverLog } from "../logger.js";
import axios from "axios";

// 获取酷我音乐歌曲 ID
const getKuwoSongId = async (keyword: string): Promise<string | null> => {
  try {
    const url =
      "http://search.kuwo.cn/r.s?&correct=1&stype=comprehensive&encoding=utf8&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=" +
      keyword;
    const result = await axios.get(url);
    if (
      !result.data ||
      result.data.content.length < 2 ||
      !result.data.content[1].musicpage ||
      result.data.content[1].musicpage.abslist.length < 1
    ) {
      return null;
    }
    // 获取歌曲信息
    const songId = result.data.content[1].musicpage.abslist[0].MUSICRID;
    const songName = result.data.content[1].musicpage.abslist[0]?.SONGNAME;
    // 是否与原曲吻合
    const originalName = keyword?.split("-") ?? keyword;
    if (songName && !songName?.includes(originalName[0])) return null;
    return songId.slice("MUSIC_".length);
  } catch (error) {
    serverLog.error("❌ Get KuwoSongId Error:", error);
    return null;
  }
};

// 获取酷我音乐歌曲 URL
const getKuwoSongUrl = async (keyword: string): Promise<SongUrlResult> => {
  try {
    if (!keyword) return { code: 404, url: null };
    const songId = await getKuwoSongId(keyword);
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
    const result = await axios.get(url, {
      headers: {
        "User-Agent": "okhttp/3.10.0",
      },
    });
    if (result.data) {
      const urlMatch = result.data.match(/http[^\s$"]+/)[0];
      serverLog.log("🔗 KuwoSong URL:", urlMatch);
      return { code: 200, url: urlMatch };
    }
    return { code: 404, url: null };
  } catch (error) {
    serverLog.error("❌ Get KuwoSong URL Error:", error);
    return { code: 404, url: null };
  }
};

export default getKuwoSongUrl;
