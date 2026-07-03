/**
 * 测试环境初始化
 * 在测试运行前设置环境变量
 */
process.env.NODE_ENV = 'test';
process.env.PORT = '3099'; // 使用不同端口避免与生产冲突
process.env.JWT_SECRET = 'test_jwt_secret_key_for_testing_purposes_only_32chars!!';
process.env.DB_HOST = process.env.TEST_DB_HOST || 'localhost';
process.env.DB_PORT = process.env.TEST_DB_PORT || '3306';
process.env.DB_USER = process.env.TEST_DB_USER || 'root';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'root123';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'kuailv_test';

const { pool } = require('../config/database');

beforeAll(async () => {
  // 确保测试数据库存在
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
  } finally {
    conn.release();
  }
});

afterAll(async () => {
  await pool.end();
});
