/**
 * 酷狗音乐平台内部日志工具
 *
 * 杜绝凭据值（token/key/userid）明文打印，保护隐私。
 *
 * @author Hackerdallas
 */

export const coreLog = {
  info: (message: string, ...args: unknown[]) => {
    console.log(`[Platform:KG] ${message}`, ...args);
  },
  warn: (message: string, ...args: unknown[]) => {
    console.warn(`[Platform:KG] ${message}`, ...args);
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(`[Platform:KG] ${message}`, ...args);
  },
};
