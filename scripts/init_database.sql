-- =====================================================
-- 小熊音乐 授权与更新系统 - 数据库初始化脚本
-- 执行位置: 云端 MySQL (music.viaxv.top)
-- 数据库名: music
-- =====================================================

-- 使用 music 数据库
USE music;

-- 1. 管理员表
CREATE TABLE IF NOT EXISTS admin_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 授权码表
CREATE TABLE IF NOT EXISTS auth_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  status ENUM('unused', 'active', 'disabled') DEFAULT 'unused',
  remarks VARCHAR(255),
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL,
  last_login_ip VARCHAR(50) NULL,
  bound_device_id VARCHAR(100) NULL
);

-- 3. 设备表
CREATE TABLE IF NOT EXISTS devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL,
  auth_code_id INT NULL,
  platform VARCHAR(20) DEFAULT 'android',
  status ENUM('active', 'banned') DEFAULT 'active',
  ip VARCHAR(50),
  name VARCHAR(100),
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- 唯一约束：同一设备仅一条记录；同一授权码同一平台仅一台设备（与 server/db.ts 保持一致）
  UNIQUE KEY uq_device_id (device_id),
  UNIQUE KEY uq_code_platform (auth_code_id, platform),
  FOREIGN KEY (auth_code_id) REFERENCES auth_codes(id) ON DELETE SET NULL
);

-- 4. 版本管理表
CREATE TABLE IF NOT EXISTS app_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  version VARCHAR(20) NOT NULL,
  build_number INT DEFAULT 0,
  platform VARCHAR(20) DEFAULT 'android',
  apk_url VARCHAR(255) NOT NULL,
  description TEXT,
  is_force BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- 并发发布防重（与 server/routes/version.ts 的 409 处理配套）
  UNIQUE KEY uq_platform_build (platform, build_number)
);

-- 5. 操作日志表
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_username VARCHAR(50),
  action VARCHAR(50),
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. 每日统计表
CREATE TABLE IF NOT EXISTS daily_stats (
  date DATE PRIMARY KEY,
  active_count INT DEFAULT 0,
  platform_distribution JSON
);

-- =====================================================
-- 管理员账号初始化说明（安全合规）
-- 安全要求：凭据不得写入仓库。管理员账号由部署方在服务器上按环境变量
-- （ADMIN_USERNAME / ADMIN_PASSWORD）创建，或执行下述语句（在服务器本地执行，
-- 密码哈希由 `bcrypt` 现场生成，切勿使用固定哈希）：
--   INSERT INTO admin_users (username, password)
--   VALUES ('<部署用户名>', '<现场生成的 bcrypt 哈希>')
--   ON DUPLICATE KEY UPDATE password = VALUES(password);
-- 注意：旧版脚本曾内置固定账号与重置逻辑，若生产库中存在该账号，请立即
-- 修改密码并确保服务端 JWT_SECRET / DB_PASSWORD 已显式配置。
-- =====================================================

-- 完成提示
SELECT '✅ 数据库初始化完成！管理员账号请按安全说明手动创建。' AS message;
