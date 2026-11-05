import { SongUnlockServer } from "@/types/shared";

/**
 * 单个音源解锁尝试的结果
 */
export type UnlockAttempt<T> =
  | { ok: true; server: SongUnlockServer; durationMs: number; value: T }
  | { ok: false; server: SongUnlockServer; durationMs: number; reason: string };

/**
 * 并发竞速多个解锁音源
 *
 * 在同一个事件循环 tick 内按数组顺序发起所有音源的解锁尝试，
 * 任一音源成功则立即作为胜者返回，其余在途尝试在后台自然落定；
 * 当所有音源均失败时返回失败列表（保持传入时的链位顺序）。
 *
 * @param servers 候选音源列表（按优先级顺序排列）
 * @param attempt 单个音源的尝试闭包，由调用方负责具体的取链与结果封装
 * @returns 胜者或全部失败信息
 */
export const raceUnlockSources = <T>(
  servers: readonly SongUnlockServer[],
  attempt: (server: SongUnlockServer) => Promise<UnlockAttempt<T>>,
): Promise<{
  winner?: { server: SongUnlockServer; durationMs: number; value: T };
  failures: { server: SongUnlockServer; reason: string }[];
}> => {
  if (servers.length === 0) {
    return Promise.resolve({ failures: [] });
  }

  return new Promise((resolve) => {
    let settled = false;
    let pendingCount = servers.length;
    const failures: { server: SongUnlockServer; reason: string }[] = new Array(servers.length);

    servers.forEach((server, index) => {
      let attemptPromise: Promise<UnlockAttempt<T>>;
      try {
        attemptPromise = attempt(server);
      } catch {
        attemptPromise = Promise.resolve({
          ok: false,
          server,
          durationMs: 0,
          reason: "请求异常",
        });
      }

      attemptPromise
        .catch((): UnlockAttempt<T> => ({
          ok: false,
          server,
          durationMs: 0,
          reason: "请求异常",
        }))
        .then((result) => {
          if (result.ok) {
            if (!settled) {
              settled = true;
              resolve({
                winner: {
                  server: result.server,
                  durationMs: result.durationMs,
                  value: result.value,
                },
                failures: [],
              });
            }
          } else {
            failures[index] = {
              server: result.server,
              reason: result.reason,
            };
            pendingCount--;
            if (pendingCount === 0 && !settled) {
              settled = true;
              resolve({
                failures: failures.filter(Boolean),
              });
            }
          }
        });
    });
  });
};
