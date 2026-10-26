/**
 * QQ 音乐模块内部专用安全日志工具
 *
 * 凭据值（token/key/uin）绝不直接打印，保护用户隐私。
 *
 * @author Hackerdallas
 */

export const coreLog = {
  info: (message: string, ...args: unknown[]) => {
    console.log(`[Platform:QM] ${message}`, ...args);
  },
  warn: (message: string, ...args: unknown[]) => {
    console.warn(`[Platform:QM] ${message}`, ...args);
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(`[Platform:QM] ${message}`, ...args);
  },
};
