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

SELECT 'orders表创建完成' as result;
