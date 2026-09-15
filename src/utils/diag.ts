import { isCapacitor } from "@/utils/env";

/**
 * 设备侧诊断日志写入（Capacitor 环境经原生桥写入沙盒 Documents/diag.log，
 * 其余环境静默），用于无 Mac 调试通道的真机问题定位
 * @param line 单行日志内容
 */
export async function diagLog(line: string): Promise<void> {
  if (!isCapacitor) return;
  try {
    const { MusicNotification } = await import("@/plugins/MusicNotificationPlugin");
    await MusicNotification.diag({ line });
  } catch {
    // 诊断写入失败静默
  }
}
