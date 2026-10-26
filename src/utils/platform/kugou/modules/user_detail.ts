/**
 * 酷狗音乐用户资料与鉴权状态模块
 *
 * @author Hackerdallas
 */

import type { KGModule } from "../core/types";
import { getSessionCookies, saveSessionCookies } from "../../sessionStore";
import { kgGatewayRequest } from "../core/request";
import { rsaEncryptKugou } from "../core/crypto";
import { isKugouAuthExpired } from "../core/auth";
import { clearCache } from "../core/cache";

interface UserDetailData {
  userid?: number | string;
  nickname?: string;
  username?: string;
  user_name?: string;
  pic?: string;
  userpic?: string;
  user_pic?: string;
  avatar?: string;
  vip_type?: number;
}

/**
 * 清空登录凭据
 * 保留设备标识（guid / dfid），仅丢弃账号凭据与旧账号内存缓存
 * @param session 当前会话字典
 */
const clearLoginSession = (session: Record<string, string>): void => {
  const device = {
    ...(session.guid ? { guid: session.guid } : {}),
    ...(session.dfid ? { dfid: session.dfid } : {}),
  };
  saveSessionCookies("kugou", device);
  clearCache();
};

/**
 * 获取当前登录用户信息与会员状态
 */
export const user_detail: KGModule = async () => {
  const session = getSessionCookies("kugou");
  if (!session.token || !session.userid) return { code: 200, loggedIn: false };

  const clienttime = Math.floor(Date.now() / 1000);
  let response: { data?: UserDetailData };

  try {
    response = await kgGatewayRequest<{ data?: UserDetailData }>("/v3/get_my_info", {
      method: "POST",
      data: {
        visit_time: clienttime,
        usertype: 1,
        p: rsaEncryptKugou({ token: session.token, clienttime }).toUpperCase(),
        userid: Number(session.userid),
      },
      params: { plat: 1 },
      headers: { "x-router": "usercenter.kugou.com" },
    });
  } catch (err) {
    if (isKugouAuthExpired(err)) {
      clearLoginSession(session);
      return { code: 401, loggedIn: false, message: "酷狗音乐登录已过期，请重新登录" };
    }
    throw err;
  }

  const data = response?.data ?? {};
  const nickname = data.nickname ?? data.username ?? data.user_name ?? session.nickname;
  const avatar = data.pic ?? data.userpic ?? data.user_pic ?? data.avatar ?? session.avatar;

  let isVip = Number(data.vip_type ?? 0) > 0;
  if (!isVip) {
    const unionResp = await kgGatewayRequest<{
      data?: { busi_vip?: Array<{ is_vip?: number }> };
    }>("/v1/get_union_vip", {
      baseURL: "https://kugouvip.kugou.com",
      params: { busi_type: "concept" },
    }).catch(() => null);
    isVip = unionResp?.data?.busi_vip?.[0]?.is_vip === 1;
  }

  const nextSession: Record<string, string> = {
    ...session,
    ...(nickname ? { nickname: String(nickname) } : {}),
    ...(avatar ? { avatar: String(avatar).replace(/^http:\/\//, "https://") } : {}),
    ...(data.vip_type !== undefined ? { vip_type: String(data.vip_type) } : {}),
  };
  saveSessionCookies("kugou", nextSession);

  return {
    code: 200,
    loggedIn: true,
    profile: {
      userId: session.userid,
      nickname: nextSession.nickname || `KG ${session.userid}`,
      avatarUrl: nextSession.avatar || "",
      isVip,
      vipLevel: Number(nextSession.vip_type || 0),
    },
  };
};

export default user_detail;
