import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db.js';
import { serverLog } from '../logger.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'xiaoxiong_music_secret_key_2026';
const JWT_EXPIRES_IN = '7d';

// 生成随机授权码后缀
const generateRandomSuffix = (length: number = 8): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// JWT 验证中间件
const verifyToken = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.code(401).send({ success: false, message: '未登录' });
        }
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET) as { username: string };
        (request as any).admin = decoded;
    } catch (error) {
        return reply.code(401).send({ success: false, message: 'Token 无效或已过期' });
    }
};

export const initAdminAPI: FastifyPluginAsync = async (fastify) => {
    // 管理员登录
    fastify.post<{ Body: { username: string; password: string } }>('/admin/login', async (request, reply) => {
        try {
            const { username, password } = request.body;

            if (!username || !password) {
                return reply.code(400).send({ success: false, message: '请输入用户名和密码' });
            }

            const admins = await query<any[]>(
                'SELECT * FROM admin_users WHERE username = ?',
                [username]
            );

            if (admins.length === 0) {
                return reply.code(401).send({ success: false, message: '用户名或密码错误' });
            }

            const admin = admins[0];
            const isMatch = await bcrypt.compare(password, admin.password);

            if (!isMatch) {
                return reply.code(401).send({ success: false, message: '用户名或密码错误' });
            }

            const token = jwt.sign({ username: admin.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

            // 记录登录日志
            await query(
                'INSERT INTO audit_logs (admin_username, action, details) VALUES (?, ?, ?)',
                [username, 'LOGIN', JSON.stringify({ ip: request.ip })]
            );

            return reply.send({
                success: true,
                message: '登录成功',
                data: { token, username: admin.username }
            });
        } catch (error) {
            serverLog.error('Admin login error:', error);
            return reply.code(500).send({ success: false, message: '服务器错误' });
        }
    });

    // ===== 需要登录的接口 =====

    // 获取仪表盘数据
    fastify.get('/admin/dashboard', { preHandler: verifyToken }, async (request, reply) => {
        try {
            // 总授权码数
            const totalCodesResult = await query<any[]>('SELECT COUNT(*) as count FROM auth_codes');
            const totalCodes = totalCodesResult[0].count;

            // 活跃授权码数
            const activeCodesResult = await query<any[]>('SELECT COUNT(*) as count FROM auth_codes WHERE status = "active"');
            const activeCodes = activeCodesResult[0].count;

            // 昨日在线人数
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            const yesterdayActiveResult = await query<any[]>(
                'SELECT COUNT(DISTINCT device_id) as count FROM devices WHERE DATE(last_active_at) = ?',
                [yesterdayStr]
            );
            const yesterdayActive = yesterdayActiveResult[0].count;

            // 平台分布
            const platformResult = await query<any[]>(
                'SELECT platform, COUNT(*) as count FROM devices GROUP BY platform'
            );
            const platformDistribution: Record<string, number> = {};
            platformResult.forEach((row: any) => {
                platformDistribution[row.platform] = row.count;
            });

            return reply.send({
                success: true,
                data: {
                    totalCodes,
                    activeCodes,
                    yesterdayActive,
                    platformDistribution
                }
            });
        } catch (error) {
            serverLog.error('Dashboard error:', error);
            return reply.code(500).send({ success: false, message: '服务器错误' });
        }
    });

    // 获取授权码列表
    fastify.get('/admin/codes', { preHandler: verifyToken }, async (request, reply) => {
        try {
            const codes = await query<any[]>(
                `SELECT ac.*, 
          (SELECT COUNT(*) FROM devices WHERE auth_code_id = ac.id) as device_count
        FROM auth_codes ac 
        ORDER BY ac.generated_at DESC`
            );

            return reply.send({
                success: true,
                data: codes
            });
        } catch (error) {
            serverLog.error('Get codes error:', error);
            return reply.code(500).send({ success: false, message: '服务器错误' });
        }
    });

    // 批量生成授权码
    fastify.post<{ Body: { count: number; remarks?: string } }>('/admin/codes/generate', { preHandler: verifyToken }, async (request, reply) => {
        try {
            const { count, remarks } = request.body;
            const admin = (request as any).admin;

            if (!count || count < 1 || count > 1000) {
                return reply.code(400).send({ success: false, message: '生成数量需在 1-1000 之间' });
            }

            const generatedCodes: string[] = [];

            for (let i = 0; i < count; i++) {
                const code = `xiaoxiong_music_${generateRandomSuffix(8)}`;
                try {
                    await query(
                        'INSERT INTO auth_codes (code, remarks) VALUES (?, ?)',
                        [code, remarks || null]
                    );
                    generatedCodes.push(code);
                } catch (e) {
                    // 如果重复则重试
                    const retryCode = `xiaoxiong_music_${generateRandomSuffix(10)}`;
                    await query(
                        'INSERT INTO auth_codes (code, remarks) VALUES (?, ?)',
                        [retryCode, remarks || null]
                    );
                    generatedCodes.push(retryCode);
                }
            }

            // 记录日志
            await query(
                'INSERT INTO audit_logs (admin_username, action, details) VALUES (?, ?, ?)',
                [admin.username, 'GENERATE_CODES', JSON.stringify({ count, remarks })]
            );

            return reply.send({
                success: true,
                message: `成功生成 ${generatedCodes.length} 个授权码`,
                data: generatedCodes
            });
        } catch (error) {
            serverLog.error('Generate codes error:', error);
            return reply.code(500).send({ success: false, message: '服务器错误' });
        }
    });

    // 更新授权码状态
    fastify.put<{ Params: { id: string }; Body: { status?: string; remarks?: string } }>('/admin/codes/:id', { preHandler: verifyToken }, async (request, reply) => {
        try {
            const { id } = request.params;
            const { status, remarks } = request.body;
            const admin = (request as any).admin;

            const updates: string[] = [];
            const values: any[] = [];

            if (status !== undefined) {
                updates.push('status = ?');
                values.push(status);
            }
            if (remarks !== undefined) {
                updates.push('remarks = ?');
                values.push(remarks);
            }

            if (updates.length === 0) {
                return reply.code(400).send({ success: false, message: '没有需要更新的字段' });
            }

            values.push(id);
            await query(`UPDATE auth_codes SET ${updates.join(', ')} WHERE id = ?`, values);

            // 记录日志
            await query(
                'INSERT INTO audit_logs (admin_username, action, details) VALUES (?, ?, ?)',
                [admin.username, 'UPDATE_CODE', JSON.stringify({ id, status, remarks })]
            );

            return reply.send({ success: true, message: '更新成功' });
        } catch (error) {
            serverLog.error('Update code error:', error);
            return reply.code(500).send({ success: false, message: '服务器错误' });
        }
    });

    // 删除授权码
    fastify.delete<{ Params: { id: string } }>('/admin/codes/:id', { preHandler: verifyToken }, async (request, reply) => {
        try {
            const { id } = request.params;
            const admin = (request as any).admin;

            await query('DELETE FROM auth_codes WHERE id = ?', [id]);

            // 记录日志
            await query(
                'INSERT INTO audit_logs (admin_username, action, details) VALUES (?, ?, ?)',
                [admin.username, 'DELETE_CODE', JSON.stringify({ id })]
            );

            return reply.send({ success: true, message: '删除成功' });
        } catch (error) {
            serverLog.error('Delete code error:', error);
            return reply.code(500).send({ success: false, message: '服务器错误' });
        }
    });

    // 获取审计日志
    fastify.get('/admin/logs', { preHandler: verifyToken }, async (request, reply) => {
        try {
            const logs = await query<any[]>(
                'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100'
            );
            return reply.send({ success: true, data: logs });
        } catch (error) {
            serverLog.error('Get logs error:', error);
            return reply.code(500).send({ success: false, message: '服务器错误' });
        }
    });
};
