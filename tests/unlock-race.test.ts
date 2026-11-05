/**
 * 并发换源竞速单测 (utils/unlockRace.ts)
 *
 * 覆盖六块判据：
 * 1. 两个源并发且均会成功：快者胜（慢者后落定不影响胜者）
 * 2. 首源失败、次源成功：次源胜
 * 3. 全部失败：无胜者，failures 按传入顺序聚合且 reason 正确
 * 4. servers 为空数组：立即返回，attempt 从未被调用
 * 5. attempt 意外 reject（包含同步 throw 与异步 reject）：被兜底归一为失败，不产生 unhandled rejection，其余源仍可取胜
 * 6. attempt 调用次序严格等于传入数组次序
 */

import "./helpers/setup";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SongUnlockServer } from "../src/types/shared";
import { raceUnlockSources, type UnlockAttempt } from "../src/utils/unlockRace";

/** 延时辅助函数 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("并发换源竞速 raceUnlockSources", () => {
  it("两个源并发且均会成功：快者胜（慢者后落定不影响胜者）", async () => {
    const servers = [SongUnlockServer.KUWO, SongUnlockServer.BODIAN];
    let kuwoFinished = false;

    const result = await raceUnlockSources(servers, async (server): Promise<UnlockAttempt<string>> => {
      if (server === SongUnlockServer.KUWO) {
        await sleep(50);
        kuwoFinished = true;
        return {
          ok: true,
          server,
          durationMs: 50,
          value: "https://kuwo.example.com/audio.mp3",
        };
      }
      if (server === SongUnlockServer.BODIAN) {
        await sleep(10);
        return {
          ok: true,
          server,
          durationMs: 10,
          value: "https://bodian.example.com/audio.mp3",
        };
      }
      return {
        ok: false,
        server,
        durationMs: 0,
        reason: "未知源",
      };
    });

    assert.equal(result.winner?.server, SongUnlockServer.BODIAN);
    assert.equal(result.winner?.value, "https://bodian.example.com/audio.mp3");
    assert.equal(result.winner?.durationMs, 10);
    assert.deepEqual(result.failures, []);

    // 此时慢者尚在执行中
    assert.equal(kuwoFinished, false);
    // 等待慢者落定，确认不产生异常
    await sleep(60);
    assert.equal(kuwoFinished, true);
  });

  it("首源失败、次源成功：次源胜", async () => {
    const servers = [SongUnlockServer.KUWO, SongUnlockServer.BODIAN];

    const result = await raceUnlockSources(servers, async (server): Promise<UnlockAttempt<string>> => {
      if (server === SongUnlockServer.KUWO) {
        await sleep(10);
        return {
          ok: false,
          server,
          durationMs: 10,
          reason: "酷我版权下架",
        };
      }
      if (server === SongUnlockServer.BODIAN) {
        await sleep(25);
        return {
          ok: true,
          server,
          durationMs: 25,
          value: "https://bodian.example.com/audio.mp3",
        };
      }
      return {
        ok: false,
        server,
        durationMs: 0,
        reason: "未知源",
      };
    });

    assert.equal(result.winner?.server, SongUnlockServer.BODIAN);
    assert.equal(result.winner?.value, "https://bodian.example.com/audio.mp3");
  });

  it("全部失败：无胜者，failures 按传入顺序聚合且 reason 正确", async () => {
    const servers = [
      SongUnlockServer.XINGHAI,
      SongUnlockServer.FISH,
      SongUnlockServer.JIEXIANG,
    ];

    const result = await raceUnlockSources(servers, async (server): Promise<UnlockAttempt<string>> => {
      // 故意让中间的 FISH 最晚失败，验证 failures 是否按 servers 传入顺序而非完成顺序返回
      const delay =
        server === SongUnlockServer.FISH
          ? 30
          : server === SongUnlockServer.XINGHAI
            ? 20
            : 10;
      await sleep(delay);
      return {
        ok: false,
        server,
        durationMs: delay,
        reason: `${server} 匹配失败`,
      };
    });

    assert.equal(result.winner, undefined);
    assert.equal(result.failures.length, 3);
    assert.deepEqual(result.failures, [
      { server: SongUnlockServer.XINGHAI, reason: `${SongUnlockServer.XINGHAI} 匹配失败` },
      { server: SongUnlockServer.FISH, reason: `${SongUnlockServer.FISH} 匹配失败` },
      { server: SongUnlockServer.JIEXIANG, reason: `${SongUnlockServer.JIEXIANG} 匹配失败` },
    ]);
  });

  it("servers 为空数组：立即返回，attempt 从未被调用", async () => {
    let callCount = 0;
    const result = await raceUnlockSources([], async (server) => {
      callCount++;
      return {
        ok: true,
        server,
        durationMs: 0,
        value: "test",
      };
    });

    assert.equal(callCount, 0);
    assert.equal(result.winner, undefined);
    assert.deepEqual(result.failures, []);
  });

  it("attempt 意外 reject：被兜底归一为失败，不产生 unhandled rejection，其余源仍可取胜", async () => {
    const servers = [
      SongUnlockServer.NETEASE,
      SongUnlockServer.BODIAN,
      SongUnlockServer.GEQUBAO,
    ];

    const result = await raceUnlockSources(servers, async (server): Promise<UnlockAttempt<string>> => {
      if (server === SongUnlockServer.NETEASE) {
        // 同步抛错
        throw new Error("同步意外崩溃");
      }
      if (server === SongUnlockServer.BODIAN) {
        // 异步 reject
        await sleep(5);
        return Promise.reject(new Error("异步网络中断"));
      }
      if (server === SongUnlockServer.GEQUBAO) {
        await sleep(20);
        return {
          ok: true,
          server,
          durationMs: 20,
          value: "https://gequbao.example.com/audio.mp3",
        };
      }
      return {
        ok: false,
        server,
        durationMs: 0,
        reason: "未知源",
      };
    });

    assert.equal(result.winner?.server, SongUnlockServer.GEQUBAO);
    assert.equal(result.winner?.value, "https://gequbao.example.com/audio.mp3");

    // 全量抛错时归一为 请求异常
    const allRejectServers = [SongUnlockServer.KUWO, SongUnlockServer.MIGU];
    const allRejectResult = await raceUnlockSources(allRejectServers, async (server) => {
      if (server === SongUnlockServer.KUWO) {
        throw new Error("同步挂掉");
      }
      await sleep(5);
      return Promise.reject(new Error("异步挂掉"));
    });

    assert.equal(allRejectResult.winner, undefined);
    assert.deepEqual(allRejectResult.failures, [
      { server: SongUnlockServer.KUWO, reason: "请求异常" },
      { server: SongUnlockServer.MIGU, reason: "请求异常" },
    ]);
  });

  it("attempt 的调用次序等于传入数组次序", async () => {
    const servers = [
      SongUnlockServer.XINGHAI,
      SongUnlockServer.FISH,
      SongUnlockServer.JIEXIANG,
      SongUnlockServer.NETEASE,
      SongUnlockServer.BODIAN,
    ];

    const callOrder: SongUnlockServer[] = [];
    await raceUnlockSources(servers, async (server): Promise<UnlockAttempt<string>> => {
      callOrder.push(server);
      return {
        ok: false,
        server,
        durationMs: 0,
        reason: "failed",
      };
    });

    assert.deepEqual(callOrder, servers);
  });
});
