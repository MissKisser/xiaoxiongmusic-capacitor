/**
 * 平台错误文案翻译
 *
 * 平台侧的错误有两套表达：
 * - **业务码**：酷狗把业务码埋在描述里（`error_code=20010`），
 *   通用失败用模块自身的 `code` 表达 —— 写操作与读操作共用；
 * - **播放失败原因**：QQ 音乐用 `reason`（`need_pay` / `no_authorization` /
 *   `filename_rejected` / `vkey_error`），酷狗用 `status`（1 可播 / 2 付费墙 /
 *   3 该账号完全无授权）与 `privilege`；两平台在未登录时都用 `need_login` —— 只出现在播放链路。
 *
 * 这里把两套表达统一翻译成用户可读文案，
 * 写操作层（`manage.ts`）与播放层（`SongManager.ts`）共用同一份翻译表。
 *
 * 用户可见的失败提示只说平台语义（付费 / 无权限 / 暂不可播 / 已尝试换源），
 * 不出现内部音源名与技术细节 —— 换源过程的逐源明细只写控制台日志。
 *
 * @author Hackerdallas
 */

import type { ApiPlatform } from "@/types/shared";

/** 酷狗业务错误码 → 用户可读提示 */
export const KG_ERROR_TEXT: Record<string, string> = {
  "20006": "请求参数不符合平台要求，请重试",
  "20010": "请求参数不符合平台要求，请重试",
  "20017": "登录状态已失效，请重新登录后再试",
  "30203": "平台限制了本次操作，请稍后再试",
};

/** 平台播放失败原因 → 用户可读提示 */
export const PLATFORM_REASON_TEXT: Record<string, string> = {
  need_pay: "该歌曲需要付费，已尝试换源未成功",
  no_authorization: "当前账号没有该歌曲的播放权限，已尝试换源未成功",
  filename_rejected: "该歌曲暂不可播放，已尝试换源未成功",
  vkey_error: "播放凭证获取失败，已尝试换源未成功",
  need_login: "需要登录对应平台账号后才能播放该内容",
};

/** 播放最终失败时的兜底提示 */
export const PLAYBACK_FAILED_TEXT = "该歌曲暂时无法播放，已尝试换源未成功";

/** 酷狗授权位：完全免费可播 */
const KG_PRIVILEGE_FREE = 0;

/** 酷狗授权位：非会员可免费播放（低码率） */
const KG_PRIVILEGE_FREE_FOR_AD = 8;

/**
 * 把平台模块的失败描述翻译成用户可读提示
 *
 * 酷狗的错误码埋在 message 里（形如 `创建歌单失败：error_code=20010`），
 * QQ 与通用失败用模块自身的 `code` 表达。
 * @param platform 音源平台
 * @param code 模块返回码
 * @param message 模块返回描述
 * @returns 用户可读提示，无可识别信息时返回原始描述
 */
export const describeFailure = (
  platform: ApiPlatform,
  code?: number,
  message?: string,
): string | undefined => {
  // 酷狗：先从描述里抽出业务错误码
  if (platform === "kugou") {
    const matched = /error_code=(\d+)/.exec(message ?? "");
    if (matched && KG_ERROR_TEXT[matched[1]]) return KG_ERROR_TEXT[matched[1]];
    const http = /HTTP (\d{3})/.exec(message ?? "");
    if (http) {
      return http[1] === "404"
        ? "平台接口路由不可用，请稍后再试"
        : `平台请求失败（HTTP ${http[1]}），请重试`;
    }
  }
  if (code === 401) return "登录状态已失效，请重新登录后再试";
  if (code === 404) return "未找到目标歌单，或该平台暂未开放此能力";
  if (code === 400) return message || "请求参数不符合平台要求，请重试";
  return message || "操作失败，请重试";
};

/** 播放失败详情 */
export interface PlatformPlaybackFailure {
  /** QQ 音乐失败原因 */
  reason?: string;
  /** 酷狗播放状态：1 可播 / 2 付费墙 / 3 该账号完全无授权 */
  status?: number;
  /** 酷狗资源授权位 */
  privilege?: number | null;
}

/** 带平台标识的播放失败详情 */
export interface PlatformFailure extends PlatformPlaybackFailure {
  /** 音源平台 */
  platform: ApiPlatform;
}

/**
 * 把播放失败详情翻译成用户可读提示
 *
 * @param platform 音源平台
 * @param failure 播放失败详情
 * @returns 用户可读提示
 */
export const describePlaybackFailure = (
  platform: ApiPlatform,
  failure: PlatformPlaybackFailure = {},
): string => {
  const reason = String(failure.reason ?? "");
  if (reason && PLATFORM_REASON_TEXT[reason]) return PLATFORM_REASON_TEXT[reason];
  if (platform === "kugou") {
    if (failure.status === 3) {
      return "当前账号没有该歌曲的播放权限，已尝试换源未成功";
    }
    if (failure.status === 2) {
      return "该歌曲需要付费，已尝试换源未成功";
    }
    const privilege = failure.privilege;
    if (
      privilege !== undefined &&
      privilege !== null &&
      privilege !== KG_PRIVILEGE_FREE &&
      privilege !== KG_PRIVILEGE_FREE_FOR_AD
    ) {
      return "该歌曲需要付费，已尝试换源未成功";
    }
  }
  return PLAYBACK_FAILED_TEXT;
};

/**
 * 汇总播放失败的用户可读提示
 *
 * 用户可见的失败提示一律走平台语义口径（付费 / 无权限 / 暂不可播 / 已尝试换源），
 * 不出现内部音源名与技术细节：
 * - 平台侧失败优先 —— 付费墙、无授权、凭证异常的文案已说明「已尝试换源未成功」；
 * - 其次用本地链路的可操作提示（缺编号 / 缺歌名 / 缺歌手 / 未开启换源）；
 * - 都没有时给出兜底结论。
 *
 * @param platformFailure 平台侧失败详情，没有平台侧记录时传 undefined
 * @param localReason 本地链路的失败原因
 * @returns 用户可读提示
 */
export const resolvePlaybackFailureText = (
  platformFailure?: PlatformFailure,
  localReason?: string,
): string => {
  if (platformFailure) {
    return describePlaybackFailure(platformFailure.platform, platformFailure);
  }
  return localReason || PLAYBACK_FAILED_TEXT;
};
