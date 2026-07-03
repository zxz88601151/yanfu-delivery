-- 快驴配送 - 完整数据库初始化脚本
-- 包含所有 7 个 AI 模块 001~007
-- 请在宝塔面板 -> 数据库 -> 导入SQL执行

CREATE DATABASE IF NOT EXISTS `kuailv` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `kuailv`;

-- ============================================================
-- 快驴配送 - AI 盲盒配送模块
-- 数据库迁移脚本 001: 创建盲盒相关表
-- ============================================================

-- ------------------------------
-- 1. ai_blind_box_orders: 盲盒订单表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_blind_box_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `budget_min` DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT '预算下限（元）',
  `budget_max` DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT '预算上限（元）',
  `taste_tags` JSON DEFAULT NULL COMMENT '口味标签，如 ["中餐", "辣"]',
  `district_id` INT UNSIGNED NOT NULL COMMENT '区域ID',
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '状态: pending-待匹配, matched-已匹配, confirmed-已确认, cancelled-已取消, expired-已过期',
  `matched_dish_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '匹配的餐品ID',
  `original_price` DECIMAL(10, 2) DEFAULT NULL COMMENT '餐品原价（元）',
  `blindbox_price` DECIMAL(10, 2) DEFAULT NULL COMMENT '盲盒价（元）',
  `platform_subsidy` DECIMAL(10, 2) DEFAULT 0.00 COMMENT '平台补贴金额（元）',
  `expire_at` DATETIME DEFAULT NULL COMMENT '过期时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  INDEX `idx_user_id` (`user_id`) COMMENT '用户ID索引',
  INDEX `idx_status` (`status`) COMMENT '状态索引',
  INDEX `idx_district_id` (`district_id`) COMMENT '区域ID索引',
  INDEX `idx_user_status` (`user_id`, `status`) COMMENT '用户+状态联合索引',
  INDEX `idx_expire_at` (`expire_at`) COMMENT '过期时间索引（用于定时清理）',
  INDEX `idx_created_at` (`created_at`) COMMENT '创建时间索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='盲盒订单表';

-- ------------------------------
-- 2. ai_blind_box_pool: 盲盒餐品池表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_blind_box_pool` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `dish_id` BIGINT UNSIGNED NOT NULL COMMENT '餐品ID',
  `merchant_id` BIGINT UNSIGNED NOT NULL COMMENT '商家ID',
  `original_price` DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT '餐品原价（元）',
  `discount_rate` DECIMAL(4, 2) NOT NULL DEFAULT 1.00 COMMENT '折扣率，如0.50表示五折',
  `blindbox_price` DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT '盲盒价（元）= original_price * discount_rate',
  `stock_limit` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '盲盒总库存限制（0表示不限）',
  `stock_used` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已消耗盲盒库存',
  `taste_tags` JSON DEFAULT NULL COMMENT '口味标签，如 ["中餐", "辣"]',
  `district_id` INT UNSIGNED NOT NULL COMMENT '区域ID',
  `is_featured` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否新店/首发推荐（0-否, 1-是）',
  `expire_at` DATETIME DEFAULT NULL COMMENT '过期时间（NULL表示不过期）',
  `status` VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态: active-上架中, inactive-已下架, expired-已过期, depleted-库存耗尽',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  INDEX `idx_dish_id` (`dish_id`) COMMENT '餐品ID索引',
  INDEX `idx_merchant_id` (`merchant_id`) COMMENT '商家ID索引',
  INDEX `idx_district_id` (`district_id`) COMMENT '区域ID索引',
  INDEX `idx_status` (`status`) COMMENT '状态索引',
  INDEX `idx_dish_status` (`dish_id`, `status`) COMMENT '餐品+状态联合索引',
  INDEX `idx_district_status` (`district_id`, `status`) COMMENT '区域+状态联合索引（用于筛选）',
  INDEX `idx_expire_at` (`expire_at`) COMMENT '过期时间索引',
  INDEX `idx_is_featured` (`is_featured`) COMMENT '推荐标记索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='盲盒餐品池表';

-- ============================================================
-- 快驴配送 - AI 动态定价模块
-- 数据库迁移脚本 002: 创建动态定价相关表 + 种子数据
-- ============================================================

-- ------------------------------
-- 1. ai_price_configs: 定价配置表
-- 存储所有可动态配置的定价参数
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_price_configs` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `config_key`  VARCHAR(64)  NOT NULL COMMENT '配置键（如 surge_cap_up, time_factor_map）',
  `config_value` JSON        NOT NULL COMMENT '配置值（数值/字符串/JSON 对象）',
  `description` VARCHAR(255)          COMMENT '配置说明',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='动态定价配置表';

-- ------------------------------
-- 2. ai_price_logs: 定价日志表
-- 存储每次定价估算的完整明细
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_price_logs` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id`              BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `order_id`             BIGINT UNSIGNED          COMMENT '订单ID（下单后回填）',
  `district_id`          INT UNSIGNED    NOT NULL COMMENT '区域ID',
  `base_fee`             DECIMAL(10,2)   NOT NULL COMMENT '标准配送费',
  `final_fee`            DECIMAL(10,2)   NOT NULL COMMENT '最终配送费',
  `surge_amount`         DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '浮动金额',
  `supply_demand_factor` DECIMAL(5,4)    NOT NULL DEFAULT 1.0000 COMMENT '运力供需因子',
  `weather_factor`       DECIMAL(5,4)    NOT NULL DEFAULT 1.0000 COMMENT '天气因子',
  `time_factor`          DECIMAL(5,4)    NOT NULL DEFAULT 1.0000 COMMENT '时段因子',
  `distance_factor`      DECIMAL(5,4)    NOT NULL DEFAULT 1.0000 COMMENT '距离因子',
  `density_factor`       DECIMAL(5,4)    NOT NULL DEFAULT 1.0000 COMMENT '密度因子',
  `composite_factor`     DECIMAL(5,4)    NOT NULL DEFAULT 1.0000 COMMENT '综合浮动系数（封顶前）',
  `capped_factor`        DECIMAL(5,4)    NOT NULL DEFAULT 1.0000 COMMENT '封顶后浮动系数',
  `supply_demand_ratio`  DECIMAL(5,2)             COMMENT '原始供需比',
  `weather_condition`    VARCHAR(32)              COMMENT '天气条件',
  `delivery_distance`    INT                      COMMENT '配送距离（米）',
  `order_density`        DECIMAL(8,2)             COMMENT '订单密度（单/平方公里）',
  `created_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  INDEX `idx_user_created` (`user_id`, `created_at`) COMMENT '用户+时间联合索引',
  INDEX `idx_order` (`order_id`) COMMENT '订单ID索引',
  INDEX `idx_district_created` (`district_id`, `created_at`) COMMENT '区域+时间联合索引',
  INDEX `idx_created` (`created_at`) COMMENT '创建时间索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='动态定价日志表';

-- ------------------------------
-- 3. 预置种子数据（15项）
-- ------------------------------
INSERT INTO `ai_price_configs` (`config_key`, `config_value`, `description`) VALUES
('surge_cap_up', '5.0', '单次最大上浮金额（元）'),
('surge_cap_down', '-3.0', '单次最大下浮金额（元）'),
('composite_factor_max', '1.50', '综合浮动系数上限'),
('composite_factor_min', '0.85', '综合浮动系数下限'),
('weather_protection_cap', '8.0', '极端天气保护：上浮上限（元）'),
('weather_protection_threshold', '1.30', '极端天气保护触发阈值'),
('update_interval_minutes', '5', '定价系数更新周期（分钟）'),
('base_fee', '5.00', '标准配送费基础价（元）'),
('time_factor_map', '{"00:00-06:00":1.30,"06:00-09:00":1.0,"09:00-11:00":1.0,"11:00-14:00":1.15,"14:00-17:00":0.90,"17:00-21:00":1.10,"21:00-24:00":1.15}', '时段系数映射'),
('supply_demand_ranges', '{"abundant":{"min":2.0,"factor":[0.85,0.95]},"normal":{"min":1.0,"factor":[0.95,1.05]},"tight":{"min":0.5,"factor":[1.05,1.30]},"severe":{"min":0,"factor":[1.30,1.50]}}', '供需比区间配置'),
('distance_ranges', '[{"max":1000,"factor":0.90},{"max":3000,"factor":[0.95,1.0]},{"max":5000,"factor":[1.0,1.10]},{"max":10000,"factor":[1.10,1.25]},{"max":999999,"factor":[1.25,1.50]}]', '距离系数区间'),
('density_ranges', '[{"max":5,"factor":[0.90,0.95]},{"max":20,"factor":1.0},{"max":50,"factor":[1.05,1.15]},{"max":999999,"factor":[1.15,1.25]}]', '密度系数区间'),
('cache_ttl_weather', '1800', '天气缓存TTL（秒）'),
('cache_ttl_config', '60', '配置缓存TTL（秒）'),
('cache_ttl_zone', '300', '区域系数缓存TTL（秒）');

-- ============================================================
-- 快驴配送 - AI 活地图模块
-- 数据库迁移脚本 003: 创建活地图相关表
-- ============================================================

-- ------------------------------
-- 1. ai_road_reports: 骑手路况上报表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_road_reports` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `rider_id`              BIGINT UNSIGNED NOT NULL COMMENT '骑手ID',
  `report_type`           TINYINT UNSIGNED NOT NULL COMMENT '路况分类: 1=修路施工 2=封路禁行 3=电梯故障 4=门禁难进 5=道路拥堵 6=其他',
  `lng`                   DECIMAL(11,8) NOT NULL COMMENT '经度',
  `lat`                   DECIMAL(10,8) NOT NULL COMMENT '纬度',
  `location`              POINT NOT NULL SRID 4326 COMMENT 'GPS坐标（空间索引用）',
  `address`               VARCHAR(255) DEFAULT NULL COMMENT '文字地址',
  `description`           VARCHAR(200) DEFAULT NULL COMMENT '文字描述（最多200字）',
  `image_urls`            JSON DEFAULT NULL COMMENT '图片URL数组，最多3张',
  `weight`                DECIMAL(5,4) NOT NULL DEFAULT 0.0000 COMMENT '初始信任权重 w',
  `gps_accuracy`          INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'GPS精度（米）',
  `has_image`             TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否有图片: 0=无 1=有',
  `credit_level`          TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '骑手信用等级: 0=新骑手 1=青铜 2=白银 3=黄金 4=钻石',
  `trajectory_match`      TINYINT(1) DEFAULT NULL COMMENT 'GPS轨迹是否匹配: NULL=未校验 1=匹配 0=不匹配',
  `status`                TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '状态: 0=待验证 1=已验证 2=低置信度 3=虚假',
  `verified_condition_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联的红区ID',
  `verified_count`        INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '累计确认人数（去重上报数）',
  `order_id`              BIGINT UNSIGNED DEFAULT NULL COMMENT '上报时关联的订单ID（可选）',
  `created_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  INDEX `idx_rider_created` (`rider_id`, `created_at`) COMMENT '骑手+时间索引',
  INDEX `idx_status_type` (`status`, `report_type`) COMMENT '状态+类型联合索引',
  INDEX `idx_verified_condition` (`verified_condition_id`) COMMENT '红区关联索引',
  INDEX `idx_created_status` (`created_at`, `status`) COMMENT '创建时间+状态索引',
  SPATIAL INDEX `idx_location` (`location`) COMMENT '空间索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='骑手路况上报表';

-- ------------------------------
-- 2. ai_verified_conditions: 已验证路况（红区）表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_verified_conditions` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `report_type`       TINYINT UNSIGNED NOT NULL COMMENT '路况分类: 0=官方 1-6=同ai_road_reports',
  `difficulty_level`  TINYINT UNSIGNED NOT NULL DEFAULT 2 COMMENT '配送难度: 0=畅通 1=轻微(黄) 2=中度(橙) 3=严重(红)',
  `lng`               DECIMAL(11,8) NOT NULL COMMENT '中心点经度',
  `lat`               DECIMAL(10,8) NOT NULL COMMENT '中心点纬度',
  `center_point`      POINT NOT NULL SRID 4326 COMMENT '中心点坐标（空间索引用）',
  `radius`            INT UNSIGNED NOT NULL DEFAULT 100 COMMENT '影响半径（米）',
  `geo_hash`          VARCHAR(16) NOT NULL COMMENT 'GeoHash精度6级区域标识',
  `status`            TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '状态: 0=active 1=degrading 2=expired 3=manual_expired',
  `total_reports`     INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '上报总数（去重骑手数）',
  `total_weight`      DECIMAL(8,2) NOT NULL DEFAULT 0.00 COMMENT '累计验证权重',
  `source`            TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '来源: 0=AI验证 1=运营批量确认 2=手动创建 3=官方公告',
  `description`       VARCHAR(500) DEFAULT NULL COMMENT '综合描述',
  `expired_at`        DATETIME NOT NULL COMMENT '过期时间（创建时间+24h）',
  `degraded_at`       DATETIME DEFAULT NULL COMMENT '降级时间（创建时间+12h）',
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  INDEX `idx_status_location` (`status`, `geo_hash`) COMMENT '状态+区域索引',
  INDEX `idx_expired_at` (`expired_at`) COMMENT '过期时间索引',
  INDEX `idx_level_status` (`difficulty_level`, `status`) COMMENT '难度+状态索引',
  SPATIAL INDEX `idx_center` (`center_point`) COMMENT '空间索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='已验证路况（红区）表';

-- ------------------------------
-- 3. ai_rider_incentives: 骑手激励积分表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_rider_incentives` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `rider_id`            BIGINT UNSIGNED NOT NULL COMMENT '骑手ID',
  `total_points`        INT NOT NULL DEFAULT 0 COMMENT '累计总积分',
  `today_points`        INT NOT NULL DEFAULT 0 COMMENT '今日获得积分',
  `last_reset_date`     DATE NOT NULL COMMENT '上次重置日期（用于日上限判断）',
  `total_valid_reports` INT NOT NULL DEFAULT 0 COMMENT '有效上报总数',
  `total_fraud_reports` INT NOT NULL DEFAULT 0 COMMENT '虚假上报总数',
  `fraud_streak`        TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '连续虚假次数',
  `is_banned`           TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否被限制上报',
  `ban_expires_at`      DATETIME DEFAULT NULL COMMENT '限制过期时间',
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uk_rider_id` (`rider_id`) COMMENT '骑手ID唯一索引',
  INDEX `idx_today_points` (`today_points`) COMMENT '今日积分索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='骑手激励积分表';

-- ------------------------------
-- 4. ai_incentive_logs: 积分变动日志表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_incentive_logs` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `rider_id`        BIGINT UNSIGNED NOT NULL COMMENT '骑手ID',
  `points_change`   INT NOT NULL COMMENT '积分变动（正=增加 负=扣除）',
  `action_type`     VARCHAR(32) NOT NULL COMMENT '行为类型: submit/confirm/verify/bonus/photo/fraud_penalty/ban',
  `report_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '关联上报ID',
  `condition_id`    BIGINT UNSIGNED DEFAULT NULL COMMENT '关联红区ID',
  `reason`          VARCHAR(255) DEFAULT NULL COMMENT '变动原因说明',
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  INDEX `idx_rider_created` (`rider_id`, `created_at`) COMMENT '骑手+时间索引',
  INDEX `idx_action_type` (`action_type`) COMMENT '行为类型索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='积分变动日志表';

-- ============================================================
-- 快驴配送 - AI 预置运力模块
-- 数据库迁移脚本 004: 创建预置运力相关表
-- ============================================================

-- ------------------------------
-- 1. ai_surge_predictions: 爆单预测记录表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_surge_predictions` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `district_id`        INT UNSIGNED    NOT NULL COMMENT '区域ID',
  `predicted_at`       DATETIME        NOT NULL COMMENT '预测生成时间',
  `surge_start`        DATETIME        NOT NULL COMMENT '预测爆单开始时间',
  `surge_end`          DATETIME        NOT NULL COMMENT '预测爆单结束时间',
  `window1_orders`     INT             DEFAULT NULL COMMENT '窗口1预测订单数',
  `window2_orders`     INT             DEFAULT NULL COMMENT '窗口2预测订单数',
  `expected_orders`    INT             NOT NULL COMMENT '总预计订单数',
  `baseline_orders`    INT             NOT NULL COMMENT '历史基线订单数',
  `intensity`          TINYINT         NOT NULL COMMENT '爆单强度1-5',
  `recommended_riders` INT             NOT NULL COMMENT '建议骑手数',
  `confidence`         VARCHAR(16)     NOT NULL DEFAULT 'high' COMMENT '置信度: high/medium/low',
  `factors`            JSON            NOT NULL COMMENT '5因子明细 {historical,weather,time,event,realtime}',
  `status`             TINYINT         NOT NULL DEFAULT 1 COMMENT '0=待验证 1=活跃 2=已过期',
  `actual_orders`      INT             DEFAULT NULL COMMENT '实际订单数',
  `accuracy`           DECIMAL(5,2)    DEFAULT NULL COMMENT '预测准确率0.00~100.00',
  `is_hit`             TINYINT         DEFAULT NULL COMMENT '是否命中 0=否 1=是',
  `created_at`         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_district_status` (`district_id`, `status`) COMMENT '区域+状态联合索引',
  KEY `idx_predict_at` (`predicted_at`) COMMENT '预测时间索引',
  KEY `idx_surge_end_status` (`surge_end`, `status`) COMMENT '过期扫描索引',
  KEY `idx_accuracy_status` (`status`, `accuracy`) COMMENT '准确率回写索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='爆单预测记录表';

-- ------------------------------
-- 2. ai_dispatch_records: 预置调度记录表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_dispatch_records` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `prediction_id`     BIGINT UNSIGNED NOT NULL COMMENT '关联预测ID',
  `rider_id`          BIGINT UNSIGNED NOT NULL COMMENT '骑手ID',
  `target_district_id` INT UNSIGNED   NOT NULL COMMENT '目标区域ID',
  `target_lng`        DECIMAL(10,7)   DEFAULT NULL COMMENT '目标经度',
  `target_lat`        DECIMAL(10,7)   DEFAULT NULL COMMENT '目标纬度',
  `rider_lng`         DECIMAL(10,7)   DEFAULT NULL COMMENT '骑手当前位置经度',
  `rider_lat`         DECIMAL(10,7)   DEFAULT NULL COMMENT '骑手当前位置纬度',
  `distance_km`       DECIMAL(5,2)    DEFAULT NULL COMMENT '骑手距目标距离(km)',
  `dispatch_type`     TINYINT         NOT NULL DEFAULT 1 COMMENT '1=预置调度 2=补充调度',
  `dispatch_source`   TINYINT         NOT NULL DEFAULT 0 COMMENT '0=系统自动 1=运营手动',
  `status`            TINYINT         NOT NULL DEFAULT 0 COMMENT '0=待响应 1=已接受 2=已到达 3=已完成 4=已拒绝 5=已超时 6=迟到标记 7=已取消',
  `respond_action`    VARCHAR(16)     DEFAULT NULL COMMENT '响应动作: accept/reject/timeout',
  `reject_reason`     VARCHAR(32)     DEFAULT NULL COMMENT '拒绝原因: too_far/busy/other',
  `responded_at`      DATETIME        DEFAULT NULL COMMENT '响应时间',
  `arrived_at`        DATETIME        DEFAULT NULL COMMENT '到达时间',
  `expire_at`         DATETIME        NOT NULL COMMENT '响应过期时间',
  `surge_start`       DATETIME        DEFAULT NULL COMMENT '预计爆单开始',
  `surge_end`         DATETIME        DEFAULT NULL COMMENT '预计爆单结束',
  `early_arrival`     TINYINT         DEFAULT NULL COMMENT '是否早到: 0=否 1=提前≥10min到达',
  `late_arrival`      TINYINT         DEFAULT NULL COMMENT '是否迟到: 0=否 1=是',
  `incentive_base`    DECIMAL(10,2)   NOT NULL COMMENT '基础调度费',
  `incentive_time_factor` DECIMAL(3,2) NOT NULL DEFAULT 1.0 COMMENT '时段系数',
  `incentive_distance_subsidy` DECIMAL(10,2) DEFAULT 0 COMMENT '距离补贴',
  `incentive_early_bonus` DECIMAL(10,2) DEFAULT 0 COMMENT '早到奖励',
  `incentive_total`   DECIMAL(10,2)   NOT NULL COMMENT '激励费用总计',
  `incentive_paid`    DECIMAL(10,2)   DEFAULT 0 COMMENT '已支付金额',
  `incentive_pay_status` TINYINT      DEFAULT 0 COMMENT '0=待结算 1=已结算 2=部分结算',
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_prediction` (`prediction_id`) COMMENT '预测ID索引',
  KEY `idx_rider_status` (`rider_id`, `status`) COMMENT '骑手+状态联合索引',
  KEY `idx_status_expire` (`status`, `expire_at`) COMMENT '状态+过期索引（超时扫描）',
  KEY `idx_district_status` (`target_district_id`, `status`) COMMENT '区域+状态索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='预置调度记录表';

-- ------------------------------
-- 3. ai_rider_pre_position_status: 骑手预置状态表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_rider_pre_position_status` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `rider_id`            BIGINT UNSIGNED NOT NULL COMMENT '骑手ID',
  `dispatch_record_id`  BIGINT UNSIGNED NOT NULL COMMENT '当前调度记录ID',
  `pre_status`          TINYINT         NOT NULL DEFAULT 0 COMMENT '0=空闲 1=前往中 2=已到达等待 3=正在接单',
  `target_district_id`  INT UNSIGNED    NOT NULL COMMENT '目标区域ID',
  `current_lng`         DECIMAL(10,7)   DEFAULT NULL COMMENT '当前位置经度',
  `current_lat`         DECIMAL(10,7)   DEFAULT NULL COMMENT '当前位置纬度',
  `arrived_at`          DATETIME        DEFAULT NULL COMMENT '到达时间',
  `arrived_lng`         DECIMAL(10,7)   DEFAULT NULL COMMENT '到达位置经度',
  `arrived_lat`         DECIMAL(10,7)   DEFAULT NULL COMMENT '到达位置纬度',
  `surge_start`         DATETIME        DEFAULT NULL COMMENT '预期爆单开始',
  `surge_end`           DATETIME        DEFAULT NULL COMMENT '预期爆单结束',
  `wait_start`          DATETIME        DEFAULT NULL COMMENT '等待开始时间',
  `wait_end`            DATETIME        DEFAULT NULL COMMENT '等待结束时间',
  `total_wait_seconds`  INT             DEFAULT NULL COMMENT '总等待秒数',
  `order_received`      TINYINT         DEFAULT NULL COMMENT '是否接到订单: 0=否 1=是',
  `daily_guarantee_count` TINYINT       DEFAULT 0 COMMENT '当日保底次数',
  `created_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rider` (`rider_id`) COMMENT '骑手ID唯一索引',
  KEY `idx_status` (`pre_status`) COMMENT '状态索引',
  KEY `idx_dispatch_record` (`dispatch_record_id`) COMMENT '调度记录索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='骑手预置状态表';

-- ------------------------------
-- 4. ai_pre_position_events: 商圈活动表（P1）
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_pre_position_events` (
  `id`                  INT UNSIGNED    NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `district_id`         INT UNSIGNED    NOT NULL COMMENT '区域ID',
  `event_name`          VARCHAR(128)    NOT NULL COMMENT '活动名称',
  `event_date`          DATE            NOT NULL COMMENT '活动日期',
  `event_time_start`    TIME            NOT NULL COMMENT '活动开始时间',
  `event_time_end`      TIME            NOT NULL COMMENT '活动结束时间',
  `expected_boost_pct`  DECIMAL(5,2)    NOT NULL COMMENT '预期需求提升百分比',
  `status`              TINYINT         NOT NULL DEFAULT 1 COMMENT '0=待开始 1=活跃 2=已结束 3=已取消',
  `created_by`          BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人（运营ID）',
  `remark`              VARCHAR(255)    DEFAULT NULL COMMENT '备注',
  `created_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_district_date` (`district_id`, `event_date`) COMMENT '区域+日期索引',
  KEY `idx_date_status` (`event_date`, `status`) COMMENT '日期+状态索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商圈活动记录表';

-- ============================================================
-- 快驴配送 - AI 协同配送模块
-- 数据库迁移脚本 005: 创建接力配送相关表 + 种子数据
-- ============================================================

-- ------------------------------
-- 1. ai_relay_orders: 接力配送主表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_relay_orders` (
  `id`                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
  `order_id`          BIGINT UNSIGNED NOT NULL             COMMENT '原始订单ID',
  `order_amount`      DECIMAL(10,2) NOT NULL               COMMENT '订单金额（元）',
  `total_distance`    INT NOT NULL                         COMMENT '总距离（米）',
  `estimated_time`    INT NOT NULL DEFAULT 0               COMMENT '预估总时长（秒）',
  `segment_count`     TINYINT UNSIGNED NOT NULL            COMMENT '分段数: 2 或 3',
  `relay_points`      JSON NOT NULL                        COMMENT '接力点列表 [{id, name, type, lng, lat, addr}]',
  `status`            TINYINT UNSIGNED NOT NULL DEFAULT 0   COMMENT '状态: 0=待拆分 1=已分配 2=配送中 3=已完成 4=异常 5=已取消',
  `total_fee`         DECIMAL(10,2) NOT NULL               COMMENT '原配送费总额（元）',
  `total_relay_fee`   DECIMAL(10,2) DEFAULT NULL            COMMENT '接力配送费总额（元）',
  `platform_subsidy`  DECIMAL(10,2) NOT NULL DEFAULT 0.00  COMMENT '平台补贴金额（元）',
  `relay_started_at`  DATETIME DEFAULT NULL                 COMMENT '接力配送开始时间',
  `relay_completed_at` DATETIME DEFAULT NULL                COMMENT '接力配送完成时间',
  `audit_log`         JSON DEFAULT NULL                    COMMENT '操作审计日志 [{action, timestamp, operator}]',
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX `idx_order` (`order_id`),
  INDEX `idx_status` (`status`),
  INDEX `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='接力配送主表';

-- ------------------------------
-- 2. ai_relay_handoffs: 接力配送分段表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_relay_handoffs` (
  `id`                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
  `relay_order_id`    BIGINT UNSIGNED NOT NULL             COMMENT '接力主表ID',
  `segment_seq`       TINYINT UNSIGNED NOT NULL            COMMENT '段序号: 1=前段 2=中段 3=后段',
  `rider_id`          BIGINT UNSIGNED DEFAULT NULL         COMMENT '骑手ID（NULL=未分配）',
  `from_type`         VARCHAR(16) NOT NULL DEFAULT 'merchant' COMMENT '起点类型: merchant|relay_point|station',
  `from_lng`          DECIMAL(11,8) NOT NULL               COMMENT '起点经度',
  `from_lat`          DECIMAL(10,8) NOT NULL               COMMENT '起点纬度',
  `from_name`         VARCHAR(100) DEFAULT NULL            COMMENT '起点名称',
  `to_type`           VARCHAR(16) NOT NULL DEFAULT 'customer' COMMENT '终点类型: relay_point|station|customer',
  `to_lng`            DECIMAL(11,8) NOT NULL               COMMENT '终点经度',
  `to_lat`            DECIMAL(10,8) NOT NULL               COMMENT '终点纬度',
  `to_name`           VARCHAR(100) DEFAULT NULL            COMMENT '终点名称',
  `distance`          INT NOT NULL                         COMMENT '段距离（米）',
  `estimated_time`    INT NOT NULL DEFAULT 0               COMMENT '预估时长（秒）',
  `difficulty_factor` DECIMAL(3,1) NOT NULL DEFAULT 1.0    COMMENT '难度系数: 1.0/1.1/1.2',
  `fee`               DECIMAL(10,2) NOT NULL DEFAULT 0.00  COMMENT '段配送费（元）',
  `status`            TINYINT UNSIGNED NOT NULL DEFAULT 0   COMMENT '状态: 0=待接单 1=待分配 2=配送中 3=已到达 4=已完成 5=异常',
  `picked_up_at`      DATETIME DEFAULT NULL                COMMENT '取餐/取包裹时间',
  `arrived_at`        DATETIME DEFAULT NULL                COMMENT '到达接力点/送达时间',
  `handoff_at`        DATETIME DEFAULT NULL                COMMENT '交接完成时间',
  `cancel_reason`     VARCHAR(100) DEFAULT NULL            COMMENT '取消原因（若有）',
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_relay_order` (`relay_order_id`, `segment_seq`),
  INDEX `idx_rider` (`rider_id`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='接力配送分段表';

-- ------------------------------
-- 3. ai_relay_stations: 接力点信息表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_relay_stations` (
  `id`                VARCHAR(32) PRIMARY KEY              COMMENT '接力点ID，如 RP001',
  `name`              VARCHAR(100) NOT NULL                COMMENT '接力点名称',
  `type`              TINYINT UNSIGNED NOT NULL DEFAULT 0  COMMENT '类型: 0=驿站 1=合作商户 2=公共设施 3=虚拟点',
  `lng`               DECIMAL(11,8) NOT NULL               COMMENT '经度',
  `lat`               DECIMAL(10,8) NOT NULL               COMMENT '纬度',
  `address`           VARCHAR(255) DEFAULT NULL            COMMENT '详细地址',
  `business_hours`    JSON DEFAULT NULL                    COMMENT '营业时间 {open: "07:00", close: "23:00"}',
  `amenities`         JSON DEFAULT NULL                    COMMENT '设施列表 ["parking","shelter","charging"]',
  `status`            TINYINT UNSIGNED NOT NULL DEFAULT 1  COMMENT '状态: 0=关闭 1=活跃 2=维护中',
  `success_rate`      DECIMAL(5,2) DEFAULT 100.00          COMMENT '历史交接成功率 %',
  `avg_handoff_time`  INT UNSIGNED DEFAULT 0               COMMENT '平均交接耗时（秒）',
  `total_handoffs`    INT UNSIGNED DEFAULT 0               COMMENT '累计交接次数',
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_type` (`type`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='接力点信息表';

-- ------------------------------
-- 4. ai_relay_handoff_logs: 交接操作日志表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_relay_handoff_logs` (
  `id`                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
  `relay_order_id`    BIGINT UNSIGNED NOT NULL             COMMENT '接力主表ID',
  `handoff_id`        BIGINT UNSIGNED NOT NULL             COMMENT '分段ID',
  `action`            VARCHAR(32) NOT NULL                 COMMENT '操作: assign|accept|reject|arrive|handoff|timeout|cancel|complete',
  `rider_id`          BIGINT UNSIGNED DEFAULT NULL         COMMENT '操作骑手ID',
  `operator`          VARCHAR(64) DEFAULT 'system'         COMMENT '操作人/系统',
  `detail`            JSON DEFAULT NULL                    COMMENT '操作详情（坐标/方式/备注等）',
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_relay_order` (`relay_order_id`, `handoff_id`),
  INDEX `idx_rider_action` (`rider_id`, `action`),
  INDEX `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='交接操作日志表';

-- ------------------------------
-- 5. 种子数据：接力点
-- ------------------------------
INSERT IGNORE INTO `ai_relay_stations` (`id`, `name`, `type`, `lng`, `lat`, `address`, `business_hours`, `amenities`, `status`, `success_rate`, `avg_handoff_time`, `total_handoffs`) VALUES
('RP001', '快驴配送·望京驿站', 0, 116.48000000, 39.99000000, '北京市朝阳区望京SOHO T1一层', '{"open":"07:00","close":"23:00"}', '["parking","shelter","charging"]', 1, 98.50, 95, 1200),
('RP002', '美宜佳·中关村店', 1, 116.31000000, 39.98000000, '北京市海淀区中关村大街15号', '{"open":"00:00","close":"24:00"}', '["shelter"]', 1, 95.20, 120, 850),
('RP003', '快驴配送·国贸驿站', 0, 116.46000000, 39.91000000, '北京市朝阳区国贸CBD B1层', '{"open":"07:00","close":"23:00"}', '["parking","shelter","charging"]', 1, 99.10, 80, 1500),
('RP004', '罗森·五道口店', 1, 116.34000000, 39.99000000, '北京市海淀区五道口广场1号楼', '{"open":"06:00","close":"02:00"}', '["shelter"]', 1, 93.80, 110, 620),
('RP005', '西二旗地铁站B口', 2, 116.30000000, 40.05000000, '北京市海淀区西二旗地铁站B口', '{"open":"05:30","close":"23:30"}', '["shelter"]', 1, 88.50, 150, 320);

-- ============================================================
-- 快驴配送 - AI 信用护照模块
-- 数据库迁移脚本 006: 创建信用护照相关表
-- ============================================================

-- ------------------------------
-- 1. ai_rider_credits: 骑手信用表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_rider_credits` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `rider_id` BIGINT UNSIGNED NOT NULL COMMENT '骑手ID',
  `total_score` INT NOT NULL DEFAULT 600 COMMENT '信用总分 0-1000',
  `on_time_rate` DECIMAL(5, 2) DEFAULT 0.00 COMMENT '准时率 %',
  `complaint_rate` DECIMAL(5, 2) DEFAULT 0.00 COMMENT '客诉率 %',
  `praise_rate` DECIMAL(5, 2) DEFAULT 0.00 COMMENT '好评率 %',
  `acceptance_rate` DECIMAL(5, 2) DEFAULT 0.00 COMMENT '接单履约率 %',
  `level` TINYINT NOT NULL DEFAULT 1 COMMENT '信用等级: 1=青铜 2=白银 3=黄金 4=钻石',
  `total_orders` INT DEFAULT 0 COMMENT '总完成单数（满 50 单进入正式评估）',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rider_id` (`rider_id`) COMMENT '骑手ID唯一索引',
  INDEX `idx_level` (`level`) COMMENT '等级索引',
  INDEX `idx_total_score` (`total_score`) COMMENT '信用分索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='骑手信用表';

-- ------------------------------
-- 2. ai_credit_passports: 信用变动记录表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_credit_passports` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `rider_id` BIGINT UNSIGNED NOT NULL COMMENT '骑手ID',
  `change_type` TINYINT NOT NULL COMMENT '变动类型: 1=加分 2=扣分',
  `change_amount` INT NOT NULL COMMENT '变动分值',
  `reason` VARCHAR(64) NOT NULL COMMENT '原因（拒单/超时/投诉/好评等）',
  `order_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联订单ID',
  `status` TINYINT NOT NULL DEFAULT 0 COMMENT '状态: 0=正常 1=申诉中 2=申诉通过已回滚',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  INDEX `idx_rider_id` (`rider_id`) COMMENT '骑手ID索引',
  INDEX `idx_status` (`status`) COMMENT '状态索引',
  INDEX `idx_rider_status` (`rider_id`, `status`) COMMENT '骑手+状态联合索引',
  INDEX `idx_created_at` (`created_at`) COMMENT '创建时间索引',
  INDEX `idx_reason` (`reason`) COMMENT '原因索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='信用变动记录表';

-- ------------------------------
-- 3. ai_credit_appeals: 申诉记录表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_credit_appeals` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `rider_id` BIGINT UNSIGNED NOT NULL COMMENT '骑手ID',
  `credit_record_id` BIGINT UNSIGNED NOT NULL COMMENT '关联信用变动记录ID',
  `reason` VARCHAR(200) NOT NULL COMMENT '申诉原因',
  `order_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联订单ID',
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '申诉状态: pending-待审核, approved-已通过, rejected-已驳回',
  `reviewer_note` VARCHAR(500) DEFAULT NULL COMMENT '复核备注',
  `reviewed_at` DATETIME DEFAULT NULL COMMENT '复核时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  INDEX `idx_rider_id` (`rider_id`) COMMENT '骑手ID索引',
  INDEX `idx_credit_record_id` (`credit_record_id`) COMMENT '信用变动记录ID索引',
  INDEX `idx_status` (`status`) COMMENT '申诉状态索引',
  INDEX `idx_rider_status` (`rider_id`, `status`) COMMENT '骑手+状态联合索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='申诉记录表';

-- ============================================================
-- 快驴配送 - AI 碳积分模块
-- 数据库迁移脚本 007: 创建碳积分相关表
-- ============================================================

-- ------------------------------
-- 1. ai_carbon_emissions: 碳排放记录表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_carbon_emissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `order_id` BIGINT UNSIGNED NOT NULL COMMENT '订单ID',
  `rider_id` BIGINT UNSIGNED NOT NULL COMMENT '骑手ID',
  `delivery_distance` INT NOT NULL COMMENT '配送距离（米）',
  `vehicle_type` TINYINT NOT NULL COMMENT '车辆类型: 1=电动车 2=摩托车 3=汽车',
  `coefficient` INT NOT NULL COMMENT '碳排系数 g/km',
  `emission` DECIMAL(10,2) NOT NULL COMMENT '碳排放 g CO₂',
  `saved_vs_motorcycle` DECIMAL(10,2) DEFAULT 0 COMMENT '相比摩托车减排 g',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  INDEX `idx_order_id` (`order_id`) COMMENT '订单ID索引',
  INDEX `idx_rider_id` (`rider_id`) COMMENT '骑手ID索引',
  INDEX `idx_created_at` (`created_at`) COMMENT '创建时间索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='碳排放记录表';

-- ------------------------------
-- 2. ai_carbon_credit_accounts: 碳积分账户表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_carbon_credit_accounts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `total_credits` INT NOT NULL DEFAULT 0 COMMENT '总碳积分',
  `total_reduction` DECIMAL(10,2) DEFAULT 0 COMMENT '总减排 kg CO₂',
  `used_credits` INT NOT NULL DEFAULT 0 COMMENT '已用积分',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_id` (`user_id`) COMMENT '用户ID唯一索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='碳积分账户表';

-- ------------------------------
-- 3. ai_carbon_credit_accounts_log: 积分变更明细表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_carbon_credit_accounts_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `change_type` TINYINT NOT NULL COMMENT '变动类型: 1=收入 2=支出',
  `amount` INT NOT NULL COMMENT '变动积分数',
  `balance_after` INT NOT NULL COMMENT '变动后可用余额',
  `reason` VARCHAR(64) NOT NULL COMMENT '原因',
  `order_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联订单ID',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  INDEX `idx_user_id` (`user_id`) COMMENT '用户ID索引',
  INDEX `idx_created_at` (`created_at`) COMMENT '创建时间索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='积分变更明细表';

-- ------------------------------
-- 4. ai_carbon_exchanges: 积分兑换记录表
-- ------------------------------
CREATE TABLE IF NOT EXISTS `ai_carbon_exchanges` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `credits_used` INT NOT NULL COMMENT '消耗积分',
  `reward_type` TINYINT NOT NULL COMMENT '奖励类型: 1=优惠券 2=免配送费券 3=其他',
  `reward_value` DECIMAL(10,2) NOT NULL COMMENT '兑换价值',
  `status` TINYINT NOT NULL DEFAULT 0 COMMENT '状态: 0=待发放 1=已发放 2=已使用',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  INDEX `idx_user_id` (`user_id`) COMMENT '用户ID索引',
  INDEX `idx_created_at` (`created_at`) COMMENT '创建时间索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='积分兑换记录表';

