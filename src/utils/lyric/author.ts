/**
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * 歌词作者/来源信息提取
 *
 * 从 SPlayer-Next 的 `src/utils/lyric/author.ts` 移植并适配到 capacitor 端：
 *   - TTML：优先提取 `amll:meta key="ttmlAuthorGithubLogin"`（可直接跳转 GitHub 的账号），
 *     无则从 `ttmlAuthorGithub` 主页链接中截取最后的用户名
 *   - LRC：提取 `[by:xxx]`（LRC 标准制作者标签），无则回退 `[au:xxx]`（部分工具使用的作者标签）
 *
 * 纯字符串解析，不发起任何网络请求。
 */

/**
 * 歌词源格式
 */
export type LyricSourceFormat = "lrc" | "ttml" | "yrc";

/**
 * 从歌词原始内容中提取「歌词文件制作者」列表
 * @param content - 歌词原始文本
 * @param format - 歌词格式
 * @returns 作者账号/名称的数组（无作者信息时返回空数组）
 */
export const extractLyricAuthors = (content: string, format: LyricSourceFormat): string[] => {
  if (format === "ttml") {
    // 优先提取 ttmlAuthorGithubLogin，作为可以直接用于跳转 GitHub 的账号
    const logins = [...content.matchAll(/key="ttmlAuthorGithubLogin"\s+value="([^"]*)"/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    if (logins.length > 0) {
      return Array.from(new Set(logins));
    }
    // 如果无 login 标识，从 ttmlAuthorGithub 主页链接中截取最后的用户名
    const bases = [...content.matchAll(/key="ttmlAuthorGithub"\s+value="([^"]*)"/g)]
      .map((m) => {
        const val = m[1].trim();
        const parts = val.split("/");
        return parts[parts.length - 1] || val;
      })
      .filter(Boolean);
    return Array.from(new Set(bases));
  }
  if (format === "lrc") {
    // 优先 [by:xxx]（LRC 标准制作者标签），无则回退 [au:xxx]
    const match = content.match(/\[by:([^\]]+)\]/i) ?? content.match(/\[au:([^\]]+)\]/i);
    const value = match?.[1]?.trim();
    return value ? [value] : [];
  }
  return [];
};
