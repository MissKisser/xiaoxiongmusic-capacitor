/**
 * 酷狗音乐平台模块注册表
 *
 * 覆盖：登录、用户资料、歌单读写、搜索、播放直链、榜单、热搜、首页、歌手、专辑、评论、听书、每日推荐、刷歌FM、歌词。
 *
 * @author Hackerdallas
 */

import type { KGModule } from "../core/types";

import { user_detail } from "./user_detail";
import { login_qr_check, login_qr_key } from "./login_qr";
import { playlist_detail, user_playlist_list, user_profile } from "./user_playlist";
import {
  playlist_create,
  playlist_rename,
  playlist_delete,
  playlist_tracks,
  playlist_subscribe,
} from "./playlist_write";
import { album } from "./album";
import { artist } from "./artist";
import { audiobookCategory, audiobookDetail, audiobookList } from "./audiobook";
import { hot_artists } from "./hot_artists";
import { hot_search } from "./hot_search";
import { comment } from "./comment";
import { homeAlbum } from "./home_album";
import { homeTheme } from "./home_theme";
import { leaderboard_detail, leaderboard_list } from "./leaderboard";
import { lyric } from "./lyric";
import { playlist } from "./playlist";
import { playlist_square } from "./playlist_square";
import { search } from "./search";
import { song_url } from "./song_url";
import { songfm } from "./songfm";
import { dailyRecommend } from "./daily_recommend";

export const modules: Record<string, KGModule> = {
  login_qr_key,
  login_qr_check,
  user_detail,
  user_playlist_list,
  playlist_detail,
  user_profile,
  playlist_create,
  playlist_rename,
  playlist_delete,
  playlist_tracks,
  playlist_subscribe,
  search,
  song_url,
  songfm,
  lyric,
  comment,
  album,
  artist,
  "audiobook/category": audiobookCategory,
  "audiobook/list": audiobookList,
  "audiobook/detail": audiobookDetail,
  hot_artists,
  hot_search,
  playlist,
  playlist_square,
  leaderboard_list,
  leaderboard_detail,
  "daily/recommend": dailyRecommend,
  "home/album": homeAlbum,
  "home/theme": homeTheme,
};

export {
  user_detail,
  login_qr_check,
  login_qr_key,
  playlist_detail,
  user_playlist_list,
  user_profile,
  playlist_create,
  playlist_rename,
  playlist_delete,
  playlist_tracks,
  playlist_subscribe,
  album,
  artist,
  audiobookCategory,
  audiobookDetail,
  audiobookList,
  hot_artists,
  hot_search,
  comment,
  homeAlbum,
  homeTheme,
  leaderboard_detail,
  leaderboard_list,
  lyric,
  playlist,
  playlist_square,
  search,
  song_url,
  songfm,
  dailyRecommend,
};
