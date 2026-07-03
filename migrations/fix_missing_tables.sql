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

SELECT '修复表创建完成' as result;
