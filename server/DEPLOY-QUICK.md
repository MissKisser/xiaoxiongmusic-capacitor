# 快速部署指南 - music.viaxv.top

## 一、上传代码到服务器

### 方式 1: 使用 Git（推荐）

```bash
# SSH 连接到服务器
ssh root@your-server-ip

# 进入网站目录
cd /www/wwwroot/music.viaxv.top

# 克隆或拉取代码
git clone <your-repo-url> .
# 或
git pull
```

### 方式 2: 使用宝塔面板

1. 在宝塔面板创建网站：`music.viaxv.top`
2. 使用文件管理器或 SFTP 上传项目文件

## 二、在服务器上执行部署

```bash
# 1. 进入项目目录
cd /www/wwwroot/music.viaxv.top

# 2. 安装依赖
pnpm install

# 3. 构建项目
SKIP_NATIVE_BUILD=true pnpm build
pnpm server:build

# 4. 使用 PM2 启动服务器
pm2 start out/server/start.js --name splayer-server --env production
pm2 save
pm2 startup  # 设置开机自启（按提示执行命令）

# 5. 验证
pm2 status
pm2 logs splayer-server
```

## 三、配置宝塔面板 Nginx

1. 进入宝塔面板 → 网站 → `music.viaxv.top` → 设置
2. 点击"配置文件"
3. 复制 `nginx-music.viaxv.top.conf` 文件内容到配置文件中
4. 保存并重载 Nginx

## 四、配置 SSL 证书

1. 在网站设置中点击"SSL"
2. 选择"Let's Encrypt"免费证书
3. 申请并开启"强制 HTTPS"

## 五、验证部署

访问：
- 前端：`https://music.viaxv.top`
- API：`https://music.viaxv.top/api`

## 快速更新脚本

创建 `deploy.sh` 并执行：

```bash
chmod +x deploy.sh
./deploy.sh
```

## PM2 常用命令

```bash
pm2 status              # 查看状态
pm2 logs splayer-server # 查看日志
pm2 restart splayer-server # 重启
pm2 stop splayer-server    # 停止
```

## 故障排查

1. **服务器未启动**：`pm2 logs splayer-server` 查看日志
2. **前端 404**：检查 `out/renderer/index.html` 是否存在
3. **API 无法访问**：检查 Nginx 配置和 PM2 进程状态
