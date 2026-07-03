/**
 * 钱包模块测试
 */
const request = require('supertest');

const BASE = 'http://localhost:3000';

let userToken = '';
let initialBalance = 0;

beforeAll(async () => {
  // 登录获取 token
  const res = await request(BASE)
    .post('/api/auth/user/login')
    .send({ phone: '13800138003', password: '123456' });

  userToken = res.body.data.token;

  // 记录当前余额
  const balRes = await request(BASE)
    .get('/api/wallet/balance')
    .set('Authorization', `Bearer ${userToken}`);

  initialBalance = balRes.body.data.balance;
});

describe('Wallet API', () => {
  // ========== 余额查询 ==========
  describe('GET /api/wallet/balance', () => {
    test('有Token应返回余额', async () => {
      const res = await request(BASE)
        .get('/api/wallet/balance')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('balance');
      expect(typeof res.body.data.balance).toBe('number');
    });

    test('无Token应返回401', async () => {
      const res = await request(BASE).get('/api/wallet/balance');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('篡改Token应返回401', async () => {
      const res = await request(BASE)
        .get('/api/wallet/balance')
        .set('Authorization', 'Bearer invalid.tampered.token');

      expect(res.status).toBe(401);
    });
  });

  // ========== 充值 ==========
  describe('POST /api/wallet/recharge', () => {
    test('正常充值应成功', async () => {
      const res = await request(BASE)
        .post('/api/wallet/recharge')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ amount: 10, method: 'alipay' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.balance).toBe(initialBalance + 10);
    });

    test('金额为0应拒绝', async () => {
      const res = await request(BASE)
        .post('/api/wallet/recharge')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ amount: 0, method: 'alipay' });

      expect(res.status).toBe(400);
    });

    test('金额为负应拒绝', async () => {
      const res = await request(BASE)
        .post('/api/wallet/recharge')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ amount: -100, method: 'alipay' });

      expect(res.status).toBe(400);
    });

    test('3位小数金额应拒绝', async () => {
      const res = await request(BASE)
        .post('/api/wallet/recharge')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ amount: 10.001, method: 'alipay' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/小数/);
    });

    test('超限金额应拒绝', async () => {
      const res = await request(BASE)
        .post('/api/wallet/recharge')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ amount: 999999, method: 'alipay' });

      expect(res.status).toBe(400);
    });

    test('非法类型应拒绝', async () => {
      const res = await request(BASE)
        .post('/api/wallet/recharge')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ amount: 'abc', method: 'alipay' });

      expect(res.status).toBe(400);
    });

    test('无Token充值应401', async () => {
      const res = await request(BASE)
        .post('/api/wallet/recharge')
        .send({ amount: 10, method: 'alipay' });

      expect(res.status).toBe(401);
    });
  });

  // ========== 交易记录 ==========
  describe('GET /api/wallet/transactions', () => {
    test('应返回交易记录列表', async () => {
      const res = await request(BASE)
        .get('/api/wallet/transactions')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('records');
      expect(res.body.data).toHaveProperty('pagination');
    });
  });

  // ========== 汇总 ==========
  describe('GET /api/wallet/summary', () => {
    test('应返回汇总信息', async () => {
      const res = await request(BASE)
        .get('/api/wallet/summary')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('currentBalance');
      expect(res.body.data).toHaveProperty('totalRecharge');
    });
  });
});
