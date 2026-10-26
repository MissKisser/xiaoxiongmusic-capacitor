import { registerPlugin } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { isCapacitor } from "@/utils/env";

interface MediaSavePlugin {
  saveImageToGallery(options: {
    base64: string;
    fileName: string;
  }): Promise<{ uri: string }>;
}

const MediaSave = registerPlugin<MediaSavePlugin>("MediaSave");

export interface SaveImageOptions {
  /** 纯 base64 字符串或包含 Data URL 前缀的图像数据 */
  base64: string;
  /** 保存的目标文件名 */
  fileName: string;
}

/**
 * 保存图片到系统相册
 *
 * 优先调用 Capacitor 原生 MediaSave 插件写入系统相册（MediaStore.Images）；
 * 原生插件不可用或写入失败时，降级写入 Directory.Documents 并提示路径；
 * Web 浏览器环境下，降级为模拟超链接下载。
 *
 * @param options 图片数据与目标文件名
 * @returns 是否保存成功
 */
export async function saveImageToGallery(options: SaveImageOptions): Promise<boolean> {
  const { base64, fileName } = options;
  if (!base64) {
    window.$message.error("无法读取二维码图像");
    return false;
  }

  // 统一剥离 Data URL 头部前缀
  const commaIdx = base64.indexOf(",");
  const cleanBase64 = commaIdx >= 0 ? base64.slice(commaIdx + 1) : base64;

  if (isCapacitor) {
    try {
      // 1. 优先调用原生 MediaSave 插件写入系统相册
      const res = await MediaSave.saveImageToGallery({
        base64: cleanBase64,
        fileName,
      });
      if (res && res.uri) {
        window.$message.success("二维码已保存到系统相册");
        return true;
      }
      throw new Error("原生相册保存未返回有效 URI");
    } catch (pluginErr) {
      console.warn("保存到系统相册失败，降级保存到文档目录:", pluginErr);
      // 2. 原生失败降级保存到 Directory.Documents
      try {
        const docRes = await Filesystem.writeFile({
          path: fileName,
          data: cleanBase64,
          directory: Directory.Documents,
        });
        const uri = docRes?.uri || fileName;
        window.$message.info(`已保存到文档目录: ${uri}`);
        return true;
      } catch (fallbackErr) {
        console.error("保存到文档目录失败:", fallbackErr);
        window.$message.error("保存失败，请检查存储权限");
        return false;
      }
    }
  } else {
    // 3. Web 环境模拟下载
    try {
      const a = document.createElement("a");
      a.href = `data:image/png;base64,${cleanBase64}`;
      a.download = fileName;
      a.click();
      window.$message.success("二维码已下载");
      return true;
    } catch (webErr) {
      console.error("Web 下载二维码失败:", webErr);
      window.$message.error("保存二维码失败");
      return false;
    }
  }
}
