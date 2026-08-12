/**
 * 敏感信息脱敏工具
 * 用于日志输出时隐藏授权码、Cookie、Token 等凭据内容
 * 保留首尾 4 个字符，中间以 *** 掩码
 */
export const mask = (v: unknown): string => {
  const s = String(v ?? "");
  if (s.length <= 8) return "***";
  return `${s.slice(0, 4)}***${s.slice(-4)}`;
};
