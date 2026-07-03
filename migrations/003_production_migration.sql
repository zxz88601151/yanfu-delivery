-- ============================================================
-- 快驴同城配送平台 - 生产级一站式数据库迁移脚本
-- 文件: 003_production_migration.sql
-- 创建时间: 2026-05-24
-- 说明: 本脚本合并了所有阶段的数据库迁移，按顺序执行全部建表语句
--       和存储过程。所有 CREATE TABLE 使用 IF NOT EXISTS 确保幂等性，
--       可安全重复执行。
--
-- 执行顺序:
--   1. 001_phase1_core_tables.sql    - 支付、退款、评价、优惠券、骑手位置等核心表
--   2. 002_phase3_tables.sql         - 客服工单、管理员角色、风控等第三阶段表
--   3. create_missing_tables.sql     - 用户地址、商家/骑手评价、ETA、系统配置等
--   4. create_login_tables.sql       - 登录失败记录表
--   5. create_orders.sql             - 订单主表
--   6. fix_missing_tables.sql        - 订单ETA日志、骑手公平性记录
--   7. admin_new_tables.sql          - 管理员操作日志、商家处罚、平台优惠券、广告位、风控事件
--   8. merchant_new_tables.sql       - 商家资质、合同、菜品分类、套餐、结算、员工等
--   9. rider_new_tables.sql          - 骑手评价、信用扣分、申诉、奖励、银行卡等
--
-- 注意事项:
--   - 执行前请确保已创建 kuailv 数据库
--   - 需要 MySQL 5.7+ 兼容
--   - 存储过程用于安全 ALTER TABLE（添加缺失字段）
-- ============================================================


-- ############################################################
-- 第0部分: 管理员表（核心基础表）
-- ############################################################

-- ============================================
-- 0. 管理员表
-- ============================================
CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'admin',
  status ENUM('active', 'disabled') DEFAULT 'active',
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员表';

-- 注意: 管理员账号应通过 .env 环境变量配置，不在数据库中硬编码
-- 参见 backend/.env.example 中的 ADMIN_USERNAME 和 ADMIN_PASSWORD

-- ############################################################
-- 第1部分: 001_phase1_core_tables.sql
-- 支付、退款、评价、优惠券、骑手位置等核心表
-- ############################################################

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


-- ############################################################
-- 第2部分: 002_phase3_tables.sql
-- 客服工单、管理员角色、风控等第三阶段表
-- ############################################################

-- 1. 客服工单表
CREATE TABLE IF NOT EXISTS tickets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ticket_no VARCHAR(64) NOT NULL UNIQUE COMMENT '工单号',
    user_id INT NOT NULL COMMENT '用户ID',
    user_type ENUM('user', 'merchant', 'rider') NOT NULL COMMENT '用户类型',
    category VARCHAR(50) NOT NULL COMMENT '工单分类（退款、投诉、咨询、建议）',
    title VARCHAR(200) NOT NULL COMMENT '工单标题',
    content TEXT NOT NULL COMMENT '工单内容',
    status ENUM('open', 'processing', 'resolved', 'closed') DEFAULT 'open' COMMENT '状态',
    priority ENUM('low', 'normal', 'high', 'urgent') DEFAULT 'normal' COMMENT '优先级',
    assigned_to INT DEFAULT NULL COMMENT '处理人ID（管理员）',
    assigned_at TIMESTAMP NULL DEFAULT NULL COMMENT '分配时间',
    resolution TEXT DEFAULT NULL COMMENT '处理结果',
    resolved_at TIMESTAMP NULL DEFAULT NULL COMMENT '解决时间',
    rating TINYINT DEFAULT NULL COMMENT '用户评分',
    related_order_id INT DEFAULT NULL COMMENT '关联订单ID',
    related_order_type VARCHAR(20) DEFAULT NULL COMMENT '关联订单类型',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_category (category),
    INDEX idx_assigned_to (assigned_to),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客服工单表';

-- 2. 工单消息表
CREATE TABLE IF NOT EXISTS ticket_messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ticket_id INT NOT NULL COMMENT '工单ID',
    sender_type ENUM('user', 'admin') NOT NULL COMMENT '发送者类型',
    sender_id INT NOT NULL COMMENT '发送者ID',
    content TEXT NOT NULL COMMENT '消息内容',
    attachments JSON DEFAULT NULL COMMENT '附件列表',
    is_internal TINYINT(1) DEFAULT 0 COMMENT '是否内部备注（用户不可见）',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ticket_id (ticket_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工单消息表';

-- 3. 管理员角色表
CREATE TABLE IF NOT EXISTS admin_roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL UNIQUE COMMENT '角色名称',
    description VARCHAR(200) DEFAULT NULL COMMENT '角色描述',
    permissions JSON DEFAULT NULL COMMENT '权限列表',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员角色表';

-- 插入默认角色
INSERT INTO admin_roles (name, description, permissions) VALUES
('super_admin', '超级管理员', '["all"]'),
('operator', '运营人员', '["users","merchants","orders","coupons","announcements"]'),
('finance', '财务人员', '["orders","refunds","delivery_fee","stats"]'),
('customer_service', '客服人员', '["tickets","users","orders"]')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- 4. 管理员角色关联表
CREATE TABLE IF NOT EXISTS admin_role_mapping (
    id INT PRIMARY KEY AUTO_INCREMENT,
    admin_id INT NOT NULL COMMENT '管理员ID',
    role_id INT NOT NULL COMMENT '角色ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_admin_role (admin_id, role_id),
    INDEX idx_admin_id (admin_id),
    INDEX idx_role_id (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员角色关联表';

-- 5. 风控规则表
CREATE TABLE IF NOT EXISTS risk_rules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL COMMENT '规则名称',
    type ENUM('order', 'user', 'rider', 'merchant') NOT NULL COMMENT '规则类型',
    rule_condition JSON NOT NULL COMMENT '触发条件',
    action ENUM('alert', 'block', 'freeze') NOT NULL DEFAULT 'alert' COMMENT '触发动作',
    status ENUM('active', 'disabled') DEFAULT 'active' COMMENT '状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type (type),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='风控规则表';

-- 6. 风控事件记录表
CREATE TABLE IF NOT EXISTS risk_events (
    id INT PRIMARY KEY AUTO_INCREMENT,
    rule_id INT DEFAULT NULL COMMENT '触发规则ID',
    target_type VARCHAR(20) NOT NULL COMMENT '目标类型',
    target_id INT NOT NULL COMMENT '目标ID',
    event_type VARCHAR(50) NOT NULL COMMENT '事件类型',
    description TEXT DEFAULT NULL COMMENT '事件描述',
    data JSON DEFAULT NULL COMMENT '事件数据',
    status ENUM('pending', 'reviewed', 'dismissed') DEFAULT 'pending' COMMENT '处理状态',
    handled_by INT DEFAULT NULL COMMENT '处理人',
    handled_at TIMESTAMP NULL DEFAULT NULL COMMENT '处理时间',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_target (target_type, target_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='风控事件记录表';


-- ############################################################
-- 第3部分: create_missing_tables.sql
-- 用户地址、商家/骑手评价、ETA、系统配置等
-- ############################################################

-- 1. 用户地址表
CREATE TABLE IF NOT EXISTS user_addresses (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  name VARCHAR(50) NOT NULL COMMENT '收货人姓名',
  phone VARCHAR(20) NOT NULL COMMENT '收货人电话',
  address VARCHAR(255) NOT NULL COMMENT '地址',
  address_detail VARCHAR(255) COMMENT '详细地址（门牌号等）',
  latitude DECIMAL(10, 7) COMMENT '纬度',
  longitude DECIMAL(10, 7) COMMENT '经度',
  is_default TINYINT(1) DEFAULT 0 COMMENT '是否默认地址',
  is_deleted TINYINT(1) DEFAULT 0 COMMENT '是否删除（软删除）',
  tag VARCHAR(20) COMMENT '标签（家/公司/学校）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_default (user_id, is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户收货地址表';

-- 2. 商家评价表
CREATE TABLE IF NOT EXISTS merchant_reviews (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  merchant_id INT NOT NULL,
  user_id INT NOT NULL,
  rating TINYINT NOT NULL COMMENT '评分1-5',
  content TEXT COMMENT '评价内容',
  tags JSON COMMENT '评价标签',
  is_anonymous TINYINT(1) DEFAULT 0 COMMENT '是否匿名',
  merchant_reply TEXT COMMENT '商家回复',
  reply_at TIMESTAMP NULL COMMENT '回复时间',
  is_visible TINYINT(1) DEFAULT 1 COMMENT '是否显示',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_merchant_id (merchant_id),
  INDEX idx_user_id (user_id),
  INDEX idx_order_id (order_id),
  INDEX idx_rating (rating),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家评价表';

-- 3. 商家优惠券表
CREATE TABLE IF NOT EXISTS merchant_coupons (
  id INT PRIMARY KEY AUTO_INCREMENT,
  merchant_id INT NOT NULL,
  name VARCHAR(100) NOT NULL COMMENT '优惠券名称',
  type ENUM('full_reduction', 'discount', 'gift') NOT NULL COMMENT '类型：满减/折扣/赠品',
  face_value DECIMAL(10, 2) NOT NULL COMMENT '面值',
  min_order_amount DECIMAL(10, 2) DEFAULT 0 COMMENT '最低订单金额',
  discount_rate DECIMAL(3, 2) COMMENT '折扣率（折扣券）',
  valid_days INT DEFAULT 7 COMMENT '有效期天数',
  total_quantity INT NOT NULL COMMENT '总数量',
  remaining_quantity INT NOT NULL COMMENT '剩余数量',
  per_user_limit INT DEFAULT 1 COMMENT '每人限领',
  start_time TIMESTAMP NOT NULL COMMENT '开始时间',
  end_time TIMESTAMP NOT NULL COMMENT '结束时间',
  status ENUM('active', 'paused', 'expired') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_merchant_id (merchant_id),
  INDEX idx_status (status),
  INDEX idx_time (start_time, end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家优惠券表';

-- 4. 商家活动表
CREATE TABLE IF NOT EXISTS merchant_promotions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  merchant_id INT NOT NULL,
  name VARCHAR(100) NOT NULL COMMENT '活动名称',
  type ENUM('full_reduction', 'discount', 'buy_gift', 'flash_sale') NOT NULL COMMENT '活动类型',
  rules JSON NOT NULL COMMENT '活动规则',
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  status ENUM('upcoming', 'active', 'ended') DEFAULT 'upcoming',
  display_order INT DEFAULT 0 COMMENT '显示顺序',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_merchant_id (merchant_id),
  INDEX idx_status (status),
  INDEX idx_time (start_time, end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家活动表';

-- 5. 骑手评价表
CREATE TABLE IF NOT EXISTS rider_reviews (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  rider_id INT NOT NULL,
  user_id INT NOT NULL,
  rating TINYINT NOT NULL COMMENT '评分1-5',
  content TEXT COMMENT '评价内容',
  tags JSON COMMENT '评价标签',
  is_complaint TINYINT(1) DEFAULT 0 COMMENT '是否为投诉',
  complaint_status ENUM('pending', 'processing', 'resolved', 'rejected') DEFAULT NULL,
  platform_reply TEXT COMMENT '平台回复',
  is_visible TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rider_id (rider_id),
  INDEX idx_user_id (user_id),
  INDEX idx_order_id (order_id),
  INDEX idx_rating (rating),
  INDEX idx_complaint (is_complaint, complaint_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='骑手评价表';

-- 6. 骑手设置表
CREATE TABLE IF NOT EXISTS rider_settings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  rider_id INT NOT NULL UNIQUE,
  auto_accept TINYINT(1) DEFAULT 0 COMMENT '自动接单',
  max_active_orders INT DEFAULT 4 COMMENT '最大接单数',
  notification_sound TINYINT(1) DEFAULT 1 COMMENT '提示音',
  notification_vibration TINYINT(1) DEFAULT 1 COMMENT '震动',
  work_start_time TIME DEFAULT '08:00:00',
  work_end_time TIME DEFAULT '22:00:00',
  rest_days JSON COMMENT '休息日',
  preferred_areas JSON COMMENT '偏好区域',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rider_id (rider_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='骑手设置表';

-- 7. 骑手银行卡表
CREATE TABLE IF NOT EXISTS rider_bank_cards (
  id INT PRIMARY KEY AUTO_INCREMENT,
  rider_id INT NOT NULL,
  bank_name VARCHAR(50) NOT NULL COMMENT '银行名称',
  card_type ENUM('debit', 'credit') DEFAULT 'debit' COMMENT '卡类型',
  card_number VARCHAR(30) NOT NULL COMMENT '卡号（加密存储）',
  card_number_mask VARCHAR(30) NOT NULL COMMENT '掩码卡号',
  cardholder_name VARCHAR(50) NOT NULL COMMENT '持卡人姓名',
  is_default TINYINT(1) DEFAULT 0,
  verified_at TIMESTAMP NULL COMMENT '验证时间',
  status ENUM('pending', 'verified', 'rejected') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_rider_id (rider_id),
  INDEX idx_default (rider_id, is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='骑手银行卡表';

-- 8. 三池派单相关表
CREATE TABLE IF NOT EXISTS dispatch_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  rider_id INT,
  pool_type ENUM('newbie', 'intermediate', 'advanced') COMMENT '池类型',
  dispatch_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status ENUM('success', 'failed', 'reassigned', 'timeout') NOT NULL,
  reason VARCHAR(255) COMMENT '原因',
  response_time_ms INT COMMENT '响应时间毫秒',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_id (order_id),
  INDEX idx_rider_id (rider_id),
  INDEX idx_pool_type (pool_type),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='派单日志表';

-- 9. 骑手通知表
CREATE TABLE IF NOT EXISTS rider_notifications (
  id INT PRIMARY KEY AUTO_INCREMENT,
  rider_id INT NOT NULL,
  type VARCHAR(50) NOT NULL COMMENT '通知类型',
  title VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  data JSON COMMENT '附加数据',
  is_read TINYINT(1) DEFAULT 0,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rider_id (rider_id),
  INDEX idx_is_read (rider_id, is_read),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='骑手通知表';

-- 10. ETA记录表
CREATE TABLE IF NOT EXISTS eta_records (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_no VARCHAR(50) NOT NULL,
  merchant_order_id VARCHAR(50),
  rider_order_id VARCHAR(50),
  eta_minutes INT NOT NULL COMMENT '预估分钟数',
  eta_timestamp TIMESTAMP NOT NULL COMMENT '预估送达时间',
  confidence DECIMAL(3, 2) DEFAULT 0.85 COMMENT '置信度',
  breakdown JSON COMMENT '时间分解',
  params JSON COMMENT '计算参数',
  refresh_stage VARCHAR(20) DEFAULT 'create' COMMENT '刷新阶段',
  is_locked TINYINT(1) DEFAULT 0 COMMENT '是否锁定',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_order_no (order_no),
  INDEX idx_eta_timestamp (eta_timestamp),
  INDEX idx_stage (refresh_stage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ETA记录表';

-- 11. ETA配置表
CREATE TABLE IF NOT EXISTS eta_config (
  id INT PRIMARY KEY AUTO_INCREMENT,
  config_key VARCHAR(50) NOT NULL UNIQUE,
  config_value TEXT NOT NULL,
  description VARCHAR(255),
  is_enabled TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_key (config_key),
  INDEX idx_enabled (is_enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='ETA配置表';

-- 12. 出餐时间预估表
CREATE TABLE IF NOT EXISTS prep_time_estimates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  merchant_id INT NOT NULL,
  estimated_minutes INT NOT NULL,
  confidence DECIMAL(3, 2) DEFAULT 0.75,
  breakdown JSON COMMENT '时间分解',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_merchant_id (merchant_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='出餐时间预估表';

-- 13. 出餐时间异常表
CREATE TABLE IF NOT EXISTS prep_time_exceptions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  merchant_id INT NOT NULL,
  estimated_minutes INT,
  actual_minutes INT NOT NULL,
  reason VARCHAR(255) NOT NULL COMMENT '异常原因',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_id (order_id),
  INDEX idx_merchant_id (merchant_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='出餐时间异常表';

-- 14. 商家出餐统计表
CREATE TABLE IF NOT EXISTS merchant_prep_stats (
  id INT PRIMARY KEY AUTO_INCREMENT,
  merchant_id INT NOT NULL UNIQUE,
  avg_prep_time DECIMAL(5, 2) COMMENT '平均出餐时间',
  total_orders INT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_merchant_id (merchant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家出餐统计表';

-- 15. Token刷新相关表
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  user_type ENUM('user', 'rider', 'merchant', 'admin') NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id, user_type),
  INDEX idx_token (token),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Token刷新表';

-- 16. 操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT,
  user_type VARCHAR(20),
  action VARCHAR(50) NOT NULL COMMENT '操作类型',
  target_type VARCHAR(50) COMMENT '目标类型',
  target_id INT COMMENT '目标ID',
  details JSON COMMENT '操作详情',
  ip_address VARCHAR(45) COMMENT 'IP地址',
  user_agent TEXT COMMENT '用户代理',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id, user_type),
  INDEX idx_action (action),
  INDEX idx_target (target_type, target_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作日志表';

-- 17. 系统配置表
CREATE TABLE IF NOT EXISTS system_configs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  config_key VARCHAR(100) NOT NULL UNIQUE,
  config_value TEXT NOT NULL,
  config_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
  description VARCHAR(255),
  is_editable TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统配置表';

-- 初始化ETA配置
INSERT INTO eta_config (config_key, config_value, description) VALUES
('base_time', '7', '基础配送时间（分钟）'),
('distance_factor', '3', '每公里时间（分钟）'),
('peak_morning_start', '7', '早高峰开始时间'),
('peak_morning_end', '9', '早高峰结束时间'),
('peak_evening_start', '17', '晚高峰开始时间'),
('peak_evening_end', '19', '晚高峰结束时间'),
('weather_rain_factor', '1.3', '雨天时间系数'),
('weather_snow_factor', '1.8', '雪天时间系数'),
('traffic_smooth', '1.0', '畅通路况系数'),
('traffic_moderate', '1.2', '缓行路况系数'),
('traffic_congested', '1.5', '拥堵路况系数')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);

-- 初始化系统配置
INSERT INTO system_configs (config_key, config_value, config_type, description) VALUES
('app_name', '快驴配送', 'string', '应用名称'),
('app_version', '1.0.0', 'string', '应用版本'),
('maintenance_mode', 'false', 'boolean', '维护模式'),
('max_upload_size', '10485760', 'number', '最大上传大小（字节）'),
('session_timeout', '7200', 'number', '会话超时时间（秒）'),
('jwt_access_token_expiry', '3600', 'number', 'Access Token有效期（秒）'),
('jwt_refresh_token_expiry', '604800', 'number', 'Refresh Token有效期（秒）')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);


-- ############################################################
-- 第4部分: create_login_tables.sql
-- 登录失败记录表
-- ############################################################

-- 登录失败记录表
CREATE TABLE IF NOT EXISTS login_failures (
  id INT PRIMARY KEY AUTO_INCREMENT,
  account VARCHAR(50) NOT NULL COMMENT '账号（手机号或用户名）',
  user_type ENUM('rider', 'merchant', 'admin', 'user') NOT NULL,
  ip_address VARCHAR(45) COMMENT 'IP地址',
  user_agent TEXT COMMENT '用户代理',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_account (account, user_type),
  INDEX idx_created_at (created_at),
  INDEX idx_ip (ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='登录失败记录表';


-- ############################################################
-- 第5部分: create_orders.sql
-- 订单主表
-- ############################################################

-- 创建orders表
CREATE TABLE IF NOT EXISTS orders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_no VARCHAR(50) NOT NULL UNIQUE COMMENT '订单编号',
  user_id INT NOT NULL COMMENT '用户ID',
  merchant_id INT NOT NULL COMMENT '商家ID',
  rider_id INT COMMENT '骑手ID',
  status ENUM('pending', 'assigned', 'picking', 'delivering', 'completed', 'cancelled') DEFAULT 'pending' COMMENT '订单状态',
  pool_type ENUM('newbie', 'intermediate', 'advanced') COMMENT '派单池类型',

  -- 金额信息
  total_amount DECIMAL(10, 2) NOT NULL COMMENT '订单总金额',
  delivery_fee DECIMAL(10, 2) DEFAULT 0 COMMENT '配送费',
  discount_amount DECIMAL(10, 2) DEFAULT 0 COMMENT '优惠金额',
  actual_amount DECIMAL(10, 2) NOT NULL COMMENT '实付金额',

  -- 地址信息
  delivery_address VARCHAR(500) NOT NULL COMMENT '配送地址',
  delivery_latitude DECIMAL(10, 7) COMMENT '配送地址纬度',
  delivery_longitude DECIMAL(10, 7) COMMENT '配送地址经度',

  -- 时间信息
  prep_time_estimate INT COMMENT '预估出餐时间（分钟）',
  prep_time_actual INT COMMENT '实际出餐时间（分钟）',
  prep_completed_at TIMESTAMP NULL COMMENT '出餐完成时间',
  eta_minutes INT COMMENT '预估配送时间（分钟）',
  assigned_at TIMESTAMP NULL COMMENT '分配时间',
  picked_at TIMESTAMP NULL COMMENT '取餐时间',
  delivered_at TIMESTAMP NULL COMMENT '送达时间',
  is_overtime TINYINT(1) DEFAULT 0 COMMENT '是否超时',

  -- 其他
  remark TEXT COMMENT '订单备注',
  cancel_reason VARCHAR(255) COMMENT '取消原因',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_user_id (user_id),
  INDEX idx_merchant_id (merchant_id),
  INDEX idx_rider_id (rider_id),
  INDEX idx_status (status),
  INDEX idx_order_no (order_no),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单表';


-- ############################################################
-- 第6部分: fix_missing_tables.sql
-- 订单ETA日志、骑手公平性记录
-- ############################################################

-- 创建order_eta_log表
CREATE TABLE IF NOT EXISTS order_eta_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  rider_id INT,
  eta_minutes INT,
  actual_minutes INT,
  is_overtime TINYINT(1) DEFAULT 0,
  is_locked TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rider_id (rider_id),
  INDEX idx_created_at (created_at),
  INDEX idx_is_locked (is_locked)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单ETA记录表';

-- 创建rider_fairness_records表
CREATE TABLE IF NOT EXISTS rider_fairness_records (
  id INT PRIMARY KEY AUTO_INCREMENT,
  rider_id INT NOT NULL,
  date DATE NOT NULL,
  assigned_orders INT DEFAULT 0,
  rejected_orders INT DEFAULT 0,
  fairness_score DECIMAL(3, 2) DEFAULT 1.0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_rider_date (rider_id, date),
  INDEX idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='骑手公平性记录表';


-- ############################################################
-- 第7部分: admin_new_tables.sql
-- 管理员操作日志、商家处罚、平台优惠券、广告位、风控事件
-- ############################################################

-- 1. 管理员操作日志
CREATE TABLE IF NOT EXISTS admin_operation_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id INT,
  detail TEXT,
  ip VARCHAR(50),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_id (admin_id),
  INDEX idx_action (action),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 商家处罚记录
CREATE TABLE IF NOT EXISTS merchant_punishments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  merchant_id INT NOT NULL,
  admin_id INT,
  type ENUM('warning','fine','suspend','close') NOT NULL,
  reason VARCHAR(500),
  amount DECIMAL(10,2) DEFAULT 0,
  duration_days INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_merchant_id (merchant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. 平台优惠券（全局）
CREATE TABLE IF NOT EXISTS platform_coupons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(30) DEFAULT 'full_reduction',
  face_value DECIMAL(10,2) NOT NULL,
  min_order_amount DECIMAL(10,2) DEFAULT 0,
  total_count INT DEFAULT 1000,
  claimed_count INT DEFAULT 0,
  used_count INT DEFAULT 0,
  start_at DATETIME,
  end_at DATETIME,
  target_type VARCHAR(30) DEFAULT 'all',
  status VARCHAR(20) DEFAULT 'active',
  created_by INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. 广告位（Banner）
CREATE TABLE IF NOT EXISTS platform_banners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  position VARCHAR(50) NOT NULL COMMENT 'home_top/popup/recommend',
  image VARCHAR(500),
  title VARCHAR(100),
  link_type VARCHAR(30) COMMENT 'merchant/promotion/url',
  link_target VARCHAR(255),
  sort_order INT DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  start_at DATETIME,
  end_at DATETIME,
  click_count INT DEFAULT 0,
  created_by INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_position (position),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. 风控事件（admin版本，与002_phase3中的risk_events结构不同，使用不同表名避免冲突）
-- 注意: 002_phase3_tables.sql 中已有 risk_events 表，此处不再重复创建
-- 以下为 admin_new_tables.sql 中定义的 risk_events 表（结构略有不同，使用 CREATE TABLE IF NOT EXISTS 会跳过）

-- 6. 申诉仲裁扩展字段（rider_appeals 已存在）
DELIMITER //

DROP PROCEDURE IF EXISTS add_admin_columns//
CREATE PROCEDURE add_admin_columns()
BEGIN
  -- rider_appeals: 仲裁字段
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='rider_appeals' AND COLUMN_NAME='arbitrated_by') THEN
    ALTER TABLE rider_appeals ADD COLUMN arbitrated_by INT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='rider_appeals' AND COLUMN_NAME='arbitrated_at') THEN
    ALTER TABLE rider_appeals ADD COLUMN arbitrated_at DATETIME;
  END IF;
  -- merchant_qualifications: 审核人字段
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_qualifications' AND COLUMN_NAME='reviewer_id') THEN
    ALTER TABLE merchant_qualifications ADD COLUMN reviewer_id INT;
  END IF;
  -- merchant_settlements: 结算人字段
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_settlements' AND COLUMN_NAME='settled_by') THEN
    ALTER TABLE merchant_settlements ADD COLUMN settled_by INT;
  END IF;
  -- merchant_refunds: 请求方字段
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_refunds' AND COLUMN_NAME='requested_by') THEN
    ALTER TABLE merchant_refunds ADD COLUMN requested_by VARCHAR(20) DEFAULT 'user';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_refunds' AND COLUMN_NAME='evidence') THEN
    ALTER TABLE merchant_refunds ADD COLUMN evidence JSON;
  END IF;
END//

CALL add_admin_columns()//
DROP PROCEDURE IF EXISTS add_admin_columns//

DELIMITER ;


-- ############################################################
-- 第8部分: merchant_new_tables.sql
-- 商家资质、合同、菜品分类、套餐、结算、员工等
-- ############################################################

-- 商家资质审核表
CREATE TABLE IF NOT EXISTS `merchant_qualifications` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id`      INT UNSIGNED NOT NULL,
  `business_license` VARCHAR(500) NOT NULL COMMENT '营业执照图片URL',
  `food_license`     VARCHAR(500) NOT NULL COMMENT '食品经营许可证URL',
  `legal_id_front`   VARCHAR(500) NOT NULL COMMENT '法人身份证正面',
  `legal_id_back`    VARCHAR(500) DEFAULT NULL COMMENT '法人身份证背面',
  `shop_front_photo` VARCHAR(500) DEFAULT NULL COMMENT '门头照片',
  `kitchen_photo`    VARCHAR(500) DEFAULT NULL COMMENT '后厨照片',
  `legal_name`       VARCHAR(50)  DEFAULT NULL COMMENT '法人姓名',
  `business_address` VARCHAR(200) DEFAULT NULL,
  `status`           ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `reject_reason`    VARCHAR(300) DEFAULT NULL,
  `submitted_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at`      DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_merchant_id` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家资质审核表';

-- 商家合同签约表
CREATE TABLE IF NOT EXISTS `merchant_contracts` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id`      INT UNSIGNED NOT NULL,
  `commission_rate`  DECIMAL(5,2) NOT NULL DEFAULT 8.00 COMMENT '佣金率（%）',
  `settlement_cycle` ENUM('T1','T7') NOT NULL DEFAULT 'T1',
  `signed_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_merchant_id` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家合同签约表';

-- 菜品分类表
CREATE TABLE IF NOT EXISTS `menu_categories` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` INT UNSIGNED NOT NULL,
  `name`        VARCHAR(50)  NOT NULL,
  `parent_id`   INT UNSIGNED DEFAULT NULL COMMENT '父分类ID，NULL为一级分类',
  `sort_order`  TINYINT      NOT NULL DEFAULT 0,
  `is_visible`  TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_id` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='菜品分类表';

-- 套餐表
CREATE TABLE IF NOT EXISTS `merchant_combos` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id`    INT UNSIGNED NOT NULL,
  `name`           VARCHAR(100) NOT NULL,
  `description`    VARCHAR(500) DEFAULT NULL,
  `price`          DECIMAL(10,2) NOT NULL,
  `original_price` DECIMAL(10,2) DEFAULT NULL,
  `image`          VARCHAR(500) DEFAULT NULL,
  `items`          JSON         DEFAULT NULL COMMENT '套餐包含菜品JSON',
  `is_available`   TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_id` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='套餐表';

-- 退款申请表
CREATE TABLE IF NOT EXISTS `merchant_refunds` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`      INT UNSIGNED NOT NULL,
  `merchant_id`   INT UNSIGNED NOT NULL,
  `refund_amount` DECIMAL(10,2) NOT NULL,
  `reason`        VARCHAR(300) NOT NULL,
  `type`          ENUM('full','partial') NOT NULL DEFAULT 'full',
  `status`        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `reject_reason` VARCHAR(300) DEFAULT NULL,
  `reviewed_at`   DATETIME     DEFAULT NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_id` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='退款申请表';

-- 营销活动表（merchant版本，与create_missing_tables中的merchant_promotions结构不同）
-- 注意: create_missing_tables.sql 中已有 merchant_promotions 表，此处使用 CREATE TABLE IF NOT EXISTS 会跳过

-- 优惠券表（merchant版本，与create_missing_tables中的merchant_coupons结构不同）
-- 注意: create_missing_tables.sql 中已有 merchant_coupons 表，此处使用 CREATE TABLE IF NOT EXISTS 会跳过

-- 商家评价表（merchant版本，与create_missing_tables中的merchant_reviews结构不同）
-- 注意: create_missing_tables.sql 中已有 merchant_reviews 表，此处使用 CREATE TABLE IF NOT EXISTS 会跳过

-- 评价申诉表
CREATE TABLE IF NOT EXISTS `merchant_review_appeals` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `review_id`   INT UNSIGNED NOT NULL,
  `merchant_id` INT UNSIGNED NOT NULL,
  `reason`      VARCHAR(500) NOT NULL,
  `evidence`    JSON         DEFAULT NULL,
  `status`      ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_review_id` (`review_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='评价申诉表';

-- 订单明细项目表（用于菜品分析）
CREATE TABLE IF NOT EXISTS `merchant_order_items` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` INT UNSIGNED NOT NULL,
  `order_id`    INT UNSIGNED NOT NULL,
  `item_id`     INT UNSIGNED DEFAULT NULL,
  `item_name`   VARCHAR(100) NOT NULL,
  `item_price`  DECIMAL(10,2) NOT NULL,
  `item_qty`    INT          NOT NULL DEFAULT 1,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_order` (`merchant_id`, `order_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单明细项目表';

-- 结算记录表
CREATE TABLE IF NOT EXISTS `merchant_settlements` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id`  INT UNSIGNED NOT NULL,
  `period_start` DATE         NOT NULL,
  `period_end`   DATE         NOT NULL,
  `order_count`  INT          NOT NULL DEFAULT 0,
  `gross_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `commission`   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `net_amount`   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `status`       ENUM('pending','processing','settled') NOT NULL DEFAULT 'pending',
  `bank_info`    VARCHAR(200) DEFAULT NULL,
  `settled_at`   DATETIME     DEFAULT NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_id` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家结算记录表';

-- 商家提现记录表
CREATE TABLE IF NOT EXISTS `merchant_withdrawals` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` INT UNSIGNED NOT NULL,
  `amount`      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `bank_name`   VARCHAR(100) DEFAULT '',
  `account_no`  VARCHAR(50)  DEFAULT '',
  `account_name` VARCHAR(100) DEFAULT '',
  `status`      ENUM('pending','processing','completed','rejected') NOT NULL DEFAULT 'pending',
  `remark`      VARCHAR(500) DEFAULT '',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_id` (`merchant_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家提现记录表';

-- 员工账号表
CREATE TABLE IF NOT EXISTS `merchant_staff` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` INT UNSIGNED NOT NULL,
  `name`        VARCHAR(50)  NOT NULL,
  `phone`       VARCHAR(20)  NOT NULL,
  `password`    VARCHAR(255) NOT NULL,
  `role`        ENUM('manager','order_taker','finance','operator') NOT NULL DEFAULT 'order_taker',
  `permissions` JSON         DEFAULT NULL,
  `status`      ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `is_deleted`  TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_id` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家员工账号表';

-- 操作日志表
CREATE TABLE IF NOT EXISTS `merchant_operation_logs` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `merchant_id` INT UNSIGNED NOT NULL,
  `operator_id` INT UNSIGNED DEFAULT NULL COMMENT 'NULL=店主',
  `action`      VARCHAR(100) NOT NULL COMMENT '操作类型',
  `detail`      VARCHAR(500) DEFAULT NULL COMMENT '操作详情',
  `ip`          VARCHAR(45)  DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_merchant_id` (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商家操作日志表';

-- ============================================================
-- merchants 表新增字段（存储过程兼容 MySQL 5.7）
-- ============================================================
DROP PROCEDURE IF EXISTS add_merchant_columns;
DELIMITER $$
CREATE PROCEDURE add_merchant_columns()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='description') THEN
    ALTER TABLE merchants ADD COLUMN description VARCHAR(500) DEFAULT NULL COMMENT '店铺简介';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='contact_phone') THEN
    ALTER TABLE merchants ADD COLUMN contact_phone VARCHAR(20) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='open_time') THEN
    ALTER TABLE merchants ADD COLUMN open_time VARCHAR(10) DEFAULT '09:00';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='close_time') THEN
    ALTER TABLE merchants ADD COLUMN close_time VARCHAR(10) DEFAULT '22:00';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='announcement') THEN
    ALTER TABLE merchants ADD COLUMN announcement VARCHAR(300) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='delivery_fee') THEN
    ALTER TABLE merchants ADD COLUMN delivery_fee DECIMAL(8,2) NOT NULL DEFAULT 0.00;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='estimated_time') THEN
    ALTER TABLE merchants ADD COLUMN estimated_time TINYINT NOT NULL DEFAULT 30 COMMENT '预计送达时长(分钟)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='delivery_type') THEN
    ALTER TABLE merchants ADD COLUMN delivery_type ENUM('platform','self') NOT NULL DEFAULT 'platform';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='banner_images') THEN
    ALTER TABLE merchants ADD COLUMN banner_images JSON DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='business_status') THEN
    ALTER TABLE merchants ADD COLUMN business_status ENUM('open','paused','closed','reservation_only') NOT NULL DEFAULT 'open';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='qualification_status') THEN
    ALTER TABLE merchants ADD COLUMN qualification_status ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='contract_signed') THEN
    ALTER TABLE merchants ADD COLUMN contract_signed TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants' AND COLUMN_NAME='commission_rate') THEN
    ALTER TABLE merchants ADD COLUMN commission_rate DECIMAL(5,2) NOT NULL DEFAULT 8.00;
  END IF;
END$$
DELIMITER ;
CALL add_merchant_columns();
DROP PROCEDURE IF EXISTS add_merchant_columns;

-- merchant_menu 表新增扩展字段
DROP PROCEDURE IF EXISTS add_menu_columns;
DELIMITER $$
CREATE PROCEDURE add_menu_columns()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_menu' AND COLUMN_NAME='original_price') THEN
    ALTER TABLE merchant_menu ADD COLUMN original_price DECIMAL(10,2) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_menu' AND COLUMN_NAME='stock') THEN
    ALTER TABLE merchant_menu ADD COLUMN stock INT DEFAULT NULL COMMENT 'NULL=不限库存';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_menu' AND COLUMN_NAME='category_id') THEN
    ALTER TABLE merchant_menu ADD COLUMN category_id INT UNSIGNED DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_menu' AND COLUMN_NAME='spicy_level') THEN
    ALTER TABLE merchant_menu ADD COLUMN spicy_level TINYINT DEFAULT 0 COMMENT '0不辣/1微辣/2中辣/3重辣';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_menu' AND COLUMN_NAME='allergens') THEN
    ALTER TABLE merchant_menu ADD COLUMN allergens JSON DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_menu' AND COLUMN_NAME='specs') THEN
    ALTER TABLE merchant_menu ADD COLUMN specs JSON DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_menu' AND COLUMN_NAME='ingredients') THEN
    ALTER TABLE merchant_menu ADD COLUMN ingredients JSON DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_menu' AND COLUMN_NAME='sort_order') THEN
    ALTER TABLE merchant_menu ADD COLUMN sort_order SMALLINT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_menu' AND COLUMN_NAME='is_sold_out') THEN
    ALTER TABLE merchant_menu ADD COLUMN is_sold_out TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_menu' AND COLUMN_NAME='soldout_remark') THEN
    ALTER TABLE merchant_menu ADD COLUMN soldout_remark VARCHAR(100) DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_menu' AND COLUMN_NAME='soldout_restore_at') THEN
    ALTER TABLE merchant_menu ADD COLUMN soldout_restore_at DATETIME DEFAULT NULL;
  END IF;
END$$
DELIMITER ;
CALL add_menu_columns();
DROP PROCEDURE IF EXISTS add_menu_columns;

-- merchant_orders 表新增退款标记字段
DROP PROCEDURE IF EXISTS add_order_merchant_columns;
DELIMITER $$
CREATE PROCEDURE add_order_merchant_columns()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_orders' AND COLUMN_NAME='has_refund') THEN
    ALTER TABLE merchant_orders ADD COLUMN has_refund TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchant_orders' AND COLUMN_NAME='remark') THEN
    ALTER TABLE merchant_orders ADD COLUMN remark VARCHAR(300) DEFAULT NULL COMMENT '用户备注';
  END IF;
END$$
DELIMITER ;
CALL add_order_merchant_columns();
DROP PROCEDURE IF EXISTS add_order_merchant_columns;


-- ############################################################
-- 第9部分: rider_new_tables.sql
-- 骑手评价、信用扣分、申诉、奖励、银行卡等
-- ############################################################

-- 骑手评价表（rider版本，与create_missing_tables中的rider_reviews结构不同）
-- 注意: create_missing_tables.sql 中已有 rider_reviews 表，此处使用 CREATE TABLE IF NOT EXISTS 会跳过

-- 信用扣分记录表
CREATE TABLE IF NOT EXISTS `credit_deductions` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rider_id`    INT UNSIGNED NOT NULL,
  `reason`      VARCHAR(200) NOT NULL,
  `score`       TINYINT      NOT NULL DEFAULT 1,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rider_id` (`rider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 申诉表
CREATE TABLE IF NOT EXISTS `rider_appeals` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rider_id`    INT UNSIGNED NOT NULL,
  `type`        ENUM('review','deduction','order') NOT NULL,
  `target_id`   INT UNSIGNED NOT NULL,
  `reason`      VARCHAR(500) NOT NULL,
  `evidence`    JSON         DEFAULT NULL,
  `status`      ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `result`      VARCHAR(300) DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rider_id` (`rider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 扣款明细表
CREATE TABLE IF NOT EXISTS `income_deductions` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rider_id`    INT UNSIGNED NOT NULL,
  `order_id`    INT UNSIGNED DEFAULT NULL,
  `order_no`    VARCHAR(64)  DEFAULT NULL,
  `amount`      DECIMAL(10,2) NOT NULL,
  `reason`      VARCHAR(200) NOT NULL,
  `status`      ENUM('confirmed','appealing','reversed') NOT NULL DEFAULT 'confirmed',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rider_id` (`rider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 奖励活动表
CREATE TABLE IF NOT EXISTS `rider_reward_activities` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rider_id`      INT UNSIGNED DEFAULT NULL,
  `title`         VARCHAR(100) NOT NULL,
  `description`   VARCHAR(500) DEFAULT NULL,
  `reward_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `target_count`  INT          NOT NULL DEFAULT 1,
  `current_count` INT          NOT NULL DEFAULT 0,
  `status`        ENUM('active','completed','expired') NOT NULL DEFAULT 'active',
  `start_at`      DATETIME     NOT NULL,
  `end_at`        DATETIME     NOT NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rider_id` (`rider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 订单异常上报表
CREATE TABLE IF NOT EXISTS `order_exceptions` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`    INT UNSIGNED NOT NULL,
  `rider_id`    INT UNSIGNED NOT NULL,
  `type`        VARCHAR(50)  NOT NULL,
  `description` VARCHAR(500) NOT NULL,
  `photos`      JSON         DEFAULT NULL,
  `status`      ENUM('pending','processing','resolved') NOT NULL DEFAULT 'pending',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order_id` (`order_id`),
  KEY `idx_rider_id` (`rider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 骑手接单设置表（rider版本，与create_missing_tables中的rider_settings结构不同）
-- 注意: create_missing_tables.sql 中已有 rider_settings 表，此处使用 CREATE TABLE IF NOT EXISTS 会跳过

-- 工作时长日志表
CREATE TABLE IF NOT EXISTS `rider_work_logs` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rider_id`         INT UNSIGNED NOT NULL,
  `log_date`         DATE         NOT NULL,
  `duration_minutes` INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rider_date` (`rider_id`, `log_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 骑手银行卡表（rider版本，与create_missing_tables中的rider_bank_cards结构不同）
-- 注意: create_missing_tables.sql 中已有 rider_bank_cards 表，此处使用 CREATE TABLE IF NOT EXISTS 会跳过

-- 骑手消息表
CREATE TABLE IF NOT EXISTS `rider_messages` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rider_id`   INT UNSIGNED NOT NULL,
  `type`       ENUM('system','order','income','notice') NOT NULL DEFAULT 'system',
  `title`      VARCHAR(100) NOT NULL,
  `content`    TEXT         NOT NULL,
  `is_read`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rider_id_read` (`rider_id`, `is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 安全报备表
CREATE TABLE IF NOT EXISTS `rider_safety_reports` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rider_id`   INT UNSIGNED NOT NULL,
  `latitude`   DECIMAL(10,6) DEFAULT NULL,
  `longitude`  DECIMAL(10,6) DEFAULT NULL,
  `note`       VARCHAR(200)  DEFAULT NULL,
  `created_at` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rider_id` (`rider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 用存储过程兼容 MySQL 5.7，安全地给 riders 表新增字段
-- ============================================================
DROP PROCEDURE IF EXISTS add_rider_columns;
DELIMITER $$
CREATE PROCEDURE add_rider_columns()
BEGIN
  -- credit_score
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='riders' AND COLUMN_NAME='credit_score') THEN
    ALTER TABLE riders ADD COLUMN credit_score SMALLINT NOT NULL DEFAULT 100;
  END IF;
  -- real_name
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='riders' AND COLUMN_NAME='real_name') THEN
    ALTER TABLE riders ADD COLUMN real_name VARCHAR(50) DEFAULT NULL;
  END IF;
  -- id_number
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='riders' AND COLUMN_NAME='id_number') THEN
    ALTER TABLE riders ADD COLUMN id_number VARCHAR(18) DEFAULT NULL;
  END IF;
  -- id_front_photo
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='riders' AND COLUMN_NAME='id_front_photo') THEN
    ALTER TABLE riders ADD COLUMN id_front_photo VARCHAR(500) DEFAULT NULL;
  END IF;
  -- id_back_photo
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='riders' AND COLUMN_NAME='id_back_photo') THEN
    ALTER TABLE riders ADD COLUMN id_back_photo VARCHAR(500) DEFAULT NULL;
  END IF;
  -- holding_photo
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='riders' AND COLUMN_NAME='holding_photo') THEN
    ALTER TABLE riders ADD COLUMN holding_photo VARCHAR(500) DEFAULT NULL;
  END IF;
  -- real_name_status
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='riders' AND COLUMN_NAME='real_name_status') THEN
    ALTER TABLE riders ADD COLUMN real_name_status ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none';
  END IF;
  -- real_name_submitted_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='riders' AND COLUMN_NAME='real_name_submitted_at') THEN
    ALTER TABLE riders ADD COLUMN real_name_submitted_at DATETIME DEFAULT NULL;
  END IF;
  -- real_name_reject_reason
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='riders' AND COLUMN_NAME='real_name_reject_reason') THEN
    ALTER TABLE riders ADD COLUMN real_name_reject_reason VARCHAR(200) DEFAULT NULL;
  END IF;
  -- freeze_reason
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='riders' AND COLUMN_NAME='freeze_reason') THEN
    ALTER TABLE riders ADD COLUMN freeze_reason VARCHAR(200) DEFAULT NULL;
  END IF;
  -- freeze_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='riders' AND COLUMN_NAME='freeze_at') THEN
    ALTER TABLE riders ADD COLUMN freeze_at DATETIME DEFAULT NULL;
  END IF;
END$$
DELIMITER ;
CALL add_rider_columns();
DROP PROCEDURE IF EXISTS add_rider_columns;

-- rider_orders 表新增 has_exception 字段
DROP PROCEDURE IF EXISTS add_order_columns;
DELIMITER $$
CREATE PROCEDURE add_order_columns()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='rider_orders' AND COLUMN_NAME='has_exception') THEN
    ALTER TABLE rider_orders ADD COLUMN has_exception TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
END$$
DELIMITER ;
CALL add_order_columns();
DROP PROCEDURE IF EXISTS add_order_columns;


-- ############################################################
-- 迁移完成
-- ############################################################
SELECT '========================================' AS '';
SELECT '生产级数据库迁移全部完成！' AS message;
SELECT '========================================' AS '';
SELECT CONCAT('迁移时间: ', NOW()) AS info;
SELECT '已合并执行以下迁移文件:' AS info;
SELECT '  1. 001_phase1_core_tables.sql    (14张表)' AS info;
SELECT '  2. 002_phase3_tables.sql         (6张表)' AS info;
SELECT '  3. create_missing_tables.sql     (17张表)' AS info;
SELECT '  4. create_login_tables.sql       (1张表)' AS info;
SELECT '  5. create_orders.sql             (1张表)' AS info;
SELECT '  6. fix_missing_tables.sql        (2张表)' AS info;
SELECT '  7. admin_new_tables.sql          (5张表 + ALTER存储过程)' AS info;
SELECT '  8. merchant_new_tables.sql       (9张表 + ALTER存储过程)' AS info;
SELECT '  9. rider_new_tables.sql          (8张表 + ALTER存储过程)' AS info;
SELECT '注意: 部分同名表在不同文件中结构不同，CREATE TABLE IF NOT EXISTS 会保留先创建的版本' AS warning;
SELECT '========================================' AS '';
