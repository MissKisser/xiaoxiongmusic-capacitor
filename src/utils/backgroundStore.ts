import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { useSettingStore } from "@/stores";

/** 背景图存储目录名（相对 Directory.Data） */
export const BACKGROUND_DIR_NAME = "background";

/** 背景图二进制文件名（内容为 base64 编码的图片数据） */
export const BACKGROUND_FILE_NAME = "global-bg";

/** 背景图元信息文件名（JSON，记录 MIME 类型） */
export const BACKGROUND_META_FILE_NAME = "global-bg.json";

/** 背景图默认 MIME 类型 */
export const DEFAULT_BACKGROUND_MIME = "image/png";

/**
 * 背景图元信息结构
 */
export interface BackgroundMeta {
  /** 图片 MIME 类型 */
  mime: string;
}

/**
 * 背景图保存结果
 */
export interface BackgroundSaveResult {
  /** 图片在应用数据目录内的相对路径 */
  path: string;
  /** 图片 MIME 类型 */
  mime: string;
  /** 可直接用于渲染的 data URL */
  dataUrl: string;
}

/**
 * 背景图持久化所依赖的最小文件系统接口（便于单测注入桩实现）
 */
export interface BackgroundFileSystemLike {
  /** 创建目录 */
  mkdir(options: { path: string; directory: Directory; recursive?: boolean }): Promise<void>;
  /** 写入文件 */
  writeFile(options: {
    path: string;
    directory: Directory;
    data: string;
    encoding?: Encoding;
  }): Promise<void>;
  /** 读取文件 */
  readFile(options: {
    path: string;
    directory: Directory;
    encoding?: Encoding;
  }): Promise<{ data: string }>;
  /** 删除文件 */
  deleteFile(options: { path: string; directory: Directory }): Promise<void>;
}

/**
 * 背景图持久化状态同步钩子（默认写入设置 store，单测可注入桩实现）
 */
export interface BackgroundStateSync {
  /** 背景图保存成功后回调（回填内存渲染数据并置持久化标志） */
  onSaved(dataUrl: string, mime: string): void;
  /** 启动回填成功后回调（仅回填内存渲染数据，不改变持久化标志） */
  onRestored(dataUrl: string): void;
  /** 背景图清理成功后回调（清空内存渲染数据并清除持久化标志） */
  onCleared(): void;
}

/**
 * 背景图文件在应用数据目录内的相对路径
 * @returns 形如 "background/global-bg" 的路径
 */
export const getBackgroundFilePath = (): string => `${BACKGROUND_DIR_NAME}/${BACKGROUND_FILE_NAME}`;

/**
 * 背景图元信息文件在应用数据目录内的相对路径
 * @returns 形如 "background/global-bg.json" 的路径
 */
export const getBackgroundMetaFilePath = (): string =>
  `${BACKGROUND_DIR_NAME}/${BACKGROUND_META_FILE_NAME}`;

/**
 * 由 base64 数据与 MIME 类型组装 data URL
 * @param base64 base64 编码的图片数据
 * @param mime 图片 MIME 类型（缺省回退为 image/png）
 * @returns data URL 字符串
 */
export const buildBackgroundDataUrl = (base64: string, mime: string): string =>
  `data:${mime || DEFAULT_BACKGROUND_MIME};base64,${base64}`;

/**
 * 解析 data URL，拆分出 MIME 类型与 base64 载荷
 * @param dataUrl data URL 字符串
 * @returns 解析失败返回 null
 */
export const parseBackgroundDataUrl = (
  dataUrl: string,
): { mime: string; base64: string } | null => {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
};

/** 当前文件系统适配器（默认为 @capacitor/filesystem，测试可注入桩实现） */
let backgroundFs: BackgroundFileSystemLike = Filesystem as unknown as BackgroundFileSystemLike;

/**
 * 替换文件系统适配器（传入 null 恢复默认实现）
 * @param adapter 桩实现或 null
 */
export const setBackgroundFileSystem = (adapter: BackgroundFileSystemLike | null): void => {
  backgroundFs = adapter ?? (Filesystem as unknown as BackgroundFileSystemLike);
};

/** 默认状态同步：写入设置 store 的内存渲染数据与持久化标志 */
const defaultStateSync: BackgroundStateSync = {
  onSaved: (dataUrl) => {
    const settingStore = useSettingStore();
    settingStore.globalBackgroundImage = dataUrl;
    settingStore.globalBackgroundSaved = true;
  },
  onRestored: (dataUrl) => {
    useSettingStore().globalBackgroundImage = dataUrl;
  },
  onCleared: () => {
    const settingStore = useSettingStore();
    settingStore.globalBackgroundImage = null;
    settingStore.globalBackgroundSaved = false;
  },
};

/** 当前状态同步钩子（测试可注入桩实现） */
let stateSync: BackgroundStateSync = defaultStateSync;

/**
 * 替换状态同步钩子（传入 null 恢复默认实现）
 * @param sync 钩子实现或 null
 */
export const setBackgroundStateSync = (sync: BackgroundStateSync | null): void => {
  stateSync = sync ?? defaultStateSync;
};

/**
 * 将字节数据编码为 base64（分块拼接，避免大图触发调用栈上限）
 * @param bytes 原始字节数据
 * @returns base64 字符串
 */
const encodeBytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

/**
 * 规整输入图片为 base64 载荷与 MIME 类型
 * @param image data URL 字符串、裸 base64 字符串或原始字节
 * @param mime 显式指定的 MIME 类型（输入为 data URL 时以其为准）
 * @returns base64 载荷与 MIME 类型
 */
const normalizeImageInput = (
  image: string | Uint8Array | ArrayBuffer,
  mime: string,
): { base64: string; mime: string } => {
  if (typeof image === "string") {
    const parsed = parseBackgroundDataUrl(image);
    if (parsed) return parsed;
    return { base64: image, mime: mime || DEFAULT_BACKGROUND_MIME };
  }
  const bytes = image instanceof Uint8Array ? image : new Uint8Array(image);
  return { base64: encodeBytesToBase64(bytes), mime: mime || DEFAULT_BACKGROUND_MIME };
};

/**
 * 保存全局背景图到应用数据目录（Directory.Data）
 * 写入背景图二进制文件与 MIME 元信息文件，并同步设置 store
 * @param image 图片数据（data URL / 裸 base64 / 字节）
 * @param mime 图片 MIME 类型（输入为 data URL 时以其为准）
 * @returns 保存结果（路径、MIME、data URL）
 */
export const saveGlobalBackground = async (
  image: string | Uint8Array | ArrayBuffer,
  mime = DEFAULT_BACKGROUND_MIME,
): Promise<BackgroundSaveResult> => {
  const { base64, mime: resolvedMime } = normalizeImageInput(image, mime);
  // 目录已存在时创建目录会报错（重复设置背景图场景），此处忽略并交由写入结果判定成败
  try {
    await backgroundFs.mkdir({
      path: BACKGROUND_DIR_NAME,
      directory: Directory.Data,
      recursive: true,
    });
  } catch {
    // 目录已存在属正常情况
  }
  await backgroundFs.writeFile({
    path: getBackgroundFilePath(),
    directory: Directory.Data,
    data: base64,
  });
  await backgroundFs.writeFile({
    path: getBackgroundMetaFilePath(),
    directory: Directory.Data,
    data: JSON.stringify({ mime: resolvedMime } satisfies BackgroundMeta),
    encoding: Encoding.UTF8,
  });
  const dataUrl = buildBackgroundDataUrl(base64, resolvedMime);
  stateSync.onSaved(dataUrl, resolvedMime);
  return { path: getBackgroundFilePath(), mime: resolvedMime, dataUrl };
};

/**
 * 从应用数据目录读取全局背景图（纯读取，不触碰设置 store）
 * @returns 可直接用于渲染的 data URL；未存储或读取失败返回 null
 */
export const loadGlobalBackground = async (): Promise<string | null> => {
  try {
    const meta = await backgroundFs.readFile({
      path: getBackgroundMetaFilePath(),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const parsedMeta = JSON.parse(meta.data) as Partial<BackgroundMeta>;
    const image = await backgroundFs.readFile({
      path: getBackgroundFilePath(),
      directory: Directory.Data,
    });
    return buildBackgroundDataUrl(image.data, parsedMeta.mime ?? DEFAULT_BACKGROUND_MIME);
  } catch {
    return null;
  }
};

/**
 * 启动回填：读取持久化背景图并回填设置 store 的内存渲染数据
 * 不改变 globalBackgroundSaved 标志（标志由保存/清理流程维护）
 * @returns 回填的 data URL；未存储或读取失败返回 null（此时清空内存渲染数据）
 */
export const restoreGlobalBackground = async (): Promise<string | null> => {
  const dataUrl = await loadGlobalBackground();
  if (dataUrl) {
    stateSync.onRestored(dataUrl);
  } else {
    stateSync.onCleared();
  }
  return dataUrl;
};

/**
 * 清理全局背景图：删除背景图与元信息文件并同步设置 store
 * 单个文件删除失败不阻断另一文件的清理
 */
export const clearGlobalBackground = async (): Promise<void> => {
  const results = await Promise.allSettled([
    backgroundFs.deleteFile({ path: getBackgroundFilePath(), directory: Directory.Data }),
    backgroundFs.deleteFile({ path: getBackgroundMetaFilePath(), directory: Directory.Data }),
  ]);
  // 文件不存在的删除报错视为已清理完成；仅真正的 IO 故障才跳过状态同步
  const tolerable = (reason: unknown): boolean => {
    const text = String((reason as Error)?.message ?? reason).toLowerCase();
    return text.includes("not exist") || text.includes("no such") || text.includes("enoent");
  };
  const cleaned = results.every(
    (result) => result.status === "fulfilled" || tolerable(result.reason),
  );
  if (cleaned) {
    stateSync.onCleared();
  }
};
