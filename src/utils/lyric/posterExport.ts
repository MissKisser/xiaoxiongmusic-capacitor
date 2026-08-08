/**
 * 歌词海报导出 / 分享（移动端）
 *
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 *
 * 上游桌面端通过 `window.api.system.saveFile` 落盘；
 * 移动端改为 Capacitor Filesystem 写入应用外部目录，
 * 并优先调用系统分享面板（Share 插件存在时），否则回退到 FileOpener 预览。
 */

import type { LyricPosterOptions } from "./poster";
import { createLyricPoster } from "./poster";
import { isCapacitor } from "@/utils/env";
import { Capacitor } from "@capacitor/core";
import { saveAs } from "file-saver";

/** 海报存放目录（应用外部私有目录，无需存储权限） */
const POSTER_DIR = "lyric-poster";

/** 导出结果 */
export interface LyricPosterExportResult {
  /** 是否成功 */
  success: boolean;
  /** 文件名 */
  fileName: string;
  /** 原生文件 URI（仅 Capacitor） */
  uri?: string;
  /** 后续动作：shared 已调起分享面板 / opened 已调起预览 / downloaded 浏览器下载 */
  action?: "shared" | "opened" | "downloaded";
  /** 失败信息 */
  message?: string;
}

/** 去掉文件名中的非法字符 */
const safeFileName = (name: string): string =>
  name
    .replace(/[\\/:*?"<>|\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "lyric";

/** Blob 转 base64（不含 dataURL 前缀） */
const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * 调起系统分享面板
 * `@capacitor/share` 为可选依赖，未安装时通过运行时探测跳过（不产生打包依赖）
 */
const tryShareFile = async (uri: string, title: string): Promise<boolean> => {
  try {
    const share = (Capacitor as any)?.Plugins?.Share;
    if (!share?.share) return false;
    if (typeof share.canShare === "function") {
      const res = await share.canShare();
      if (res && res.value === false) return false;
    }
    await share.share({ title, text: title, files: [uri], dialogTitle: "分享歌词图片" });
    return true;
  } catch (error) {
    console.warn("[LyricPoster] 系统分享失败，回退到本地预览", error);
    return false;
  }
};

/** 调起系统预览（图片查看器内通常也可再次分享） */
const tryOpenFile = async (uri: string): Promise<boolean> => {
  try {
    const { FileOpener } = await import("@capacitor-community/file-opener");
    await FileOpener.open({ filePath: uri, contentType: "image/png" });
    return true;
  } catch (error) {
    console.warn("[LyricPoster] 打开图片失败", error);
    return false;
  }
};

/**
 * 生成歌词海报并保存 / 分享
 * @param options 海报参数（歌名、歌手、封面、歌词行）
 * @returns 导出结果
 */
export const exportLyricPoster = async (
  options: LyricPosterOptions,
): Promise<LyricPosterExportResult> => {
  const fileName = `${safeFileName(`${options.title} - ${options.artist} - 歌词`)}.png`;
  try {
    const blob = await createLyricPoster(options);

    // Web / 浏览器调试：直接下载
    if (!isCapacitor) {
      saveAs(blob, fileName);
      return { success: true, fileName, action: "downloaded" };
    }

    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const base64 = await blobToBase64(blob);
    const path = `${POSTER_DIR}/${fileName}`;
    const written = await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.External,
      recursive: true,
    });
    const uri = written.uri;

    // 优先分享，失败回退预览
    const shared = await tryShareFile(uri, `${options.title} - ${options.artist}`);
    if (shared) return { success: true, fileName, uri, action: "shared" };
    const opened = await tryOpenFile(uri);
    return { success: true, fileName, uri, action: opened ? "opened" : undefined };
  } catch (error) {
    console.error("[LyricPoster] 导出失败", error);
    return {
      success: false,
      fileName,
      message: error instanceof Error ? error.message : "导出图片失败",
    };
  }
};
