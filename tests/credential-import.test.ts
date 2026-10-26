/**
 * 平台凭据调试导入机制单元测试
 *
 * 验证：
 * - 门禁关闭时执行空操作并立即返回；
 * - 门禁开启时 Filesystem 打桩：
 *   1. 正常导入：校验 sessionStore 完整落库与凭据文件删除语义；
 *   2. 坏 JSON：解析异常拦截，不落库且不删除文件；
 *   3. 字段缺失：必备键校验拦截，不落库且不删除文件；
 *   4. 读失败：底层异常静默降级，不阻断应用执行。
 *
 * @author Hackerdallas
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  CREDENTIAL_FILE_NAME,
  executeCredentialImport,
  importDebugCredentials,
  type FilesystemAdapter,
} from "../src/utils/platform/credentialImport";
import {
  clearSessionCookies,
  getSessionCookies,
} from "../src/utils/platform/sessionStore";

/** QQ 音乐完整测试凭据字典（17 键，全假数据） */
const createMockQQMusicCookies = (): Record<string, string> => ({
  euin: "mock_euin",
  p_skey: "mock_pskey",
  p_uin: "mock_puin",
  psrf_access_token_expiresAt: "1893456000000",
  psrf_musickey_createtime: "1700000000",
  psrf_qqaccess_token: "mock_token",
  psrf_qqopenid: "mock_openid",
  psrf_qqrefresh_token: "mock_refresh_token",
  psrf_qqunionid: "mock_unionid",
  pt4_token: "mock_pt4",
  qm_key_expires_in: "2592000",
  qm_keyst: "mock_keyst",
  qm_refresh_key: "mock_refresh_key",
  qm_str_musicid: "10001",
  qqmusic_key: "mock_qqmusic_key",
  tmeLoginType: "2",
  uin: "10001",
});

/** 酷狗音乐完整测试凭据字典（8 键，全假数据） */
const createMockKugouCookies = (): Record<string, string> => ({
  avatar: "https://example.com/avatar.jpg",
  dfid: "mock_dfid",
  guid: "mock_guid",
  nickname: "mock_user",
  token: "mock_kugou_token",
  userid: "20002",
  vip_token: "mock_vip_token",
  vip_type: "6",
});

describe("平台凭据导入模块 credentialImport", () => {
  beforeEach(() => {
    clearSessionCookies("qqmusic");
    clearSessionCookies("kugou");
  });

  describe("门禁关闭语义", () => {
    it("门禁未开启时执行空操作并返回 false，不触发文件读取与写入", async () => {
      let readCalled = false;
      let deleteCalled = false;

      const mockAdapter: FilesystemAdapter = {
        async readFile() {
          readCalled = true;
          return { data: JSON.stringify({ qqmusic: createMockQQMusicCookies() }) };
        },
        async deleteFile() {
          deleteCalled = true;
        },
      };

      const result = await importDebugCredentials(mockAdapter);

      assert.equal(result, false);
      assert.equal(readCalled, false);
      assert.equal(deleteCalled, false);
      assert.deepEqual(getSessionCookies("qqmusic"), {});
      assert.deepEqual(getSessionCookies("kugou"), {});
    });
  });

  describe("门禁开启下文件系统打桩测试", () => {
    it("1. 正常导入：校验 sessionStore 完整落库与凭据文件删除语义", async () => {
      const mockQQ = createMockQQMusicCookies();
      const mockKugou = createMockKugouCookies();
      const mockPayload = {
        exportedAt: 1700000000000,
        qqmusic: mockQQ,
        kugou: mockKugou,
      };

      let readFileOptions: { path: string; directory?: any } | null = null;
      let deletedFileOptions: { path: string; directory?: any } | null = null;

      const mockAdapter: FilesystemAdapter = {
        async readFile(options) {
          readFileOptions = options;
          return { data: JSON.stringify(mockPayload) };
        },
        async deleteFile(options) {
          deletedFileOptions = options;
        },
      };

      const result = await executeCredentialImport(mockAdapter);

      assert.equal(result, true);
      assert.ok(readFileOptions);
      assert.equal((readFileOptions as any).path, CREDENTIAL_FILE_NAME);

      // 验证 QQ 音乐 17 键全部正确存入影子库
      const savedQQ = getSessionCookies("qqmusic");
      assert.equal(savedQQ.uin, "10001");
      assert.equal(savedQQ.qm_keyst, "mock_keyst");
      assert.equal(savedQQ.qm_refresh_key, "mock_refresh_key");
      assert.equal(Object.keys(savedQQ).length, 17);

      // 验证 酷狗 8 键全部正确存入影子库
      const savedKugou = getSessionCookies("kugou");
      assert.equal(savedKugou.userid, "20002");
      assert.equal(savedKugou.token, "mock_kugou_token");
      assert.equal(Object.keys(savedKugou).length, 8);

      // 验证凭据文件删除调用
      assert.ok(deletedFileOptions);
      assert.equal((deletedFileOptions as any).path, CREDENTIAL_FILE_NAME);
    });

    it("2. 坏 JSON：解析异常拦截，不落库且不删除文件", async () => {
      let deleteCalled = false;

      const mockAdapter: FilesystemAdapter = {
        async readFile() {
          return { data: "{ bad-json-format-without-closing-brackets" };
        },
        async deleteFile() {
          deleteCalled = true;
        },
      };

      const result = await executeCredentialImport(mockAdapter);

      assert.equal(result, false);
      assert.equal(deleteCalled, false);
      assert.deepEqual(getSessionCookies("qqmusic"), {});
      assert.deepEqual(getSessionCookies("kugou"), {});
    });

    it("3. 字段缺失：必备键校验拦截，不落库且不删除文件", async () => {
      let deleteCalled = false;

      // 构造缺少 uin 和 qm_keyst 的非法 QQ 音乐凭据
      const incompleteQQ: Record<string, string> = createMockQQMusicCookies();
      delete incompleteQQ.uin;
      delete incompleteQQ.qm_keyst;

      const mockAdapter: FilesystemAdapter = {
        async readFile() {
          return {
            data: JSON.stringify({
              exportedAt: 1700000000000,
              qqmusic: incompleteQQ,
            }),
          };
        },
        async deleteFile() {
          deleteCalled = true;
        },
      };

      const result = await executeCredentialImport(mockAdapter);

      assert.equal(result, false);
      assert.equal(deleteCalled, false);
      assert.deepEqual(getSessionCookies("qqmusic"), {});
    });

    it("4. 读失败：底层异常静默降级，不抛出异常打断启动", async () => {
      let deleteCalled = false;

      const mockAdapter: FilesystemAdapter = {
        async readFile() {
          throw new Error("File does not exist: ENOENT");
        },
        async deleteFile() {
          deleteCalled = true;
        },
      };

      // 验证静默降级（不向外抛出异常）
      const result = await executeCredentialImport(mockAdapter);

      assert.equal(result, false);
      assert.equal(deleteCalled, false);
      assert.deepEqual(getSessionCookies("qqmusic"), {});
      assert.deepEqual(getSessionCookies("kugou"), {});
    });
  });
});
