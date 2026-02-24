# 宝塔面板部署指南 - music.viaxv.top

## 部署步骤

### 1. 上传代码到服务器

**方式 1: 使用 Git**
```bash
cd /www/wwwroot/music.viaxv.top
git clone <your-repo-url> .
```

**方式 2: 使用宝塔文件管理器**
- 在宝塔面板中进入网站目录
- 上传项目文件

### 2. 在服务器上构建项目

```bash
# SSH 连接到服务器
cd /www/wwwroot/music.viaxv.top

# 安装依赖
pnpm install

# 构建项目
SKIP_NATIVE_BUILD=true pnpm build
pnpm server:build
```

### 3. 使用 PM2 启动服务器

```bash
# 启动服务器
pm2 start out/server/start.js --name splayer-server --env production

# 设置开机自启
pm2 save
pm2 startup  # 按提示执行命令
```

### 4. 配置宝塔面板 Nginx

1. **进入宝塔面板** → 网站 → `music.viaxv.top` → 设置
2. **点击"配置文件"**
3. **清空现有配置，复制以下内容**：

   使用项目根目录的 `nginx-baota-music.viaxv.top.conf` 文件内容

4. **保存并重载 Nginx**

### 5. 配置 SSL 证书（如果未配置）

1. 在网站设置中点击 **"SSL"**
2. 选择 **"Let's Encrypt"** 免费证书
3. 申请并开启 **"强制 HTTPS"**

## 验证部署

### 检查 PM2 进程

```bash
pm2 status
pm2 logs splayer-server
```

### 检查 Nginx 配置

```bash
nginx -t
```

### 访问测试

- 前端：`https://music.viaxv.top`
- API：`https://music.viaxv.top/api`

## 更新部署

```bash
cd /www/wwwroot/music.viaxv.top

# 拉取最新代码（如果使用 Git）
git pull

# 重新构建
SKIP_NATIVE_BUILD=true pnpm build
pnpm server:build

# 重启服务器
pm2 restart splayer-server
```

## 故障排查

### 1. 前端页面 404

```bash
# 检查前端文件是否存在
ls -la /www/wwwroot/music.viaxv.top/out/renderer/index.html

# 如果不存在，重新构建
SKIP_NATIVE_BUILD=true pnpm build
```

### 2. API 无法访问

```bash
# 检查 PM2 进程
pm2 status

# 检查服务器日志
pm2 logs splayer-server

# 检查端口
netstat -tulpn | grep 25884
```

### 3. Nginx 配置错误

```bash
# 测试配置
nginx -t

# 查看错误日志
tail -f /www/wwwlogs/music.viaxv.top.error.log
```

## 重要提示

1. **API 路由优先级**：配置中 API 路由在静态文件之前，确保 `/api/*` 请求正确代理
2. **SPA 路由支持**：所有非 API 路径都会返回 `index.html`，支持 Vue Router
3. **静态资源缓存**：JS/CSS 等静态资源缓存 1 年，图片缓存 30 天
4. **音频流代理**：`/api/proxy/` 已配置支持断点续传，适合音频播放

## 配置文件位置

- Nginx 配置：`nginx-baota-music.viaxv.top.conf`
- PM2 配置：`ecosystem.config.js`
- 部署脚本：`deploy.sh`

部署完成后即可访问 `https://music.viaxv.top`！
