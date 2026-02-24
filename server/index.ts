import { join } from "path";
import { existsSync } from "fs";
import { serverLog } from "./logger.js";
import { isDev, port } from "./config.js";
import { initNcmAPI } from "./netease/index.js";
import { initUnblockAPI } from "./unblock/index.js";
import { initQQMusicAPI } from "./qqmusic/index.js";
import { initProxyAPI } from "./proxy/index.js";
import { initAuthAPI } from "./routes/auth.js";
import { initAdminAPI } from "./routes/admin.js";
import { initVersionAPI } from "./routes/version.js";
import { initDatabase } from "./db.js";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastify from "fastify";

const initAppServer = async () => {
  try {
    const server = fastify({
      routerOptions: {
        ignoreTrailingSlash: true,
      },
    });

    // 添加 CORS 支持（支持带凭证的跨域请求）
    server.addHook("onRequest", async (request, reply) => {
      // 动态设置 Origin（支持 credentials）
      const origin = request.headers.origin;
      // 允许的 Origin 列表（生产环境可以限制为特定域名）
      const allowedOrigins = [
        "https://music.viaxv.top",
        "http://localhost:5173",
        "http://localhost:3000",
        "capacitor://localhost",  // Capacitor iOS
        "http://localhost",       // Capacitor Android
        "https://localhost",      // Capacitor Android (HTTPS)
      ];

      // 如果是允许的 Origin 或者没有 Origin（同源请求），则允许
      if (!origin || allowedOrigins.includes(origin) || origin.startsWith("capacitor://")) {
        reply.header("Access-Control-Allow-Origin", origin || "*");
        reply.header("Access-Control-Allow-Credentials", "true");
      } else {
        // 其他 Origin 不允许携带凭证
        reply.header("Access-Control-Allow-Origin", origin);
      }

      reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Range, Cookie, cookie, X-Real-IP, User-Agent");
      reply.header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Set-Cookie");

      if (request.method === "OPTIONS") {
        return reply.code(204).send();
      }
    });

    // 注册插件
    server.register(fastifyCookie);
    server.register(fastifyMultipart);

    // API 信息（必须在静态文件之前注册，确保优先级）
    server.get("/api", (_, reply) => {
      reply.send({
        name: "SPlayer API",
        description: "SPlayer API service (Standalone Web Server)",
        author: "@imsyy",
        list: [
          {
            name: "NeteaseCloudMusicApi",
            url: "/api/netease",
          },
          {
            name: "UnblockAPI",
            url: "/api/unblock",
          },
          {
            name: "QQMusicAPI",
            url: "/api/qqmusic",
          },
          {
            name: "ProxyAPI",
            url: "/api/proxy",
          },
        ],
      });
    });

    // 注册接口
    server.register(initNcmAPI, { prefix: "/api" });
    server.register(initUnblockAPI, { prefix: "/api" });
    server.register(initQQMusicAPI, { prefix: "/api" });
    server.register(initProxyAPI, { prefix: "/api" });

    // 注册授权与管理接口
    server.register(initAuthAPI, { prefix: "/api" });
    server.register(initAdminAPI, { prefix: "/api" });
    server.register(initVersionAPI, { prefix: "/api" });

    // 初始化数据库
    try {
      await initDatabase();
    } catch (dbError) {
      serverLog.warn("⚠️ Database initialization failed, auth features may not work:", dbError);
    }


    // 生产环境启用静态文件（必须在 API 之后注册）
    if (!isDev) {
      const staticPath = join(process.cwd(), "out/renderer");

      if (existsSync(staticPath)) {
        serverLog.info("📂 Serving static files from", staticPath);
        server.register(fastifyStatic, {
          root: staticPath,
          prefix: "/",
        });

        // SPA 路由支持：所有非 API 路径都返回 index.html
        server.setNotFoundHandler((request, reply) => {
          // 如果是 API 路径，返回 404
          if (request.url.startsWith("/api")) {
            return reply.code(404).send({
              message: `Route ${request.method}:${request.url} not found`,
              error: "Not Found",
              statusCode: 404,
            });
          }
          // 否则返回 index.html（SPA 路由）
          return reply.sendFile("index.html");
        });
      } else {
        serverLog.warn("⚠️ 前端文件未找到，请先构建前端：SKIP_NATIVE_BUILD=true pnpm build");
        serverLog.warn("⚠️ 静态文件目录不存在:", staticPath);

        // 提供一个简单的提示页面
        server.get("*", (request, reply) => {
          if (request.url.startsWith("/api")) {
            return reply.code(404).send({
              message: `Route ${request.method}:${request.url} not found`,
              error: "Not Found",
              statusCode: 404,
            });
          }
          return reply.code(200).type("text/html").send(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <title>SPlayer - 前端未构建</title>
              <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                h1 { color: #333; }
                code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
              </style>
            </head>
            <body>
              <h1>⚠️ 前端文件未构建</h1>
              <p>请先构建前端文件：</p>
              <p><code>SKIP_NATIVE_BUILD=true pnpm build</code></p>
              <p>构建完成后，前端页面将自动可用。</p>
              <hr>
              <p><a href="/api">查看 API 信息</a></p>
            </body>
            </html>
          `);
        });
      }
    }

    // 启动服务器
    try {
      await server.listen({ port, host: "0.0.0.0" });
      serverLog.info(`🌐 Starting AppServer on port ${port}`);
      return server;
    } catch (listenError: any) {
      if (listenError.code === "EADDRINUSE") {
        serverLog.error(`❌ 端口 ${port} 已被占用，请检查是否有其他进程正在使用该端口`);
        serverLog.info(`💡 解决方案：`);
        serverLog.info(`   1. 停止占用端口的进程`);
        serverLog.info(`   2. 或修改环境变量 VITE_SERVER_PORT 使用其他端口`);
        serverLog.info(`   3. Windows: netstat -ano | findstr :${port}`);
        serverLog.info(`   4. Linux: lsof -i :${port} 或 netstat -tulpn | grep :${port}`);
      }
      throw listenError;
    }
  } catch (error) {
    serverLog.error("🚫 AppServer failed to start", error);
    throw error;
  }
};

export default initAppServer;
