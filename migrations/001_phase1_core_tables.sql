-- 快驴同城配送平台 - 第一阶段核心功能数据库迁移
-- 创建时间: 2026-05-21
-- 包含: 支付、退款、评价、优惠券、骑手位置等核心表

-- ============================================
-- 1. 支付订单表
-- ============================================
CREATE TABLE IF NOT EXISTS payments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_no VARCHAR(64) NOT NULL UNIQUE COMMENT '支付订单号',
    user_id INT NOT NULL COMMENT '用户ID',
    merchant_order_id INT DEFAULT NULL COMMENT '关联商家订单ID',
    rider_order_id INT DEFAULT NULL COMMENT '关联骑手订单ID',
    amount DECIMAL(10, 2) NOT NULL COMMENT '支付金额',
    channel ENUM('wechat', 'alipay', 'balance') NOT NULL COMMENT '支付渠道',
    status ENUM('pending', 'success', 'failed', 'cancelled') DEFAULT 'pending' COMMENT '支付状态',
    third_party_no VARCHAR(128) DEFAULT NULL COMMENT '第三方支付流水号',
    paid_at TIMESTAMP NULL DEFAULT NULL COMMENT '支付完成时间',
    notify_data JSON DEFAULT NULL COMMENT '支付回调原始数据',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_merchant_order_id (merchant_order_id),
    INDEX idx_rider_order_id (rider_order_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='支付订单表';

-- ============================================
-- 2. 退款申请表
-- ============================================
CREATE TABLE IF NOT EXISTS refunds (
    id INT PRIMARY KEY AUTO_INCREMENT,
    refund_no VARCHAR(64) NOT NULL UNIQUE COMMENT '退款单号',
    payment_id INT NOT NULL COMMENT '关联支付订单ID',
    user_id INT NOT NULL COMMENT '用户ID',
    order_id INT NOT NULL COMMENT '关联订单ID',
    order_type ENUM('merchant', 'rider') NOT NULL COMMENT '订单类型',
    amount DECIMAL(10, 2) NOT NULL COMMENT '退款金额',
    reason VARCHAR(500) NOT NULL COMMENT '退款原因',
    status ENUM('pending', 'approved', 'rejected', 'processing', 'completed') DEFAULT 'pending' COMMENT '退款状态',
    reject_reason VARCHAR(500) DEFAULT NULL COMMENT '拒绝原因',
    handled_by INT DEFAULT NULL COMMENT '处理人ID（管理员）',
    handled_at TIMESTAMP NULL DEFAULT NULL COMMENT '处理时间',
    third_party_no VARCHAR(128) DEFAULT NULL COMMENT '第三方退款流水号',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_payment_id (payment_id),
    INDEX idx_user_id (user_id),
    INDEX idx_order_id (order_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='退款申请表';

-- ============================================
-- 3. 评价表
-- ============================================
CREATE TABLE IF NOT EXISTS reviews (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL COMMENT '用户ID',
    merchant_id INT DEFAULT NULL COMMENT '商家ID（评价商家时）',
    rider_id INT DEFAULT NULL COMMENT '骑手ID（评价骑手时）',
    order_id INT NOT NULL COMMENT '关联订单ID',
    order_type ENUM('merchant', 'rider') NOT NULL COMMENT '订单类型',
    rating TINYINT NOT NULL COMMENT '评分 1-5',
    content TEXT DEFAULT NULL COMMENT '评价内容',
    tags JSON DEFAULT NULL COMMENT '评价标签（如：配送快、味道好）',
    is_anonymous TINYINT(1) DEFAULT 0 COMMENT '是否匿名',
    merchant_reply TEXT DEFAULT NULL COMMENT '商家回复',
    merchant_replied_at TIMESTAMP NULL DEFAULT NULL COMMENT '商家回复时间',
    status ENUM('active', 'hidden', 'deleted') DEFAULT 'active' COMMENT '评价状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_merchant_id (merchant_id),
    INDEX idx_rider_id (rider_id),
    INDEX idx_order_id (order_id),
    INDEX idx_rating (rating),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='评价表';

-- ============================================
-- 4. 评价图片表
-- ============================================
CREATE TABLE IF NOT EXISTS review_images (
    id INT PRIMARY KEY AUTO_INCREMENT,
    review_id INT NOT NULL COMMENT '关联评价ID',
    image_url VARCHAR(500) NOT NULL COMMENT '图片URL',
    sort_order INT DEFAULT 0 COMMENT '排序',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_review_id (review_id),
    INDEX idx_sort_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='评价图片表';

-- ============================================
-- 5. 优惠券表
-- ============================================
CREATE TABLE IF NOT EXISTS coupons (
    id INT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(32) NOT NULL UNIQUE COMMENT '优惠券码',
    name VARCHAR(100) NOT NULL COMMENT '优惠券名称',
    type ENUM('platform', 'merchant') NOT NULL DEFAULT 'platform' COMMENT '优惠券类型',
    merchant_id INT DEFAULT NULL COMMENT '商家ID（商家券时必填）',
    discount_type ENUM('fixed', 'percent', 'threshold') NOT NULL COMMENT '优惠类型：固定金额/百分比/满减',
    discount_value DECIMAL(10, 2) NOT NULL COMMENT '优惠值',
    threshold_amount DECIMAL(10, 2) DEFAULT 0 COMMENT '使用门槛金额',
    max_discount DECIMAL(10, 2) DEFAULT NULL COMMENT '最大优惠金额（百分比券时）',
    total_quantity INT NOT NULL DEFAULT 0 COMMENT '总发放数量（0为不限）',
    remaining_quantity INT NOT NULL DEFAULT 0 COMMENT '剩余数量',
    per_user_limit INT DEFAULT 1 COMMENT '每人限领数量',
    start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
    end_time TIMESTAMP NOT NULL DEFAULT '2030-12-31 23:59:59' COMMENT '结束时间',
    applicable_scope JSON DEFAULT NULL COMMENT '适用范围（商家ID列表、品类等）',
    status ENUM('active', 'paused', 'expired', 'depleted') DEFAULT 'active' COMMENT '状态',
    created_by INT DEFAULT NULL COMMENT '创建人ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_merchant_id (merchant_id),
    INDEX idx_type (type),
    INDEX idx_status (status),
    INDEX idx_start_time (start_time),
    INDEX idx_end_time (end_time),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='优惠券表';

-- ============================================
-- 6. 用户优惠券领取记录表
-- ============================================
CREATE TABLE IF NOT EXISTS user_coupons (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL COMMENT '用户ID',
    coupon_id INT NOT NULL COMMENT '优惠券ID',
    status ENUM('unused', 'used', 'expired', 'refunded') DEFAULT 'unused' COMMENT '状态',
    used_order_id INT DEFAULT NULL COMMENT '使用的订单ID',
    used_at TIMESTAMP NULL DEFAULT NULL COMMENT '使用时间',
    acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '领取时间',
    expires_at TIMESTAMP NOT NULL DEFAULT '2030-12-31 23:59:59' COMMENT '过期时间',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_coupon (user_id, coupon_id),
    INDEX idx_user_id (user_id),
    INDEX idx_coupon_id (coupon_id),
    INDEX idx_status (status),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户优惠券领取记录表';

-- ============================================
-- 7. 骑手实时位置表
-- ============================================
CREATE TABLE IF NOT EXISTS rider_locations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    rider_id INT NOT NULL COMMENT '骑手ID',
    latitude DECIMAL(10, 8) NOT NULL COMMENT '纬度',
    longitude DECIMAL(11, 8) NOT NULL COMMENT '经度',
    accuracy DECIMAL(8, 2) DEFAULT NULL COMMENT '定位精度（米）',
    altitude DECIMAL(8, 2) DEFAULT NULL COMMENT '海拔',
    speed DECIMAL(6, 2) DEFAULT NULL COMMENT '速度（m/s）',
    heading DECIMAL(5, 2) DEFAULT NULL COMMENT '方向（度）',
    location_time TIMESTAMP NOT NULL COMMENT '定位时间（设备时间）',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_rider_id (rider_id),
    INDEX idx_location_time (location_time),
    INDEX idx_created_at (created_at),
    INDEX idx_location (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='骑手实时位置表';

-- ============================================
-- 8. 骑手位置历史表（按天分区）
-- ============================================
CREATE TABLE IF NOT EXISTS rider_location_history (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    rider_id INT NOT NULL COMMENT '骑手ID',
    latitude DECIMAL(10, 8) NOT NULL COMMENT '纬度',
    longitude DECIMAL(11, 8) NOT NULL COMMENT '经度',
    location_time TIMESTAMP NOT NULL COMMENT '定位时间',
    date_str VARCHAR(10) NOT NULL COMMENT '日期字符串YYYY-MM-DD（用于分区）',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_rider_id_date (rider_id, date_str),
    INDEX idx_location_time (location_time),
    INDEX idx_date_str (date_str)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='骑手位置历史表';

-- ============================================
-- 9. 满减活动表
-- ============================================
CREATE TABLE IF NOT EXISTS promotions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL COMMENT '活动名称',
    type ENUM('platform', 'merchant') NOT NULL DEFAULT 'platform' COMMENT '活动类型',
    merchant_id INT DEFAULT NULL COMMENT '商家ID',
    start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
    end_time TIMESTAMP NOT NULL DEFAULT '2030-12-31 23:59:59' COMMENT '结束时间',
    status ENUM('active', 'paused', 'expired') DEFAULT 'active' COMMENT '状态',
    description TEXT DEFAULT NULL COMMENT '活动描述',
    created_by INT DEFAULT NULL COMMENT '创建人ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_merchant_id (merchant_id),
    INDEX idx_status (status),
    INDEX idx_start_time (start_time),
    INDEX idx_end_time (end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='满减活动表';

-- ============================================
-- 10. 满减规则表
-- ============================================
CREATE TABLE IF NOT EXISTS promotion_rules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    promotion_id INT NOT NULL COMMENT '关联活动ID',
    threshold_amount DECIMAL(10, 2) NOT NULL COMMENT '门槛金额',
    discount_amount DECIMAL(10, 2) NOT NULL COMMENT '优惠金额',
    sort_order INT DEFAULT 0 COMMENT '排序（多档满减时）',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_promotion_id (promotion_id),
    INDEX idx_threshold_amount (threshold_amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='满减规则表';

-- ============================================
-- 11. 公告表
-- ============================================
CREATE TABLE IF NOT EXISTS announcements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(200) NOT NULL COMMENT '公告标题',
    content TEXT NOT NULL COMMENT '公告内容',
    type ENUM('platform', 'user', 'merchant', 'rider') NOT NULL COMMENT '公告类型',
    priority ENUM('low', 'normal', 'high', 'urgent') DEFAULT 'normal' COMMENT '优先级',
    target_scope JSON DEFAULT NULL COMMENT '目标范围（如特定城市、全部）',
    start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始展示时间',
    end_time TIMESTAMP DEFAULT '2030-12-31 23:59:59' COMMENT '结束展示时间',
    is_top TINYINT(1) DEFAULT 0 COMMENT '是否置顶',
    view_count INT DEFAULT 0 COMMENT '浏览次数',
    status ENUM('draft', 'published', 'archived') DEFAULT 'draft' COMMENT '状态',
    created_by INT DEFAULT NULL COMMENT '创建人ID',
    published_at TIMESTAMP NULL DEFAULT NULL COMMENT '发布时间',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type (type),
    INDEX idx_status (status),
    INDEX idx_start_time (start_time),
    INDEX idx_end_time (end_time),
    INDEX idx_is_top (is_top)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='公告表';

-- ============================================
-- 12. 管理员操作日志表
-- ============================================
CREATE TABLE IF NOT EXISTS admin_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    admin_id INT NOT NULL COMMENT '管理员ID',
    action VARCHAR(50) NOT NULL COMMENT '操作类型',
    target_type VARCHAR(50) NOT NULL COMMENT '操作对象类型（user/merchant/rider/order等）',
    target_id INT NOT NULL COMMENT '操作对象ID',
    details JSON DEFAULT NULL COMMENT '操作详情',
    ip_address VARCHAR(45) DEFAULT NULL COMMENT 'IP地址',
    user_agent VARCHAR(500) DEFAULT NULL COMMENT 'User-Agent',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_admin_id (admin_id),
    INDEX idx_action (action),
    INDEX idx_target (target_type, target_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员操作日志表';

-- ============================================
-- 13. 用户已读公告记录表
-- ============================================
CREATE TABLE IF NOT EXISTS user_announcement_reads (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL COMMENT '用户ID',
    user_type ENUM('user', 'merchant', 'rider') NOT NULL COMMENT '用户类型',
    announcement_id INT NOT NULL COMMENT '公告ID',
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '阅读时间',
    UNIQUE KEY uk_user_announcement (user_id, user_type, announcement_id),
    INDEX idx_user_id (user_id, user_type),
    INDEX idx_announcement_id (announcement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户已读公告记录表';

-- ============================================
-- 14. 配送费配置表
-- ============================================
CREATE TABLE IF NOT EXISTS delivery_fee_configs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL COMMENT '配置名称',
    city_code VARCHAR(20) DEFAULT NULL COMMENT '城市代码（null为默认配置）',
    base_fee DECIMAL(6, 2) NOT NULL DEFAULT 0 COMMENT '基础配送费',
    base_distance INT NOT NULL DEFAULT 3000 COMMENT '基础距离（米）',
    extra_fee_per_km DECIMAL(6, 2) NOT NULL DEFAULT 0 COMMENT '超出部分每公里费用',
    max_fee DECIMAL(6, 2) DEFAULT NULL COMMENT '最高配送费',
    night_fee_extra DECIMAL(6, 2) DEFAULT 0 COMMENT '夜间加价',
    night_start_time TIME DEFAULT '22:00:00' COMMENT '夜间开始时间',
    night_end_time TIME DEFAULT '06:00:00' COMMENT '夜间结束时间',
    weather_fee_extra DECIMAL(6, 2) DEFAULT 0 COMMENT '恶劣天气加价',
    is_default TINYINT(1) DEFAULT 0 COMMENT '是否为默认配置',
    status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_city_code (city_code),
    INDEX idx_is_default (is_default),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='配送费配置表';

-- 插入默认配送费配置
INSERT INTO delivery_fee_configs (name, base_fee, base_distance, extra_fee_per_km, max_fee, is_default, status)
VALUES ('默认配置', 3.00, 3000, 1.00, 15.00, 1, 'active')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- ============================================
-- 完成
-- ============================================
SELECT '数据库迁移完成！共创建 14 张表' AS message;
