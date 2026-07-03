-- ============================================================
-- 快驴配送平台 - 清理测试数据和占位符
-- 执行时间: 2026-05-26
-- 说明: 移除所有硬编码的测试账号和示例数据
-- ============================================================

-- 1. 移除占位符管理员账号（应通过环境变量配置）
DELETE FROM admins WHERE username = 'zxzjxx' AND password = '$2b$10$placeholder';

-- 2. 清空测试用户（如果存在test开头的手机号）
DELETE FROM users WHERE phone LIKE '1380000000%';
DELETE FROM users WHERE phone LIKE '1999999999%';

-- 3. 清空测试骑手
DELETE FROM riders WHERE phone LIKE '1380000000%';
DELETE FROM riders WHERE phone LIKE '1999999999%';

-- 4. 清空测试商家
DELETE FROM merchants WHERE phone LIKE '1380000000%';
DELETE FROM merchants WHERE name LIKE '%测试%';
DELETE FROM merchants WHERE name LIKE '%demo%';

-- 5. 清空测试订单
DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '1380000000%');
DELETE FROM orders WHERE rider_id IN (SELECT id FROM riders WHERE phone LIKE '1380000000%');

-- 6. 清空测试地址
DELETE FROM user_addresses WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '1380000000%');

-- 7. 清空测试评价
DELETE FROM reviews WHERE order_id IN (SELECT id FROM orders WHERE created_at < '2020-01-01');

-- 8. 保留系统配置数据（这些是必要的默认配置）
-- delivery_fee_configs - 配送费配置（保留）
-- eta_config - ETA配置（保留）
-- system_configs - 系统配置（保留）
-- admin_roles - 管理员角色（保留）

-- ============================================================
-- 验证清理结果
-- ============================================================

-- 检查是否还有测试数据
SELECT COUNT(*) as test_users FROM users WHERE phone LIKE '1380000000%';
SELECT COUNT(*) as test_riders FROM riders WHERE phone LIKE '1380000000%';
SELECT COUNT(*) as test_merchants FROM merchants WHERE phone LIKE '1380000000%';
SELECT COUNT(*) as placeholder_admins FROM admins WHERE password = '$2b$10$placeholder';

-- ============================================================
-- 重要提示
-- ============================================================
-- 1. 管理员账号应通过 .env 文件配置 ADMIN_USERNAME 和 ADMIN_PASSWORD
-- 2. auth.js 中的管理员登录已改为强制使用环境变量
-- 3. 生产环境部署前必须执行此脚本
-- 4. 建议定期执行清理脚本，防止测试数据积累
