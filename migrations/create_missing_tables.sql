-- ============================================================
-- 快驴配送 - 创建缺失的数据库表
-- ============================================================

-- 1. 用户地址表
CREATE TABLE IF NOT EXISTS user_addresses (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  name VARCHAR(50) NOT NULL COMMENT '收货人姓名',
  phone VARCHAR(20) NOT NULL COMMENT '收货人电话',
  province VARCHAR(50) NOT NULL COMMENT '省份',
  city VARCHAR(50) NOT NULL COMMENT '城市',
  district VARCHAR(50) NOT NULL COMMENT '区县',
  address VARCHAR(255) NOT NULL COMMENT '详细地址',
  latitude DECIMAL(10, 7) COMMENT '纬度',
  longitude DECIMAL(10, 7) COMMENT '经度',
  is_default TINYINT(1) DEFAULT 0 COMMENT '是否默认地址',
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

SELECT '所有缺失表创建完成' as result;
