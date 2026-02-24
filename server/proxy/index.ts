import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { serverLog } from "../logger.js";
import axios from "axios";

/**
 * 音频流代理接口
 * 用于 Web 端通过服务器转发音频流，解决 CORS 和证书问题
 */
export const initProxyAPI = async (fastify: FastifyInstance) => {
  // 音频流代理
  fastify.get(
    "/proxy/audio",
    async (
      req: FastifyRequest<{ Querystring: { url: string } }>,
      reply: FastifyReply,
    ) => {
      const { url } = req.query;

      if (!url) {
        return reply.code(400).send({
          code: 400,
          message: "缺少 url 参数",
          url: null,
        });
      }

      try {
        // 验证 URL 格式
        let targetUrl: URL;
        try {
          targetUrl = new URL(url);
        } catch {
          return reply.code(400).send({
            code: 400,
            message: "无效的 URL 格式",
            url: null,
          });
        }

        // 只允许 HTTP/HTTPS 协议
        if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
          return reply.code(400).send({
            code: 400,
            message: "只支持 HTTP/HTTPS 协议",
            url: null,
          });
        }

        // 设置 CORS 头
        reply.header("Access-Control-Allow-Origin", "*");
        reply.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        reply.header("Access-Control-Allow-Headers", "Range");

        // 处理 Range 请求（支持断点续传）
        const range = req.headers.range;
        const host = targetUrl.hostname;

        // 按 CDN 使用更真实的请求头，缓解 IP/Referer 校验
        let requestHeaders: Record<string, string> = {
          Referer: targetUrl.origin + "/",
        };
        if (host.includes("kuwo.cn") || host.includes("sycdn.kuwo")) {
          requestHeaders["User-Agent"] = "okhttp/3.14.9";
          requestHeaders["Origin"] = targetUrl.origin;
        } else if (host.includes("music.126.net")) {
          requestHeaders["User-Agent"] = "NeteaseMusic/9.0.0 (Windows NT 10.0; Win64; x64)";
        } else {
          requestHeaders["User-Agent"] =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        }

        if (range) {
          requestHeaders.Range = range;
        }

        // 可选：环境变量 AUDIO_PROXY_URL（如 http://127.0.0.1:7890）让代理请求走该出口，缓解服务器 IP 被 CDN 封禁
        const proxyUrl = process.env.AUDIO_PROXY_URL;
        let proxyConfig: { protocol: string; host: string; port: number } | undefined;
        if (proxyUrl) {
          try {
            const p = new URL(proxyUrl);
            proxyConfig = {
              protocol: p.protocol.replace(":", "") as string,
              host: p.hostname,
              port: Number(p.port) || (p.protocol === "https:" ? 443 : 80),
            };
          } catch (_) {
            /* ignore */
          }
        }

        const response = await axios.get(url, {
          responseType: "stream",
          timeout: 30000,
          headers: requestHeaders,
          validateStatus: (status) => status >= 200 && status < 400,
          ...(proxyConfig ? { proxy: proxyConfig } : {}),
        });

        // 设置响应头
        reply.code(response.status);
        reply.header("Content-Type", response.headers["content-type"] || "audio/mpeg");
        
        if (response.headers["content-length"]) {
          reply.header("Content-Length", response.headers["content-length"]);
        }
        
        if (response.headers["content-range"]) {
          reply.header("Content-Range", response.headers["content-range"]);
        }
        
        reply.header("Accept-Ranges", "bytes");

        // 转发音频流
        return reply.send(response.data);
      } catch (error) {
        serverLog.error("❌ 音频流代理失败:", error);
        return reply.code(500).send({
          code: 500,
          message: "音频流代理失败",
          url: null,
        });
      }
    },
  );

  serverLog.info("🌐 Register ProxyAPI successfully");
};
