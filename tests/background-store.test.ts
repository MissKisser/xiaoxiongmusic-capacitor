/**
 * 全局背景图持久化工具测试（backgroundStore）
 *
 * 文件 IO 与状态同步均使用桩实现，覆盖：
 * - 路径拼装与 data URL 组装/解析；
 * - 保存（data URL / 字节输入）写入背景图文件与 MIME 元信息并同步状态；
 * - 读取与启动回填（含缺文件、读失败）；
 * - 清理（双文件删除、文件不存在容错、真实 IO 故障不同步状态）。
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./helpers/setup";
import {
  BackgroundFileSystemLike,
  BackgroundStateSync,
  BACKGROUND_DIR_NAME,
  buildBackgroundDataUrl,
  clearGlobalBackground,
  getBackgroundFilePath,
  getBackgroundMetaFilePath,
  loadGlobalBackground,
  parseBackgroundDataUrl,
  restoreGlobalBackground,
  saveGlobalBackground,
  setBackgroundFileSystem,
  setBackgroundStateSync,
} from "../src/utils/backgroundStore";

/** 内存文件系统桩：记录全部读写删除调用 */
interface FsStub extends BackgroundFileSystemLike {
  files: Map<string, string>;
  writtenPaths: string[];
  deletedPaths: string[];
  /** 强制 deleteFile 抛出非「不存在」类 IO 错误 */
  failDeleteWithIoError: boolean;
  /** 已创建的目录集合（用于模拟目录已存在时的创建失败） */
  createdDirs: Set<string>;
}

const createFsStub = (): FsStub => {
  const files = new Map<string, string>();
  const stub: FsStub = {
    files,
    writtenPaths: [],
    deletedPaths: [],
    failDeleteWithIoError: false,
    createdDirs: new Set<string>(),
    async mkdir({ path }) {
      // 与真实文件系统一致：目录已存在时创建目录会失败
      if (stub.createdDirs.has(path)) {
        throw new Error(`Directory at '${path}' already exists, cannot be overwritten.`);
      }
      stub.createdDirs.add(path);
    },
    async writeFile({ path, data }) {
      files.set(path, data);
      stub.writtenPaths.push(path);
    },
    async readFile({ path }) {
      if (!files.has(path)) throw new Error("File does not exist");
      return { data: files.get(path)! };
    },
    async deleteFile({ path }) {
      if (stub.failDeleteWithIoError) throw new Error("EIO disk failure");
      if (!files.has(path)) throw new Error("File does not exist");
      files.delete(path);
      stub.deletedPaths.push(path);
    },
  };
  return stub;
};

/** 状态同步桩：记录回调序列 */
const createSyncStub = (): BackgroundStateSync & { events: string[]; savedPayloads: string[] } => {
  const stub = {
    events: [] as string[],
    savedPayloads: [] as string[],
    onSaved(dataUrl: string) {
      stub.events.push("saved");
      stub.savedPayloads.push(dataUrl);
    },
    onRestored() {
      stub.events.push("restored");
    },
    onCleared() {
      stub.events.push("cleared");
    },
  };
  return stub;
};

describe("全局背景图持久化 backgroundStore", () => {
  let fsStub: FsStub;
  let syncStub: ReturnType<typeof createSyncStub>;

  beforeEach(() => {
    fsStub = createFsStub();
    syncStub = createSyncStub();
    setBackgroundFileSystem(fsStub);
    setBackgroundStateSync(syncStub);
  });

  afterEach(() => {
    setBackgroundFileSystem(null);
    setBackgroundStateSync(null);
  });

  describe("路径与 data URL 纯函数", () => {
    it("背景图与元信息路径拼装到 background 目录", () => {
      assert.equal(BACKGROUND_DIR_NAME, "background");
      assert.equal(getBackgroundFilePath(), "background/global-bg");
      assert.equal(getBackgroundMetaFilePath(), "background/global-bg.json");
    });

    it("data URL 组装与解析往返一致", () => {
      const dataUrl = buildBackgroundDataUrl("QUJD", "image/webp");
      assert.equal(dataUrl, "data:image/webp;base64,QUJD");
      assert.deepEqual(parseBackgroundDataUrl(dataUrl), { mime: "image/webp", base64: "QUJD" });
    });

    it("解析非法 data URL 返回 null，MIME 缺省时组装回退 image/png", () => {
      assert.equal(parseBackgroundDataUrl("not-a-data-url"), null);
      assert.equal(buildBackgroundDataUrl("QUJD", ""), "data:image/png;base64,QUJD");
    });
  });

  describe("保存 saveGlobalBackground", () => {
    it("data URL 输入：写入背景图与元信息文件并同步 onSaved", async () => {
      const result = await saveGlobalBackground("data:image/webp;base64,QUJD");
      assert.equal(result.path, "background/global-bg");
      assert.equal(result.mime, "image/webp");
      assert.equal(result.dataUrl, "data:image/webp;base64,QUJD");
      assert.deepEqual(fsStub.writtenPaths, [
        "background/global-bg",
        "background/global-bg.json",
      ]);
      assert.equal(fsStub.files.get("background/global-bg"), "QUJD");
      assert.deepEqual(
        JSON.parse(fsStub.files.get("background/global-bg.json")!),
        { mime: "image/webp" },
      );
      assert.deepEqual(syncStub.events, ["saved"]);
      assert.deepEqual(syncStub.savedPayloads, ["data:image/webp;base64,QUJD"]);
    });

    it("字节输入：编码为 base64 并使用显式 MIME", async () => {
      const bytes = new Uint8Array([65, 66, 67]);
      const result = await saveGlobalBackground(bytes, "image/jpeg");
      assert.equal(result.mime, "image/jpeg");
      assert.equal(fsStub.files.get("background/global-bg"), "QUJD");
      assert.deepEqual(
        JSON.parse(fsStub.files.get("background/global-bg.json")!),
        { mime: "image/jpeg" },
      );
    });

    it("裸 base64 输入：使用传入 MIME（缺省回退 image/png）", async () => {
      const result = await saveGlobalBackground("QUJD");
      assert.equal(result.mime, "image/png");
      assert.equal(result.dataUrl, "data:image/png;base64,QUJD");
    });

    it("目录已存在时重复保存仍能覆盖写入并同步状态", async () => {
      await saveGlobalBackground("data:image/webp;base64,QUJD");
      const second = await saveGlobalBackground("data:image/jpeg;base64,QkJC");
      assert.equal(second.mime, "image/jpeg");
      assert.equal(fsStub.files.get("background/global-bg"), "QkJC");
      assert.deepEqual(
        JSON.parse(fsStub.files.get("background/global-bg.json")!),
        { mime: "image/jpeg" },
      );
      assert.deepEqual(syncStub.events, ["saved", "saved"]);
    });
  });

  describe("读取与回填 loadGlobalBackground / restoreGlobalBackground", () => {
    it("已存储时读取返回 data URL 且不触碰状态同步", async () => {
      fsStub.files.set("background/global-bg", "QUJD");
      fsStub.files.set("background/global-bg.json", JSON.stringify({ mime: "image/webp" }));
      const dataUrl = await loadGlobalBackground();
      assert.equal(dataUrl, "data:image/webp;base64,QUJD");
      assert.deepEqual(syncStub.events, []);
    });

    it("元信息缺失时读取返回 null", async () => {
      fsStub.files.set("background/global-bg", "QUJD");
      assert.equal(await loadGlobalBackground(), null);
    });

    it("回填成功触发 onRestored，未存储触发 onCleared", async () => {
      fsStub.files.set("background/global-bg", "QUJD");
      fsStub.files.set("background/global-bg.json", JSON.stringify({ mime: "image/png" }));
      assert.equal(await restoreGlobalBackground(), "data:image/png;base64,QUJD");
      assert.deepEqual(syncStub.events, ["restored"]);

      fsStub.files.clear();
      assert.equal(await restoreGlobalBackground(), null);
      assert.deepEqual(syncStub.events, ["restored", "cleared"]);
    });
  });

  describe("清理 clearGlobalBackground", () => {
    it("删除背景图与元信息两个文件并触发 onCleared", async () => {
      fsStub.files.set("background/global-bg", "QUJD");
      fsStub.files.set("background/global-bg.json", "{}");
      await clearGlobalBackground();
      assert.equal(fsStub.files.size, 0);
      assert.deepEqual(syncStub.events, ["cleared"]);
    });

    it("文件不存在视为清理完成，仍触发 onCleared", async () => {
      await clearGlobalBackground();
      assert.deepEqual(syncStub.events, ["cleared"]);
    });

    it("真实 IO 故障时跳过状态同步", async () => {
      fsStub.files.set("background/global-bg", "QUJD");
      fsStub.failDeleteWithIoError = true;
      await clearGlobalBackground();
      assert.deepEqual(syncStub.events, []);
    });
  });
});
