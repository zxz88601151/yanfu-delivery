-- 创建测试用户
-- 密码都是 '123456' 的 bcrypt hash

-- 用户端测试账号
INSERT INTO users (phone, password, name, avatar, status, created_at, updated_at) 
VALUES ('13800138002', '$2b$10$abcdefghijklmnopqrstuvwx', '测试用户', '', 'active', NOW(), NOW())
ON DUPLICATE KEY UPDATE phone = phone;

-- 骑手端测试账号
INSERT INTO riders (phone, password, name, status, level, rating, total_orders, created_at, updated_at)
VALUES ('13800138000', '$2b$10$abcdefghijklmnopqrstuvwx', '测试骑手', 'online', 1, 5.0, 0, NOW(), NOW())
ON DUPLICATE KEY UPDATE phone = phone;

-- 商家端测试账号
INSERT INTO merchants (phone, password, name, shop_name, status, is_open, rating, created_at, updated_at)
VALUES ('13800138001', '$2b$10$abcdefghijklmnopqrstuvwx', '测试商家', '测试店铺', 'active', true, 5.0, NOW(), NOW())
ON DUPLICATE KEY UPDATE phone = phone;

SELECT 'Test users created successfully' as result;
