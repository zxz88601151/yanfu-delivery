-- ============================================================
-- 快驴配送 - 骑手接单设置模块
-- 数据库迁移脚本 008: 创建骑手接单设置表
-- ============================================================

CREATE TABLE IF NOT EXISTS `ai_rider_dispatch_settings` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rider_id`              BIGINT UNSIGNED NOT NULL COMMENT '骑手ID',
  `max_delivery_distance` INT NOT NULL DEFAULT 5000 COMMENT '最大配送距离(米)',
  `min_order_amount`      DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '最低订单金额(元)',
  `accept_mode`           VARCHAR(16) NOT NULL DEFAULT 'manual' COMMENT '接单模式: auto=自动接单 manual=手动抢单',
  `max_concurrent_orders` INT NOT NULL DEFAULT 3 COMMENT '最大同时接单数',
  `working_time_start`    VARCHAR(8) NOT NULL DEFAULT '06:00' COMMENT '工作时间开始',
  `working_time_end`      VARCHAR(8) NOT NULL DEFAULT '23:00' COMMENT '工作时间结束',
  `preferred_districts`   JSON DEFAULT NULL COMMENT '偏好区域ID列表 [1,2,3]',
  `max_weight`            DECIMAL(10,2) NOT NULL DEFAULT 20 COMMENT '最大配送重量(kg)',
  `vehicle_type`          TINYINT NOT NULL DEFAULT 1 COMMENT '车型: 1=电动车 2=摩托车 3=汽车',
  `auto_grab_enabled`     TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否开启自动抢单',
  `auto_grab_max_distance` INT NOT NULL DEFAULT 3000 COMMENT '自动抢单最大距离(米)',
  `auto_grab_min_amount`  DECIMAL(10,2) NOT NULL DEFAULT 10 COMMENT '自动抢单最低金额(元)',
  `status`                TINYINT NOT NULL DEFAULT 1 COMMENT '状态: 0=下线 1=上线接单中',
  `created_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rider` (`rider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='骑手接单设置表';

-- 为已有骑手插入默认设置
INSERT IGNORE INTO `ai_rider_dispatch_settings` (`rider_id`) VALUES
(1001), (1002), (1003), (1004), (1005), (1006);
