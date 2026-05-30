# Linux 服务器部署指南

## 前提条件

- ✅ 域名 `music.viaxv.top` 已解析到服务器 IP
- ✅ 服务器已安装 Node.js 20+、pnpm、PM2
- ✅ 服务器已安装 Nginx
- ✅ 使用宝塔面板管理

## 部署步骤

### 1. 上传代码到服务器

**方式一：使用 Git（推荐）**

```bash
# SSH 连接到服务器
ssh root@your-server-ip

# 进入网站目录
cd /www/wwwroot/music.viaxv.top

# 如果已有 Git 仓库，直接拉取
git pull

# 如果没有，克隆仓库
git clone <your-repo-url> .
```

**方式二：使用宝塔面板**

1. 在宝塔面板中创建网站：`music.viaxv.top`
2. 使用宝塔的文件管理器上传项目文件
3. 或使用 SFTP 工具上传

**方式三：使用 SCP 从本地上传**

```powershell
# 在 Windows PowerShell 中
# 先打包项目（排除 node_modules 等）
# 然后上传到服务器
scp -r D:\document\Projects\Splayer\SPlayer root@your-server-ip:/www/wwwroot/music.viaxv.top/
```

### 2. 在服务器上安装依赖

```bash
# SSH 连接到服务器
cd /www/wwwroot/music.viaxv.top

# 安装依赖
pnpm install

# 如果遇到权限问题
chmod +x node_modules/.bin/*
```

### 3. 构建项目

```bash
# 构建前端和服务器
SKIP_NATIVE_BUILD=true pnpm build

# 编译服务器代码
pnpm server:build
```

### 4. 配置 PM2 启动服务器

```bash
# 进入项目目录
cd /www/wwwroot/music.viaxv.top

# 使用 PM2 启动服务器
pm2 start out/server/start.js --name splayer-server --env production

# 查看状态
pm2 status

# 查看日志
pm2 logs splayer-server

# 设置开机自启
pm2 save
pm2 startup
# 执行上面命令输出的命令（通常是 sudo env PATH=... pm2 startup systemd -u username --hp /home/username）
```

### 5. 配置 Nginx 反向代理

在宝塔面板中：

1. 进入网站设置 → `music.viaxv.top`
2. 点击"配置文件"
3. 将以下配置替换到配置文件中：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name music.viaxv.top;

    client_max_body_size 100M;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # 前端静态文件
    location / {
        root /www/wwwroot/music.viaxv.top/out/renderer;
        index index.html;
        try_files $uri $uri/ /index.html;
        
        # 缓存静态资源
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # API 代理 - 网易云音乐 API
    location /api/netease/ {
        proxy_pass http://localhost:25884/api/netease/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        proxy_buffers 16 64k;
        proxy_buffer_size 128k;
        proxy_busy_buffers_size 256k;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # API 代理 - 解锁服务
    location /api/unblock/ {
        proxy_pass http://localhost:25884/api/unblock/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_buffers 16 64k;
        proxy_buffer_size 128k;
        proxy_busy_buffers_size 256k;
    }

    # API 代理 - 音频流代理（支持断点续传）
    location /api/proxy/ {
        proxy_pass http://localhost:25884/api/proxy/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Range $http_range;
        
        # 禁用缓冲，确保音频流实时传输
        proxy_buffering off;
        proxy_request_buffering off;
        
        # 支持 Range 请求（断点续传）
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # API 代理 - QQ 音乐 API
    location /api/qqmusic/ {
        proxy_pass http://localhost:25884/api/qqmusic/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        proxy_buffers 16 64k;
        proxy_buffer_size 128k;
        proxy_busy_buffers_size 256k;
    }

    # API 信息
    location /api {
        proxy_pass http://localhost:25884/api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 错误页面
    error_page 404 /index.html;
    error_page 500 502 503 504 /50x.html;
    location = /50x.html {
        root /www/wwwroot/music.viaxv.top/out/renderer;
    }
}
```

4. 保存配置并重载 Nginx

### 6. 配置 SSL 证书（HTTPS）

在宝塔面板中：

1. 进入网站设置 → `music.viaxv.top`
2. 点击"SSL"
3. 选择"Let's Encrypt"免费证书
4. 勾选域名 `music.viaxv.top`
5. 点击"申请"
6. 申请成功后，开启"强制 HTTPS"

### 7. 验证部署

```bash
# 1. 检查 PM2 进程
pm2 status

# 2. 检查服务器日志
pm2 logs splayer-server --lines 50

# 3. 测试 API
curl http://localhost:25884/api

# 4. 检查端口
netstat -tulpn | grep 25884
```

在浏览器中访问：
- 前端：`http://music.viaxv.top` 或 `https://music.viaxv.top`
- API：`https://music.viaxv.top/api`

## PM2 常用命令

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs splayer-server

# 查看详细信息
pm2 info splayer-server

# 重启
pm2 restart splayer-server

# 停止
pm2 stop splayer-server

# 删除
pm2 delete splayer-server

# 查看监控
pm2 monit
```

## 更新部署

当代码更新后：

```bash
# 1. 进入项目目录
cd /www/wwwroot/music.viaxv.top

# 2. 拉取最新代码（如果使用 Git）
git pull

# 3. 安装新依赖（如果有）
pnpm install

# 4. 重新构建
SKIP_NATIVE_BUILD=true pnpm build
pnpm server:build

# 5. 重启服务器
pm2 restart splayer-server
```

## 故障排查

### 1. 服务器无法启动

```bash
# 查看日志
pm2 logs splayer-server

# 检查端口是否被占用
lsof -i :25884
# 或
netstat -tulpn | grep 25884

# 手动测试启动
cd /www/wwwroot/music.viaxv.top
node out/server/start.js
```

### 2. 前端页面 404

```bash
# 检查前端文件是否存在
ls -la /www/wwwroot/music.viaxv.top/out/renderer/index.html

# 如果不存在，重新构建
SKIP_NATIVE_BUILD=true pnpm build
```

### 3. API 无法访问

```bash
# 检查服务器是否运行
pm2 status

# 检查 Nginx 配置
nginx -t

# 重载 Nginx
nginx -s reload
# 或
systemctl reload nginx
```

### 4. 防火墙设置

```bash
# 检查防火墙状态
ufw status

# 如果需要开放端口（通常不需要，因为使用 Nginx 反向代理）
ufw allow 25884/tcp
```

## 环境变量

可以在 PM2 配置中设置环境变量：

```bash
# 创建 PM2 配置文件
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'splayer-server',
    script: './out/server/start.js',
    cwd: '/www/wwwroot/music.viaxv.top',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      VITE_SERVER_PORT: 25884,
      LOG_DIR: '/www/wwwroot/music.viaxv.top/logs'
    }
  }]
}
EOF

# 使用配置文件启动
pm2 start ecosystem.config.js
pm2 save
```

## 完整部署脚本

创建 `deploy.sh`：

```bash
#!/bin/bash

cd /www/wwwroot/music.viaxv.top

echo "📦 安装依赖..."
pnpm install

echo "🔨 构建项目..."
SKIP_NATIVE_BUILD=true pnpm build
pnpm server:build

echo "🔄 重启服务器..."
pm2 restart splayer-server

echo "✅ 部署完成！"
echo "🌐 访问地址: https://music.viaxv.top"
```

使用：

```bash
chmod +x deploy.sh
./deploy.sh
```

## 注意事项

1. **文件权限**：确保 `out/renderer` 目录 Nginx 可读
2. **日志目录**：确保 `logs/` 目录存在且可写
3. **端口安全**：25884 端口不需要对外开放，只需 Nginx 本地访问
4. **资源限制**：如果服务器资源有限，可以调整 PM2 实例数
5. **定期备份**：建议定期备份 `out/renderer` 目录

## 验证清单

- [ ] 代码已上传到服务器
- [ ] 依赖已安装
- [ ] 项目已构建（`out/renderer` 目录存在）
- [ ] PM2 进程正在运行
- [ ] Nginx 配置已更新
- [ ] SSL 证书已配置（可选但推荐）
- [ ] 前端页面可以访问
- [ ] API 接口可以访问
- [ ] VIP 歌曲可以播放

部署完成后，访问 `https://music.viaxv.top` 即可使用！
