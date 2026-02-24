import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { pathCase } from "change-case";
import NeteaseCloudMusicApi from "@neteasecloudmusicapienhanced/api";
import { serverLog } from "../logger.js";
import { useStore } from "../store.js";
import { defaultAMLLDbServer } from "../config.js";

// 初始化 NcmAPI
export const initNcmAPI = async (fastify: FastifyInstance) => {
  // 主信息
  fastify.get("/netease", (_, reply) => {
    reply.send({
      name: "@neteaseapireborn/api",
      description: "网易云音乐 API Enhanced",
      author: "@MoeFurina",
      license: "MIT",
      url: "https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced",
    });
  });

  // 解析 Cookie 字符串为对象
  const parseCookieString = (cookieStr: string): Record<string, string> => {
    const cookies: Record<string, string> = {};
    if (!cookieStr) return cookies;
    
    cookieStr.split(';').forEach((pair) => {
      const [key, ...valueParts] = pair.split('=');
      const trimmedKey = key?.trim();
      const value = valueParts.join('=').trim();
      if (trimmedKey && value) {
        cookies[trimmedKey] = value;
      }
    });
    return cookies;
  };

  // 动态路由处理函数
  const dynamicHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const { "*": requestPath } = req.params as { "*": string };

    // 将 path-case 转回 camelCase 或直接匹配下划线路由
    const routerName = Object.keys(NeteaseCloudMusicApi).find((key) => {
      // 跳过非函数属性
      if (typeof (NeteaseCloudMusicApi as any)[key] !== "function") return false;
      // 匹配 path-case 格式
      return pathCase(key) === requestPath || key === requestPath;
    });

    if (!routerName) {
      return reply.status(404).send({ error: "API not found" });
    }

    const neteaseApi = (NeteaseCloudMusicApi as any)[routerName];
    serverLog.log("🌐 Request NcmAPI:", requestPath);

    // 合并 Cookie：优先使用 URL 参数中的 cookie（Capacitor 环境），否则使用 HTTP Cookie 头
    const queryParams = req.query as Record<string, unknown>;
    const bodyParams = req.body as Record<string, any>;
    
    // 从多个来源获取 cookie
    let finalCookies: Record<string, string> = {};
    
    // 1. 先从 HTTP Cookie 头获取（浏览器环境）
    if (req.cookies && Object.keys(req.cookies).length > 0) {
      // 过滤掉 undefined 值
      for (const [key, value] of Object.entries(req.cookies)) {
        if (value !== undefined) {
          finalCookies[key] = value;
        }
      }
    }
    
    // 2. 从 URL 参数中的 cookie 获取并合并（Capacitor 环境）
    if (queryParams.cookie && typeof queryParams.cookie === 'string') {
      const paramCookies = parseCookieString(queryParams.cookie);
      finalCookies = { ...finalCookies, ...paramCookies };
    }
    
    // 3. 从请求体中的 cookie 获取并合并
    if (bodyParams?.cookie && typeof bodyParams.cookie === 'string') {
      const bodyCookies = parseCookieString(bodyParams.cookie);
      finalCookies = { ...finalCookies, ...bodyCookies };
    }

    try {
      const result = await neteaseApi({
        ...queryParams,
        ...bodyParams,
        cookie: finalCookies,
      });
      return reply.send(result.body);
    } catch (error: any) {
      serverLog.error("❌ NcmAPI Error:", error);
      if ([400, 301].includes(error.status)) {
        return reply.status(error.status).send(error.body);
      }
      return reply
        .status(500)
        .send(error.body || { error: error.message || "Internal Server Error" });
    }
  };

  // 注册动态通配符路由
  fastify.get("/netease/*", dynamicHandler);
  fastify.post("/netease/*", dynamicHandler);

  // 获取 TTML 歌词
  fastify.get(
    "/netease/lyric/ttml",
    async (req: FastifyRequest<{ Querystring: { id: string } }>, reply: FastifyReply) => {
      const { id } = req.query;
      if (!id) {
        return reply.status(400).send({ error: "id is required" });
      }
      const store = useStore();
      const server = store.get("amllDbServer") ?? defaultAMLLDbServer;
      const url = server.replace("%s", String(id));
      try {
        const response = await fetch(url);
        if (response.status !== 200) {
          return reply.send(null);
        }
        const data = await response.text();
        return reply.send(data);
      } catch (error) {
        serverLog.error("❌ TTML Lyric Fetch Error:", error);
        return reply.send(null);
      }
    },
  );

  serverLog.info("🌐 Register NcmAPI successfully");
};
