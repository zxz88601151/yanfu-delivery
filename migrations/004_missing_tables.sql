-- ============================================================
-- 迁移 004: 创建缺失的数据库表
-- 日期: 2026-05-26
-- 说明: 修复管理端4个500错误
-- ============================================================

USE kuailv;

-- 1. merchant_reviews 表 (修复 GET /api/admin/dashboard/realtime 500)
CREATE TABLE IF NOT EXISTS merchant_reviews (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    merchant_id  INT NOT NULL,
    user_id      INT NOT NULL,
    order_id     INT NULL,
    rating       TINYINT NOT NULL,
    content      TEXT NULL,
    reply        TEXT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_mr_merchant_id (merchant_id),
    INDEX idx_mr_user_id (user_id),
    INDEX idx_mr_order_id (order_id),
    INDEX idx_mr_created_at (created_at),

    CONSTRAINT fk_mr_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
    CONSTRAINT fk_mr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_mr_order FOREIGN KEY (order_id) REFERENCES merchant_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. coupons 表 (修复 GET /api/admin/coupons 500)
CREATE TABLE IF NOT EXISTS coupons (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    code               VARCHAR(50) NOT NULL,
    name               VARCHAR(255) NOT NULL,
    type               VARCHAR(50) NOT NULL DEFAULT 'platform',
    discount_type      VARCHAR(50) NOT NULL,
    discount_value     DECIMAL(10,2) NOT NULL,
    threshold_amount   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    max_discount       DECIMAL(10,2) NULL,
    total_quantity     INT NOT NULL DEFAULT 0,
    remaining_quantity INT NOT NULL DEFAULT 0,
    per_user_limit     INT NOT NULL DEFAULT 1,
    start_time         DATETIME NOT NULL,
    end_time           DATETIME NOT NULL,
    merchant_id        INT NULL,
    status             VARCHAR(20) NOT NULL DEFAULT 'active',
    created_by         INT NOT NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE INDEX idx_coupons_code (code),
    INDEX idx_coupons_status (status),
    INDEX idx_coupons_merchant_id (merchant_id),
    INDEX idx_coupons_created_at (created_at),

    CONSTRAINT fk_coupons_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. user_coupons 表 (coupons 的关联表)
CREATE TABLE IF NOT EXISTS user_coupons (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    coupon_id  INT NOT NULL,
    status     VARCHAR(20) NOT NULL DEFAULT 'unused',
    expire_at  DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_uc_user_id (user_id),
    INDEX idx_uc_coupon_id (coupon_id),
    INDEX idx_uc_status (status),

    CONSTRAINT fk_uc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_uc_coupon FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. announcements 表 (修复 GET /api/admin/announcements 500)
CREATE TABLE IF NOT EXISTS announcements (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    title        VARCHAR(255) NOT NULL,
    content      TEXT NOT NULL,
    type         VARCHAR(50) NOT NULL,
    priority     VARCHAR(20) NOT NULL DEFAULT 'normal',
    start_time   DATETIME NOT NULL,
    end_time     DATETIME NULL,
    is_top       TINYINT NOT NULL DEFAULT 0,
    status       VARCHAR(20) NOT NULL DEFAULT 'published',
    created_by   INT NOT NULL,
    published_at DATETIME NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_ann_type (type),
    INDEX idx_ann_status (status),
    INDEX idx_ann_is_top (is_top),
    INDEX idx_ann_created_at (created_at),

    CONSTRAINT fk_ann_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. delivery_fee_configs 表 (修复 GET /api/admin/delivery-fee 500)
CREATE TABLE IF NOT EXISTS delivery_fee_configs (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    base_fee         DECIMAL(10,2) NOT NULL DEFAULT 5.00,
    base_distance    DECIMAL(10,2) NOT NULL DEFAULT 3.00,
    extra_fee_per_km DECIMAL(10,2) NOT NULL DEFAULT 2.00,
    max_fee          DECIMAL(10,2) NOT NULL DEFAULT 30.00,
    night_fee_extra  DECIMAL(10,2) NOT NULL DEFAULT 3.00,
    night_start_time TIME NULL DEFAULT '22:00:00',
    night_end_time   TIME NULL DEFAULT '06:00:00',
    is_default       TINYINT NOT NULL DEFAULT 0,
    status           VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_dfc_status (status),
    INDEX idx_dfc_is_default (is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 插入一条默认配送费配置
INSERT INTO delivery_fee_configs (base_fee, base_distance, extra_fee_per_km, max_fee, night_fee_extra, night_start_time, night_end_time, is_default, status)
VALUES (5.00, 3.00, 2.00, 30.00, 3.00, '22:00:00', '06:00:00', 1, 'active');

-- 6. review_images 表 (merchant_reviews 的关联表)
CREATE TABLE IF NOT EXISTS review_images (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    review_id  INT NOT NULL,
    url        VARCHAR(500) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_ri_review_id (review_id),

    CONSTRAINT fk_ri_review FOREIGN KEY (review_id) REFERENCES merchant_reviews(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. user_feedback 表 (修复管理端反馈管理500错误)
CREATE TABLE IF NOT EXISTS user_feedback (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT NOT NULL,
    type         VARCHAR(50) NOT NULL DEFAULT 'suggestion',
    content      TEXT NOT NULL,
    images       JSON NULL,
    contact      VARCHAR(100) NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'pending',
    admin_reply  TEXT NULL,
    processed_by INT NULL,
    processed_at DATETIME NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_uf_user_id (user_id),
    INDEX idx_uf_status (status),
    INDEX idx_uf_type (type),
    INDEX idx_uf_created_at (created_at),

    CONSTRAINT fk_uf_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_uf_processed_by FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. income_records 表 (修复骑手收入明细500错误)
CREATE TABLE IF NOT EXISTS income_records (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    rider_id     INT NOT NULL,
    order_id     INT NULL,
    type         VARCHAR(50) NOT NULL,
    amount       DECIMAL(10,2) NOT NULL,
    description  VARCHAR(255) NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'completed',
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_ir_rider_id (rider_id),
    INDEX idx_ir_order_id (order_id),
    INDEX idx_ir_type (type),
    INDEX idx_ir_status (status),
    INDEX idx_ir_created_at (created_at),

    CONSTRAINT fk_ir_rider FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE,
    CONSTRAINT fk_ir_order FOREIGN KEY (order_id) REFERENCES rider_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
