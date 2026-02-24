# SPlayer 独立 Web 服务器

这是 SPlayer 的独立 Web 服务器实现，完全移除了 Electron 依赖，可以独立运行。

## 功能

- ✅ 网易云音乐 API 代理
- ✅ 歌曲解锁服务（支持 Netease、Kuwo、Bodian、Gequbao）
- ✅ 音频流代理（解决 CORS 和证书问题）
- ✅ QQ 音乐歌词 API
- ✅ 支持 VIP 歌曲播放

## 快速开始

### 开发环境

**Linux/macOS:**
```bash
# 安装依赖
pnpm install

# 启动服务器
pnpm server

# 或使用生产模式
pnpm server:prod
```

**Windows:**
```powershell
# 安装依赖
pnpm install

# 启动服务器
pnpm server

# 或使用生产模式
$env:NODE_ENV="production"; pnpm server:prod
```

> 💡 Windows 用户请查看 [Windows 运行指南](README-WINDOWS.md) 获取详细说明

服务器默认运行在 `http://localhost:25884`

### 生产环境

1. 构建 Web 前端：
```bash
pnpm build
```

2. 启动服务器：
```bash
NODE_ENV=production pnpm server:prod
```

3. 配置 Nginx 反向代理：

项目根目录已包含 `nginx-music.viaxv.top.conf` 配置文件，可以直接使用：

```bash
# 复制配置文件到 Nginx 配置目录（根据你的 Nginx 安装位置调整）
cp nginx-music.viaxv.top.conf /etc/nginx/sites-available/music.viaxv.top.conf

# 创建软链接（如果使用 sites-enabled）
ln -s /etc/nginx/sites-available/music.viaxv.top.conf /etc/nginx/sites-enabled/

# 测试配置
nginx -t

# 重载 Nginx
nginx -s reload
# 或
systemctl reload nginx
```

配置文件已针对 `music.viaxv.top` 域名优化，包含：
- 前端静态文件服务
- 所有 API 代理（网易云、解锁、音频流、QQ音乐）
- 音频流断点续传支持
- 静态资源缓存优化

## 使用 PM2 管理进程

```bash
# 安装 PM2
npm install -g pm2

# 启动
pm2 start server/start.ts --interpreter tsx --name splayer-server

# 查看日志
pm2 logs splayer-server

# 停止
pm2 stop splayer-server

# 重启
pm2 restart splayer-server
```

## 环境变量

- `NODE_ENV`: 运行环境（development/production）
- `VITE_SERVER_PORT`: 服务器端口（默认 25884）
- `LOG_DIR`: 日志目录（默认 `./logs`）
- `LOG_LEVEL`: 日志级别（debug/info/warn/error）

## API 端点

- `GET /api` - API 信息
- `GET /api/netease/*` - 网易云音乐 API
- `GET /api/unblock/*` - 解锁服务
- `GET /api/proxy/audio` - 音频流代理
- `GET /api/qqmusic/*` - QQ 音乐 API

## 部署到 music.viaxv.top

### 完整部署步骤

1. **构建项目**：
```bash
SKIP_NATIVE_BUILD=true pnpm build
```

2. **启动服务器**（使用 PM2）：
```bash
pm2 start server/start.ts --interpreter tsx --name splayer-server --env production
pm2 save
pm2 startup  # 设置开机自启
```

3. **配置 Nginx**：
```bash
# 使用项目提供的配置文件
cp nginx-music.viaxv.top.conf /etc/nginx/sites-available/music.viaxv.top.conf
ln -s /etc/nginx/sites-available/music.viaxv.top.conf /etc/nginx/sites-enabled/
nginx -t && nginx -s reload
```

4. **配置 SSL 证书**（推荐）：
```bash
# 使用 certbot 或其他工具获取 SSL 证书
certbot --nginx -d music.viaxv.top
```

5. **验证部署**：
- 访问 `http://music.viaxv.top` 或 `https://music.viaxv.top`
- 检查 API：`http://music.viaxv.top/api`
- 查看服务器日志：`pm2 logs splayer-server`

## 注意事项

1. 服务器需要运行在 Node.js 20+ 环境
2. 确保端口 25884 未被占用
3. 生产环境建议使用 PM2 或 systemd 管理进程
4. 日志文件会自动按日期分割，默认保留 30 天
5. 确保 `/www/wwwroot/music.viaxv.top/out/renderer` 目录存在且包含构建后的前端文件
6. 如果使用宝塔面板，可以在网站设置中导入 `nginx-music.viaxv.top.conf` 配置
