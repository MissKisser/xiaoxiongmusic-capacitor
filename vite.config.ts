import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { resolve } from "path";
import AutoImport from "unplugin-auto-import/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";
import viteCompression from "vite-plugin-compression";
import wasm from "vite-plugin-wasm";

export default defineConfig({
    base: './', // 使用相对路径,确保 Capacitor 能正确加载资源
    plugins: [
        vue(),
        AutoImport({
            imports: [
                "vue",
                "vue-router",
                "@vueuse/core",
                {
                    "naive-ui": ["useDialog", "useMessage", "useNotification", "useLoadingBar"],
                },
            ],
            dts: "auto-imports.d.ts",
        }),
        Components({
            resolvers: [NaiveUiResolver()],
            dts: "components.d.ts",
        }),
        // viteCompression(), // 禁用 gzip 压缩,避免 Android 构建时重复资源错误
        wasm(),
    ],
    resolve: {
        alias: {
            "@": resolve(__dirname, "src/"),
            "@emi": resolve(__dirname, "native/emi-stub.ts"),
            "@opencc": resolve(__dirname, "native/ferrous-opencc-wasm/pkg"),
        },
    },
    css: {
        preprocessorOptions: {
            scss: {
                silenceDeprecations: ["legacy-js-api"],
            },
        },
    },
    server: {
        port: 14558,
        host: true,
        // 代理配置：将所有 /api 请求转发到远程服务器
        proxy: {
            '/api': {
                target: 'https://music.viaxv.top',
                changeOrigin: true,
                secure: false,
                // Cookie 相关配置
                cookieDomainRewrite: {
                    'music.viaxv.top': 'localhost',
                },
                // 保持会话
                ws: true,
                // 转发 Cookie
                configure: (proxy, _options) => {
                    proxy.on('proxyReq', (proxyReq, req, _res) => {
                        // 转发所有 Cookie
                        if (req.headers.cookie) {
                            proxyReq.setHeader('Cookie', req.headers.cookie);
                        }
                    });
                },
            },
        },
    },
    preview: {
        port: 14558,
        host: true,
    },
    build: {
        // outDir: "dist", // 恢复默认
        minify: "esbuild",
        chunkSizeWarningLimit: 1000,
        sourcemap: false,
    },
    define: {
        // 定义全局环境变量（Capacitor/生产环境使用）
        'import.meta.env.VITE_API_URL': JSON.stringify('https://music.viaxv.top'),
    },
});
