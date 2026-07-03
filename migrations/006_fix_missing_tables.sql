-- 快驴同城配送平台 - 缺失表创建迁移脚本
-- 创建日期: 2026-06-03
-- 目的: 修复全链路测试中因缺失表导致的500错误

-- 1. notifications 表 - 消息通知表（商家端和全局消息）
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL COMMENT '接收用户ID',
  `type` ENUM('order', 'system', 'promotion', 'message') NOT NULL DEFAULT 'system' COMMENT '消息类型',
  `title` VARCHAR(200) NOT NULL COMMENT '通知标题',
  `content` TEXT NOT NULL COMMENT '通知内容',
  `related_id` INT DEFAULT NULL COMMENT '关联ID（订单ID、消息ID等）',
  `related_type` VARCHAR(50) DEFAULT NULL COMMENT '关联类型（order/message等）',
  `is_read` TINYINT(1) DEFAULT 0 COMMENT '是否已读',
  `read_at` TIMESTAMP NULL DEFAULT NULL COMMENT '阅读时间',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_type` (`type`),
  KEY `idx_is_read` (`is_read`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户通知表';

-- 2. orders 表 - 核心订单表（merchant_orders的替代/扩展表）
-- 注意：merchant_orders表已存在，但orders表是系统级订单的总表
CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_no` VARCHAR(50) NOT NULL UNIQUE COMMENT '订单号',
  `user_id` INT NOT NULL COMMENT '用户ID',
  `merchant_id` INT NOT NULL COMMENT '商家ID',
  `rider_id` INT DEFAULT NULL COMMENT '骑手ID',
  `rider_name` VARCHAR(50) DEFAULT NULL,
  `rider_phone` VARCHAR(20) DEFAULT NULL,
  `rider_avatar` VARCHAR(255) DEFAULT NULL,
  `status` ENUM('pending','accepted','ready','delivering','completed','cancelled','refunded') DEFAULT 'pending' COMMENT '订单状态',
  `total_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '订单总金额',
  `original_amount` DECIMAL(10,2) DEFAULT 0.00 COMMENT '原价总金额',
  `discount` DECIMAL(10,2) DEFAULT 0.00 COMMENT '优惠金额',
  `delivery_fee` DECIMAL(10,2) DEFAULT 0.00 COMMENT '配送费',
  `commission` DECIMAL(10,2) DEFAULT 0.00 COMMENT '平台佣金',
  `actual_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '实付金额',
  `coupon_id` INT DEFAULT NULL COMMENT '使用的优惠券ID',
  `coupon_discount` DECIMAL(10,2) DEFAULT 0.00 COMMENT '优惠券折扣',
  `points_deducted` INT DEFAULT 0 COMMENT '积分抵扣',
  `items` JSON NOT NULL COMMENT '订单商品明细',
  `delivery_address` TEXT NOT NULL COMMENT '收货地址',
  `delivery_name` VARCHAR(50) DEFAULT NULL COMMENT '收货人姓名',
  `delivery_phone` VARCHAR(20) DEFAULT NULL COMMENT '收货人电话',
  `delivery_latitude` DECIMAL(10,7) DEFAULT NULL COMMENT '收货人纬度',
  `delivery_longitude` DECIMAL(10,7) DEFAULT NULL COMMENT '收货人经度',
  `pickup_code` VARCHAR(10) DEFAULT NULL COMMENT '取货码',
  `delivery_code` VARCHAR(10) DEFAULT NULL COMMENT '确认码',
  `remark` TEXT COMMENT '用户备注',
  `estimated_time` INT DEFAULT NULL COMMENT '预计配送时间（分钟）',
  `paid_at` TIMESTAMP NULL DEFAULT NULL COMMENT '支付时间',
  `accepted_at` TIMESTAMP NULL DEFAULT NULL COMMENT '接单时间',
  `ready_at` TIMESTAMP NULL DEFAULT NULL COMMENT '备餐完成时间',
  `picked_at` TIMESTAMP NULL DEFAULT NULL COMMENT '取货时间',
  `delivered_at` TIMESTAMP NULL DEFAULT NULL COMMENT '送达时间',
  `completed_at` TIMESTAMP NULL DEFAULT NULL COMMENT '完成时间',
  `cancelled_at` TIMESTAMP NULL DEFAULT NULL COMMENT '取消时间',
  `cancel_reason` TEXT COMMENT '取消原因',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_merchant_id` (`merchant_id`),
  KEY `idx_rider_id` (`rider_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_delivery_address` (`delivery_address`(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统订单总表';

-- 3. merchant_promotions 表 - 商家促销活动
CREATE TABLE IF NOT EXISTS `merchant_promotions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `merchant_id` INT NOT NULL COMMENT '商家ID',
  `name` VARCHAR(100) NOT NULL COMMENT '活动名称',
  `type` ENUM('discount','free_delivery','buy_one_get_one','red_packet') NOT NULL COMMENT '活动类型',
  `description` TEXT COMMENT '活动描述',
  `start_time` DATETIME NOT NULL COMMENT '开始时间',
  `end_time` DATETIME NOT NULL COMMENT '结束时间',
  `discount_value` DECIMAL(10,2) DEFAULT NULL COMMENT '折扣值（折扣金额或百分比）',
  `min_amount` DECIMAL(10,2) DEFAULT 0.00 COMMENT '最低消费金额',
  `max_discount` DECIMAL(10,2) DEFAULT NULL COMMENT '最大折扣金额',
  `limit_per_user` INT DEFAULT NULL COMMENT '每人限制次数',
  `total_quantity` INT DEFAULT NULL COMMENT '总数量',
  `claimed_quantity` INT DEFAULT 0 COMMENT '已领取数量',
  `is_active` TINYINT(1) DEFAULT 1 COMMENT '是否启用',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_id` (`merchant_id`),
  KEY `idx_type` (`type`),
  KEY `idx_start_time` (`start_time`),
  KEY `idx_end_time` (`end_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家促销活动表';

-- 4. merchant_withdrawals 表 - 商家提现申请
CREATE TABLE IF NOT EXISTS `merchant_withdrawals` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `merchant_id` INT NOT NULL COMMENT '商家ID',
  `amount` DECIMAL(10,2) NOT NULL COMMENT '提现金额',
  `account_type` ENUM('bank','wechat','alipay') NOT NULL DEFAULT 'wechat' COMMENT '账户类型',
  `account_name` VARCHAR(100) DEFAULT NULL COMMENT '收款人姓名',
  `account_number` VARCHAR(100) DEFAULT NULL COMMENT '收款账号',
  `bank_name` VARCHAR(100) DEFAULT NULL COMMENT '银行名称',
  `status` ENUM('pending','approved','rejected','paid') NOT NULL DEFAULT 'pending' COMMENT '审核状态',
  `remark` TEXT COMMENT '提现备注',
  `reject_reason` TEXT COMMENT '拒绝原因',
  `approved_by` INT DEFAULT NULL COMMENT '审核人ID',
  `approved_at` TIMESTAMP NULL DEFAULT NULL COMMENT '审核时间',
  `paid_at` TIMESTAMP NULL DEFAULT NULL COMMENT '打款时间',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_id` (`merchant_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家提现表';

-- 5. rider_income_adjustments 表 - 骑手收入调整记录
CREATE TABLE IF NOT EXISTS `rider_income_adjustments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `rider_id` INT NOT NULL COMMENT '骑手ID',
  `amount` DECIMAL(10,2) NOT NULL COMMENT '调整金额',
  `type` ENUM('bonus','penalty','refund','manual') NOT NULL COMMENT '调整类型',
  `reason` VARCHAR(255) DEFAULT NULL COMMENT '调整原因',
  `related_id` INT DEFAULT NULL COMMENT '关联ID',
  `related_type` VARCHAR(50) DEFAULT NULL COMMENT '关联类型',
  `adjusted_by` INT DEFAULT NULL COMMENT '操作人ID',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rider_id` (`rider_id`),
  KEY `idx_type` (`type`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='骑手收入调整表';

-- 6. system_config 表 - 系统配置
CREATE TABLE IF NOT EXISTS `system_config` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `config_key` VARCHAR(100) NOT NULL UNIQUE COMMENT '配置键',
  `config_value` TEXT COMMENT '配置值',
  `config_type` ENUM('string','number','boolean','json') DEFAULT 'string' COMMENT '配置类型',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '配置说明',
  `is_system` TINYINT(1) DEFAULT 0 COMMENT '是否系统配置',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统配置表';

-- 7. file_uploads 表 - 文件上传记录
CREATE TABLE IF NOT EXISTS `file_uploads` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT DEFAULT NULL COMMENT '上传用户ID',
  `file_name` VARCHAR(255) NOT NULL COMMENT '文件名',
  `file_path` VARCHAR(255) NOT NULL COMMENT '文件路径',
  `file_type` VARCHAR(50) DEFAULT NULL COMMENT '文件类型',
  `file_size` INT DEFAULT NULL COMMENT '文件大小（字节）',
  `upload_source` ENUM('user','merchant','rider','admin','system') DEFAULT 'system' COMMENT '上传来源',
  `is_deleted` TINYINT(1) DEFAULT 0 COMMENT '是否删除',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_upload_source` (`upload_source`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文件上传记录表';

-- 8. logs 表 - 操作日志
CREATE TABLE IF NOT EXISTS `logs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT DEFAULT NULL COMMENT '操作用户ID',
  `user_type` ENUM('user','merchant','rider','admin') DEFAULT NULL COMMENT '操作用户类型',
  `action` VARCHAR(100) NOT NULL COMMENT '操作行为',
  `target_type` VARCHAR(50) DEFAULT NULL COMMENT '目标类型',
  `target_id` INT DEFAULT NULL COMMENT '目标ID',
  `ip` VARCHAR(45) DEFAULT NULL COMMENT 'IP地址',
  `user_agent` VARCHAR(500) DEFAULT NULL COMMENT '用户代理',
  `details` TEXT COMMENT '详情',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作日志表';

-- 9. websockets_connections 表 - WebSocket连接管理（可选，用于统计）
CREATE TABLE IF NOT EXISTS `websocket_connections` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL COMMENT '用户ID',
  `user_type` ENUM('user','merchant','rider','admin') NOT NULL COMMENT '用户类型',
  `socket_id` VARCHAR(100) NOT NULL COMMENT 'Socket.IO连接ID',
  `is_online` TINYINT(1) DEFAULT 1 COMMENT '是否在线',
  `last_heartbeat` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_socket_id` (`socket_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_is_online` (`is_online`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='WebSocket连接管理表';

-- 执行完成提示
-- SELECT 'Migration completed successfully' AS message;
