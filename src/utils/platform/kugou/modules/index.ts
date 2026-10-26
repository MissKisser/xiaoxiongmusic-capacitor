/**
 * 酷狗音乐平台模块注册表
 *
 * 本波次支持：登录二维码、用户资料、播放地址、多分类搜索、歌单读组（自建/收藏/公开歌单）。
 *
 * @author Hackerdallas
 */

import type { KGModule } from "../core/types";
import { user_detail } from "./user_detail";
import { login_qr_check, login_qr_key } from "./login_qr";
import { playlist_detail, user_playlist_list, user_profile } from "./user_playlist";
import { search } from "./search";
import { song_url } from "./song_url";
import { playlist } from "./playlist";

export const modules: Record<string, KGModule> = {
  login_qr_key,
  login_qr_check,
  user_detail,
  user_playlist_list,
  playlist_detail,
  user_profile,
  search,
  song_url,
  playlist,
};

export {
  login_qr_key,
  login_qr_check,
  user_detail,
  user_playlist_list,
  playlist_detail,
  user_profile,
  search,
  song_url,
  playlist,
};
