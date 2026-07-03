/**
 * 认证模块测试
 */
const request = require('supertest');

// 直接测试 HTTP 端点，不引入 Express app
const BASE = 'http://localhost:3000';

describe('Auth API', () => {
  // ========== 用户登录 ==========
  describe('POST /api/auth/user/login', () => {
    test('正确凭据应登录成功', async () => {
      const res = await request(BASE)
        .post('/api/auth/user/login')
        .send({ phone: '13800138003', password: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data.user).toHaveProperty('id', 1);
    });

    test('错误密码应返回401', async () => {
      const res = await request(BASE)
        .post('/api/auth/user/login')
        .send({ phone: '13800138003', password: 'wrong_password' });

      expect([400, 401]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    test('空手机号应返回400', async () => {
      const res = await request(BASE)
        .post('/api/auth/user/login')
        .send({ phone: '', password: '123456' });

      expect(res.status).toBe(400);
    });

    test('SQL注入尝试应被拦截', async () => {
      const res = await request(BASE)
        .post('/api/auth/user/login')
        .send({ phone: "' OR 1=1 --", password: '123456' });

      expect([400, 401]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });

  // ========== 商家登录 ==========
  describe('POST /api/auth/merchant/login', () => {
    test('商家登录成功', async () => {
      const res = await request(BASE)
        .post('/api/auth/merchant/login')
        .send({ phone: '13800138002', password: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.merchant).toHaveProperty('id', 1);
    });
  });

  // ========== 骑手登录 ==========
  describe('POST /api/auth/rider/login', () => {
    test('骑手登录成功', async () => {
      const res = await request(BASE)
        .post('/api/auth/rider/login')
        .send({ phone: '13800138001', password: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rider).toHaveProperty('id', 1007);
    });
  });
});
