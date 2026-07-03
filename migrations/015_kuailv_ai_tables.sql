-- 快驴配送AI智能调度系统 - 数据库迁移
-- 创建AI相关数据表

-- AI风控规则表
CREATE TABLE IF NOT EXISTS ai_risk_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL COMMENT '规则名称',
    rule_type ENUM('keyword', 'frequency', 'amount', 'location', 'behavior', 'custom') NOT NULL,
    rule_config JSON NOT NULL COMMENT '规则配置',
    score INT NOT NULL DEFAULT 0 COMMENT '命中扣分',
    priority INT DEFAULT 0 COMMENT '优先级',
    status ENUM('active', 'inactive') DEFAULT 'active',
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- AI风控日志表
CREATE TABLE IF NOT EXISTS ai_risk_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    trace_id VARCHAR(64) NOT NULL,
    target_type ENUM('rider', 'merchant', 'user') NOT NULL,
    target_id INT NOT NULL,
    action VARCHAR(50) NOT NULL COMMENT '触发动作',
    risk_score INT DEFAULT 0,
    decision ENUM('pass', 'review', 'block') NOT NULL,
    matched_rules JSON,
    context JSON COMMENT '请求上下文',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_target (target_type, target_id),
    INDEX idx_trace (trace_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 路径优化缓存表
CREATE TABLE IF NOT EXISTS route_optimization_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dispatch_id INT NOT NULL,
    rider_id INT NOT NULL,
    waypoints JSON NOT NULL COMMENT '途经点列表',
    total_distance DECIMAL(10,2) DEFAULT 0,
    total_duration INT DEFAULT 0 COMMENT '预估分钟',
    segments JSON,
    polyline JSON,
    traffic_status VARCHAR(20) DEFAULT 'normal',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_dispatch (dispatch_id),
    INDEX idx_rider (rider_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 路径重规划事件表
CREATE TABLE IF NOT EXISTS route_replan_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dispatch_id INT NOT NULL,
    rider_id INT NOT NULL,
    trigger_reason VARCHAR(100) NOT NULL,
    old_route JSON,
    new_route JSON,
    traffic_change JSON,
    notified TINYINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_dispatch (dispatch_id),
    INDEX idx_rider (rider_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- AI预测结果表
CREATE TABLE IF NOT EXISTS ai_predictions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    region VARCHAR(50) NOT NULL,
    predict_hour DATETIME NOT NULL COMMENT '预测时段',
    predicted_orders INT DEFAULT 0,
    confidence DECIMAL(5,2) DEFAULT 0 COMMENT '置信度',
    model_version VARCHAR(20) DEFAULT 'wma_v1',
    features JSON COMMENT '特征数据',
    actual_orders INT DEFAULT NULL COMMENT '实际订单(回填)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_region_hour (region, predict_hour),
    INDEX idx_region (region),
    INDEX idx_hour (predict_hour)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 运力调度建议表
CREATE TABLE IF NOT EXISTS capacity_advice (
    id INT AUTO_INCREMENT PRIMARY KEY,
    region VARCHAR(50) NOT NULL,
    predict_hour DATETIME NOT NULL,
    predicted_orders INT DEFAULT 0,
    online_riders INT DEFAULT 0,
    needed_riders INT DEFAULT 0,
    gap_ratio DECIMAL(5,2) DEFAULT 0 COMMENT '缺口比例',
    advice JSON COMMENT '调度建议',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_region_hour (region, predict_hour)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 预测准确度表
CREATE TABLE IF NOT EXISTS prediction_accuracy (
    id INT AUTO_INCREMENT PRIMARY KEY,
    region VARCHAR(50) NOT NULL,
    record_date DATE NOT NULL,
    total_hours INT DEFAULT 0,
    mape DECIMAL(5,2) DEFAULT NULL COMMENT '平均绝对百分比误差',
    details JSON,
    evaluated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_region_date (region, record_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
