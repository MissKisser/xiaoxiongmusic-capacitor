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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
-- 插入管理员账户
-- 用户名: Hackerdallas
-- 密码: a3fde346639e1e0054fb9a13907562cc
-- =====================================================
INSERT INTO admin_users (username, password) VALUES 
  ('Hackerdallas', '$2b$10$hdyqiw0j8LMEl49sSbu5t.yccc3qY0yNwKB1sKCDaDPfA9NkV4hb2')
ON DUPLICATE KEY UPDATE password = '$2b$10$hdyqiw0j8LMEl49sSbu5t.yccc3qY0yNwKB1sKCDaDPfA9NkV4hb2';

-- 完成提示
SELECT '✅ 数据库初始化完成！管理员账户已创建。' AS message;
