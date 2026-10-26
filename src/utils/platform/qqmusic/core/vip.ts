/**
 * QQ 音乐会员状态解析
 *
 * @author Hackerdallas
 */

/** QQ 音乐会员身份标识字段 */
interface QQMusicVipIdentity {
  vip?: number;
  HugeVip?: number;
  huge_vip?: number;
  ExpVip?: number;
  exp_vip?: number;
  GroupVipFlag?: number;
  group_vip_flag?: number;
  CPLoverFlag?: number;
  cp_lover_flag?: number;
  level?: number;
}

/** 会员基础接口返回结构 */
export interface QQMusicVipData {
  svip?: number;
  identity?: QQMusicVipIdentity;
  userinfo?: {
    music_level?: number;
  };
}

/**
 * 将会员接口响应归一为 VIP 状态与等级
 * @param data vip_login_base 响应数据
 * @returns 统一的会员状态
 */
export const normalizeQQMusicVip = (
  data: QQMusicVipData | null,
): { isVip: boolean; vipLevel: number } => {
  const identity = data?.identity;
  const flags = [
    data?.svip,
    identity?.vip,
    identity?.HugeVip,
    identity?.huge_vip,
    identity?.ExpVip,
    identity?.exp_vip,
    identity?.GroupVipFlag,
    identity?.group_vip_flag,
    identity?.CPLoverFlag,
    identity?.cp_lover_flag,
  ];
  return {
    isVip: flags.some((value) => Number(value) > 0),
    vipLevel: Number(identity?.level || data?.userinfo?.music_level || 0),
  };
};
