/**
 * 调试期第三方音源平台凭据导入模块
 *
 * 仅在调试构建（VITE_CRED_IMPORT === "true"）下激活。
 * 生产发布构建下经编译期门禁判定为 false，整段导入逻辑与相关文件名字符串
 * 均被打包器 Dead Code Elimination 彻底剔除，杜绝生产后门。
 *
 * 运行时从外部存储目录读取 xiaoxiong-cred.json，完成结构校验后
 * 写入 platform_session 影子库，并于导入成功后清理该凭据文件。
 * 全程严格遵循零泄露原则，日志仅输出平台名称与键名清单，禁止打印凭据值。
 *
 * @author Hackerdallas
 */

import { saveSessionCookies } from "./sessionStore";

/** 目标调试凭据文件名 */
export const CREDENTIAL_FILE_NAME = "xiaoxiong-cred.json";

/** QQ 音乐必备 17 个会话键名 */
export const QQMUSIC_REQUIRED_KEYS = [
  "euin",
  "p_skey",
  "p_uin",
  "psrf_access_token_expiresAt",
  "psrf_musickey_createtime",
  "psrf_qqaccess_token",
  "psrf_qqopenid",
  "psrf_qqrefresh_token",
  "psrf_qqunionid",
  "pt4_token",
  "qm_key_expires_in",
  "qm_keyst",
  "qm_refresh_key",
  "qm_str_musicid",
  "qqmusic_key",
  "tmeLoginType",
  "uin",
] as const;

/** 酷狗音乐必备 8 个会话键名 */
export const KUGOU_REQUIRED_KEYS = [
  "avatar",
  "dfid",
  "guid",
  "nickname",
  "token",
  "userid",
  "vip_token",
  "vip_type",
] as const;

/** 文件系统适配器接口（便于单测打桩与原生解耦） */
export interface FilesystemAdapter {
  /**
   * 读取文件内容
   * @param options 读取选项
   */
  readFile(options: {
    path: string;
    directory?: any;
    encoding?: any;
  }): Promise<{ data: string | Blob }>;

  /**
   * 删除文件
   * @param options 删除选项
   */
  deleteFile(options: {
    path: string;
    directory?: any;
  }): Promise<void>;
}

/** 导出的凭据载荷结构 */
export interface CredentialPayload {
  exportedAt?: number;
  qqmusic?: Record<string, string>;
  kugou?: Record<string, string>;
}

/**
 * 校验指定平台的凭据字典是否满足必备键要求
 * @param platform 平台标识
 * @param cookies 平台 Cookie 字典
 * @param requiredKeys 必需键列表
 * @returns 校验是否通过
 */
const validatePlatformKeys = (
  platform: string,
  cookies: unknown,
  requiredKeys: readonly string[],
): boolean => {
  if (!cookies || typeof cookies !== "object" || Array.isArray(cookies)) {
    console.warn(`[CredentialImport] 平台 ${platform} 凭据格式不正确（非对象）`);
    return false;
  }

  const cookieRecord = cookies as Record<string, unknown>;
  const missingKeys = requiredKeys.filter((key) => !(key in cookieRecord));

  if (missingKeys.length > 0) {
    console.warn(
      `[CredentialImport] 平台 ${platform} 缺少必备键名: ${missingKeys.join(", ")}`,
    );
    return false;
  }

  return true;
};

/**
 * 执行凭据导入核心处理逻辑
 * 支持注入自定义文件系统适配器以供单元测试打桩
 * @param adapter 可选的文件系统适配器
 * @returns 导入是否成功并完成落库与清理
 */
export const executeCredentialImport = async (
  adapter?: FilesystemAdapter,
): Promise<boolean> => {
  try {
    let fs: FilesystemAdapter;
    let targetDirectory: any;
    let utf8Encoding: any;

    if (adapter) {
      fs = adapter;
      targetDirectory = "EXTERNAL";
      utf8Encoding = "utf8";
    } else {
      const { Filesystem, Directory, Encoding } = await import(
        "@capacitor/filesystem"
      );
      fs = Filesystem;
      targetDirectory = Directory.External;
      utf8Encoding = Encoding.UTF8;
    }

    // 尝试读取外部存储目录下的凭据文件
    let fileResult: { data: string | Blob };
    try {
      fileResult = await fs.readFile({
        path: CREDENTIAL_FILE_NAME,
        directory: targetDirectory,
        encoding: utf8Encoding,
      });
    } catch {
      // 常见情况：文件不存在或无法访问，静默返回无需打断启动
      return false;
    }

    let rawContent: string;
    if (typeof fileResult.data === "string") {
      rawContent = fileResult.data;
    } else if (fileResult.data instanceof Blob) {
      rawContent = await fileResult.data.text();
    } else {
      console.warn("[CredentialImport] 凭据文件数据类型非文本，跳过导入");
      return false;
    }

    // 解析 JSON 内容
    let payload: CredentialPayload;
    try {
      payload = JSON.parse(rawContent);
    } catch {
      console.warn("[CredentialImport] 凭据文件 JSON 解析失败，跳过导入");
      return false;
    }

    if (!payload || typeof payload !== "object") {
      console.warn("[CredentialImport] 凭据根结构非有效对象，跳过导入");
      return false;
    }

    const hasQQ = Boolean(payload.qqmusic);
    const hasKugou = Boolean(payload.kugou);

    if (!hasQQ && !hasKugou) {
      console.warn("[CredentialImport] 凭据文件中未包含 qqmusic 或 kugou 节点，跳过导入");
      return false;
    }

    // 结构校验：若包含该平台，则必备字段必须齐全
    if (hasQQ && !validatePlatformKeys("qqmusic", payload.qqmusic, QQMUSIC_REQUIRED_KEYS)) {
      return false;
    }

    if (hasKugou && !validatePlatformKeys("kugou", payload.kugou, KUGOU_REQUIRED_KEYS)) {
      return false;
    }

    // 校验通过，逐平台持久化到会话影子库
    if (hasQQ && payload.qqmusic) {
      saveSessionCookies("qqmusic", payload.qqmusic);
      console.log(
        `[CredentialImport] 平台 qqmusic 导入成功，包含键: ${Object.keys(payload.qqmusic).sort().join(", ")}`,
      );
    }

    if (hasKugou && payload.kugou) {
      saveSessionCookies("kugou", payload.kugou);
      console.log(
        `[CredentialImport] 平台 kugou 导入成功，包含键: ${Object.keys(payload.kugou).sort().join(", ")}`,
      );
    }

    // 成功落库后清理凭据文件，避免残留
    try {
      await fs.deleteFile({
        path: CREDENTIAL_FILE_NAME,
        directory: targetDirectory,
      });
      console.log("[CredentialImport] 调试凭据文件已成功清理");
    } catch (deleteError) {
      console.warn("[CredentialImport] 凭据文件清理失败:", deleteError);
    }

    return true;
  } catch (error) {
    // 捕获全部未预料异常，静默降级不打断启动
    console.warn("[CredentialImport] 凭据导入过程异常降级:", error);
    return false;
  }
};

/**
 * 带有编译期门禁的调试凭据导入对外入口
 * 仅在 VITE_CRED_IMPORT === "true" 时包含导入逻辑，生产构建下为空操作
 * @param adapter 可选的文件系统适配器
 * @returns 导入结果
 */
export const importDebugCredentials = async (
  adapter?: FilesystemAdapter,
): Promise<boolean> => {
  if (
    typeof import.meta.env === "undefined" ||
    import.meta.env.VITE_CRED_IMPORT !== "true"
  ) {
    return false;
  }
  return await executeCredentialImport(adapter);
};
