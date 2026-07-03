-- 快驴配送 - 生产数据库修复脚本

-- 修复users表缺少status列
ALTER TABLE users ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER balance;

-- 修复merchants表缺少status列
ALTER TABLE merchants ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending' AFTER is_open;
