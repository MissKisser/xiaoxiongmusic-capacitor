import mysql from 'mysql2/promise';
import { serverLog } from './logger.js';

// 数据库配置
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'a3fde346639e1e0054fb9a13907562cc',
  database: process.env.DB_NAME || 'music',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
};

// 创建连接池
let pool: mysql.Pool | null = null;

export const getPool = (): mysql.Pool => {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
    serverLog.info('📦 MySQL connection pool created');
  }
  return pool;
};

// 执行查询
export const query = async <T = any>(sql: string, params?: any[]): Promise<T> => {
  const connection = getPool();
  const [rows] = await connection.execute(sql, params);
  return rows as T;
};

// 初始化数据库表
export const initDatabase = async (): Promise<void> => {
  try {
    const connection = getPool();

    // 创建管理员表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建授权码表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS auth_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        status ENUM('unused', 'active', 'disabled') DEFAULT 'unused',
        remarks VARCHAR(255),
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP NULL,
        last_login_ip VARCHAR(50) NULL,
        bound_device_id VARCHAR(100) NULL
      )
    `);

    // 创建设备表
    await connection.execute(`
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
      )
    `);

    // 创建版本表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS app_versions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        version VARCHAR(20) NOT NULL,
        build_number INT DEFAULT 0,
        platform VARCHAR(20) DEFAULT 'android',
        apk_url VARCHAR(255) NOT NULL,
        description TEXT,
        is_force BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建审计日志表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_username VARCHAR(50),
        action VARCHAR(50),
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建每日统计表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS daily_stats (
        date DATE PRIMARY KEY,
        active_count INT DEFAULT 0,
        platform_distribution JSON
      )
    `);

    serverLog.info('✅ Database tables initialized');
  } catch (error) {
    serverLog.error('❌ Failed to initialize database:', error);
    throw error;
  }
};
