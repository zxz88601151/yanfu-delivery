-- 添加pool_type字段到riders表
ALTER TABLE riders ADD COLUMN pool_type ENUM('newbie', 'intermediate', 'advanced') DEFAULT 'newbie' COMMENT '所属池类型';

-- 更新现有骑手的pool_type
UPDATE riders SET pool_type = 'advanced' WHERE completed_orders >= 100;
UPDATE riders SET pool_type = 'intermediate' WHERE completed_orders >= 50 AND completed_orders < 100;
UPDATE riders SET pool_type = 'newbie' WHERE completed_orders < 50 OR completed_orders IS NULL;

-- 添加last_location_at字段
ALTER TABLE riders ADD COLUMN last_location_at TIMESTAMP NULL COMMENT '最后定位时间';

SELECT 'pool_type字段添加完成' as result;
