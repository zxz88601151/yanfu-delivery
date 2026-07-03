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

SELECT '登录相关表创建完成' as result;
