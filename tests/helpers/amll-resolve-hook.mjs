/**
 * node 单测模块解析钩子
 *
 * 将 @applemusic-like-lyrics/lyric 重定向到测试桩（tests/helpers/amll-lyric-stub.mjs），
 * 使依赖歌词解析的模块可在 node 环境加载。
 */

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@applemusic-like-lyrics/lyric") {
    return {
      url: new URL("./amll-lyric-stub.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
