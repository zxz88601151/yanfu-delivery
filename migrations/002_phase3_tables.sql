-- 快驴同城配送平台 - 第三阶段数据库迁移
-- 数据分析、风控、客服工单

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

SELECT '第三阶段数据库迁移完成！共创建 6 张表' AS message;
