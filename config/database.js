const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_SIZE) || 50,
  queueLimit: 0,
  idleTimeout: 30000,         // 30s空闲连接超时
  enableKeepAlive: true,      // 保持连接活跃
  keepAliveInitialDelay: 10000
});

// 安全添加列的辅助函数：如果列已存在则忽略，其他错误抛出
async function safeAddColumn(connection, table, col, definition) {
  try {
    await connection.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`);
  } catch (e) {
    if (!e.message.includes('Duplicate column name')) throw e;
  }
}

// 初始化数据库表
async function initDatabase() {
  const connection = await pool.getConnection();
  try {
    // 管理员表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'admin',
        status ENUM('active', 'disabled') DEFAULT 'active',
        last_login_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // ===================== 骑手表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS riders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        phone VARCHAR(20) UNIQUE NOT NULL,
        password VARCHAR(255) DEFAULT NULL,
        level INT DEFAULT 1,
        status ENUM('online', 'offline', 'rest') DEFAULT 'offline',
        total_orders INT DEFAULT 0,
        rating DECIMAL(3,2) DEFAULT 5.00,
        today_income DECIMAL(10,2) DEFAULT 0.00,
        month_income DECIMAL(10,2) DEFAULT 0.00,
        balance DECIMAL(10,2) DEFAULT 0.00,
        last_latitude DECIMAL(10,7) NULL,
        last_longitude DECIMAL(10,7) NULL,
        last_address VARCHAR(255) NULL,
        last_location_at TIMESTAMP NULL,
        pool_type VARCHAR(20) DEFAULT 'normal',
        credit_score INT DEFAULT 100,
        real_name VARCHAR(50) DEFAULT NULL,
        real_name_status ENUM('unverified', 'pending', 'verified', 'rejected') DEFAULT 'unverified',
        freeze_reason VARCHAR(255) DEFAULT NULL,
        freeze_at TIMESTAMP NULL,
        referral_code VARCHAR(50) DEFAULT NULL,
        preferred_areas JSON DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 为已存在的 riders 表补充字段（兼容旧数据库）
    const riderColMigrations = [
      ['last_latitude', 'DECIMAL(10,7) NULL'],
      ['last_longitude', 'DECIMAL(10,7) NULL'],
      ['last_address', 'VARCHAR(255) NULL'],
      ['last_location_at', 'TIMESTAMP NULL'],
      ['pool_type', "VARCHAR(20) DEFAULT 'normal'"],
      ['credit_score', 'INT DEFAULT 100'],
      ['real_name', 'VARCHAR(50) DEFAULT NULL'],
      ['real_name_status', "ENUM('unverified', 'pending', 'verified', 'rejected') DEFAULT 'unverified'"],
      ['freeze_reason', 'VARCHAR(255) DEFAULT NULL'],
      ['freeze_at', 'TIMESTAMP NULL'],
      ['referral_code', 'VARCHAR(50) DEFAULT NULL'],
      ['preferred_areas', 'JSON DEFAULT NULL'],
    ];
    for (const [col, def] of riderColMigrations) {
      await safeAddColumn(connection, 'riders', col, def);
    }

    // ===================== 商家表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS merchants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        phone VARCHAR(20) UNIQUE NOT NULL,
        password VARCHAR(255) DEFAULT NULL,
        address TEXT,
        category VARCHAR(50) DEFAULT '快餐',
        avatar VARCHAR(255),
        is_open TINYINT DEFAULT 1,
        auto_accept TINYINT DEFAULT 0,
        voice_reminder TINYINT DEFAULT 1,
        rating DECIMAL(3,2) DEFAULT 5.00,
        total_orders INT DEFAULT 0,
        today_revenue DECIMAL(10,2) DEFAULT 0.00,
        month_revenue DECIMAL(10,2) DEFAULT 0.00,
        delivery_range DECIMAL(5,2) DEFAULT 3.00,
        min_order_amount DECIMAL(10,2) DEFAULT 15.00,
        latitude DECIMAL(10,7) DEFAULT NULL,
        longitude DECIMAL(10,7) DEFAULT NULL,
        description TEXT DEFAULT NULL,
        contact_phone VARCHAR(20) DEFAULT NULL,
        open_time VARCHAR(10) DEFAULT '08:00',
        close_time VARCHAR(10) DEFAULT '22:00',
        delivery_fee DECIMAL(10,2) DEFAULT 0.00,
        estimated_time INT DEFAULT 30,
        business_status VARCHAR(20) DEFAULT 'open',
        qualification_status VARCHAR(20) DEFAULT 'pending',
        commission_rate DECIMAL(5,2) DEFAULT 0.00,
        status VARCHAR(20) DEFAULT 'active',
        city VARCHAR(50) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 为已存在的 merchants 表补充字段（兼容旧数据库）
    const merchantColMigrations = [
      ['latitude', 'DECIMAL(10,7) DEFAULT NULL'],
      ['longitude', 'DECIMAL(10,7) DEFAULT NULL'],
      ['description', 'TEXT DEFAULT NULL'],
      ['contact_phone', 'VARCHAR(20) DEFAULT NULL'],
      ['open_time', "VARCHAR(10) DEFAULT '08:00'"],
      ['close_time', "VARCHAR(10) DEFAULT '22:00'"],
      ['delivery_fee', 'DECIMAL(10,2) DEFAULT 0.00'],
      ['estimated_time', 'INT DEFAULT 30'],
      ['business_status', "VARCHAR(20) DEFAULT 'open'"],
      ['qualification_status', "VARCHAR(20) DEFAULT 'pending'"],
      ['commission_rate', 'DECIMAL(5,2) DEFAULT 0.00'],
      ['status', "VARCHAR(20) DEFAULT 'active'"],
      ['city', 'VARCHAR(50) DEFAULT NULL'],
    ];
    for (const [col, def] of merchantColMigrations) {
      await safeAddColumn(connection, 'merchants', col, def);
    }

    // ===================== 用户表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50),
        phone VARCHAR(20) UNIQUE NOT NULL,
        password VARCHAR(255) DEFAULT NULL,
        avatar VARCHAR(255),
        default_address TEXT,
        balance DECIMAL(10,2) DEFAULT 0.00,
        gender TINYINT DEFAULT 0,
        birthday DATE DEFAULT NULL,
        points INT DEFAULT 0,
        member_level INT DEFAULT 0,
        member_expire_at TIMESTAMP NULL,
        status VARCHAR(20) DEFAULT 'active',
        ban_reason VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 为已存在的 users 表补充字段（兼容旧数据库）
    const userColMigrations = [
      ['gender', 'TINYINT DEFAULT 0'],
      ['birthday', 'DATE DEFAULT NULL'],
      ['points', 'INT DEFAULT 0'],
      ['member_level', 'INT DEFAULT 0'],
      ['member_expire_at', 'TIMESTAMP NULL'],
      ['status', "VARCHAR(20) DEFAULT 'active'"],
      ['ban_reason', 'VARCHAR(255) DEFAULT NULL'],
    ];
    for (const [col, def] of userColMigrations) {
      await safeAddColumn(connection, 'users', col, def);
    }

    // ===================== 骑手订单表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS rider_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_no VARCHAR(50) UNIQUE NOT NULL,
        rider_id INT,
        merchant_name VARCHAR(100) NOT NULL,
        merchant_address TEXT,
        pickup_address VARCHAR(255) NOT NULL,
        delivery_address VARCHAR(255) NOT NULL,
        delivery_name VARCHAR(50),
        delivery_phone VARCHAR(20),
        distance DECIMAL(8,2) DEFAULT 0.00,
        base_fare DECIMAL(8,2) DEFAULT 0.00,
        peak_bonus DECIMAL(8,2) DEFAULT 0.00,
        weather_bonus DECIMAL(8,2) DEFAULT 0.00,
        long_distance_bonus DECIMAL(8,2) DEFAULT 0.00,
        reward_bonus DECIMAL(8,2) DEFAULT 0.00,
        total_income DECIMAL(10,2) DEFAULT 0.00,
        status ENUM('pending', 'paid', 'assigned', 'accepted', 'picking', 'delivering', 'completed', 'cancelled') DEFAULT 'pending',
        pickup_code VARCHAR(10),
        weather VARCHAR(20) DEFAULT 'sunny',
        pickup_latitude DECIMAL(10,7) NULL,
        pickup_longitude DECIMAL(10,7) NULL,
        delivery_latitude DECIMAL(10,7) NULL,
        delivery_longitude DECIMAL(10,7) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        picked_at TIMESTAMP NULL,
        delivered_at TIMESTAMP NULL,
        FOREIGN KEY (rider_id) REFERENCES riders(id)
      )
    `);

    // 为已存在的 rider_orders 表补充经纬度字段（兼容旧数据库）
    const riderOrderCols = ['pickup_latitude', 'pickup_longitude', 'delivery_latitude', 'delivery_longitude'];
    for (const col of riderOrderCols) {
      await safeAddColumn(connection, 'rider_orders', col, 'DECIMAL(10,7) NULL');
    }

    // 修复 rider_orders 的 status ENUM（兼容已存在的表，添加 paid 和 accepted 状态）
    try {
      await connection.query(`
        ALTER TABLE rider_orders MODIFY COLUMN status
        ENUM('pending', 'paid', 'assigned', 'accepted', 'picking', 'delivering', 'completed', 'cancelled')
        DEFAULT 'pending'
      `);
    } catch (e) {
      // 如果已经是正确的 ENUM 则忽略
      console.warn('rider_orders status ENUM 迁移警告:', e.message.substring(0, 100));
    }

    // ===================== 商家订单表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS merchant_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_no VARCHAR(50) UNIQUE NOT NULL,
        user_id INT NOT NULL,
        merchant_id INT NOT NULL,
        rider_id INT,
        rider_name VARCHAR(50),
        rider_phone VARCHAR(20),
        rider_avatar VARCHAR(255),
        status ENUM('pending', 'accepted', 'ready', 'paid', 'assigned', 'delivering', 'completed', 'cancelled', 'refunded') DEFAULT 'pending',
        order_amount DECIMAL(10,2) NOT NULL,
        commission DECIMAL(10,2) DEFAULT 0.00,
        delivery_fee DECIMAL(10,2) DEFAULT 0.00,
        discount DECIMAL(10,2) DEFAULT 0.00,
        actual_amount DECIMAL(10,2) NOT NULL,
        items JSON,
        delivery_address TEXT NOT NULL,
        delivery_name VARCHAR(50),
        delivery_phone VARCHAR(20),
        pickup_code VARCHAR(10),
        cancel_reason TEXT DEFAULT NULL,
        cancelled_at TIMESTAMP NULL,
        is_reviewed TINYINT DEFAULT 0,
        pay_time TIMESTAMP NULL,
        payment_method VARCHAR(20) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        accepted_at TIMESTAMP NULL,
        ready_at TIMESTAMP NULL,
        delivered_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (merchant_id) REFERENCES merchants(id),
        FOREIGN KEY (rider_id) REFERENCES riders(id)
      )
    `);

    // 为已存在的 merchant_orders 表补充字段（兼容旧数据库）
    const merchantOrderColMigrations = [
      ['cancel_reason', 'TEXT DEFAULT NULL'],
      ['cancelled_at', 'TIMESTAMP NULL'],
      ['is_reviewed', 'TINYINT DEFAULT 0'],
      ['pay_time', 'TIMESTAMP NULL'],
      ['payment_method', 'VARCHAR(20) DEFAULT NULL'],
    ];
    for (const [col, def] of merchantOrderColMigrations) {
      await safeAddColumn(connection, 'merchant_orders', col, def);
    }

    // 修复 merchant_orders 的 status ENUM（兼容已存在的表，添加 paid 和 refunded 状态）
    try {
      await connection.query(`
        ALTER TABLE merchant_orders MODIFY COLUMN status
        ENUM('pending', 'accepted', 'ready', 'paid', 'assigned', 'delivering', 'completed', 'cancelled', 'refunded')
        DEFAULT 'pending'
      `);
    } catch (e) {
      console.warn('merchant_orders status ENUM 迁移警告:', e.message.substring(0, 100));
    }

    // ===================== 商家菜单表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS merchant_menu (
        id INT AUTO_INCREMENT PRIMARY KEY,
        merchant_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        image VARCHAR(255),
        category VARCHAR(50),
        is_available TINYINT DEFAULT 1,
        sales_count INT DEFAULT 0,
        original_price DECIMAL(10,2) DEFAULT NULL,
        sort_order INT DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      )
    `);

    // 为已存在的 merchant_menu 表补充字段（兼容旧数据库）
    const merchantMenuColMigrations = [
      ['original_price', 'DECIMAL(10,2) DEFAULT NULL'],
      ['sort_order', 'INT DEFAULT 0'],
      ['status', "VARCHAR(20) DEFAULT 'active'"],
    ];
    for (const [col, def] of merchantMenuColMigrations) {
      await safeAddColumn(connection, 'merchant_menu', col, def);
    }

    // ===================== 购物车表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS carts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        merchant_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        quantity INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      )
    `);

    // ===================== 收入记录表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS income_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rider_id INT NOT NULL,
        date DATE NOT NULL,
        base_income DECIMAL(10,2) DEFAULT 0.00,
        peak_bonus DECIMAL(10,2) DEFAULT 0.00,
        weather_bonus DECIMAL(10,2) DEFAULT 0.00,
        reward_bonus DECIMAL(10,2) DEFAULT 0.00,
        total DECIMAL(10,2) DEFAULT 0.00,
        order_count INT DEFAULT 0,
        FOREIGN KEY (rider_id) REFERENCES riders(id),
        UNIQUE KEY unique_rider_date (rider_id, date)
      )
    `);

    // ===================== 提现记录表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rider_id INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        remark TEXT,
        reject_reason TEXT DEFAULT NULL,
        reviewed_at TIMESTAMP NULL,
        FOREIGN KEY (rider_id) REFERENCES riders(id)
      )
    `);

    // 为已存在的 withdrawals 表补充字段（兼容旧数据库）
    const withdrawalColMigrations = [
      ['reject_reason', 'TEXT DEFAULT NULL'],
      ['reviewed_at', 'TIMESTAMP NULL'],
    ];
    for (const [col, def] of withdrawalColMigrations) {
      await safeAddColumn(connection, 'withdrawals', col, def);
    }

    // ===================== 商家账单表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS merchant_bills (
        id INT AUTO_INCREMENT PRIMARY KEY,
        merchant_id INT NOT NULL,
        date DATE NOT NULL,
        order_count INT DEFAULT 0,
        total_amount DECIMAL(10,2) DEFAULT 0.00,
        commission DECIMAL(10,2) DEFAULT 0.00,
        delivery_fee DECIMAL(10,2) DEFAULT 0.00,
        discount DECIMAL(10,2) DEFAULT 0.00,
        actual_amount DECIMAL(10,2) DEFAULT 0.00,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id),
        UNIQUE KEY unique_merchant_date (merchant_id, date)
      )
    `);

    // ===================== 用户收藏表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_favorites (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        merchant_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_merchant (user_id, merchant_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      )
    `);

    // ===================== 公告表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        type ENUM('platform', 'merchant', 'rider') DEFAULT 'platform',
        status ENUM('draft', 'published', 'archived') DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ===================== 支付记录表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_no VARCHAR(50) NOT NULL,
        user_id INT NOT NULL,
        merchant_order_id INT DEFAULT NULL,
        rider_order_id INT DEFAULT NULL,
        amount DECIMAL(10,2) NOT NULL,
        channel VARCHAR(50) DEFAULT NULL,
        status ENUM('pending', 'success', 'failed', 'refunded') DEFAULT 'pending',
        transaction_id VARCHAR(100) DEFAULT NULL,
        paid_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // ===================== 评价表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT DEFAULT NULL,
        user_id INT NOT NULL,
        merchant_id INT NOT NULL,
        rating INT NOT NULL DEFAULT 5,
        content TEXT DEFAULT NULL,
        taste_rating INT DEFAULT 5,
        packaging_rating INT DEFAULT 5,
        delivery_rating INT DEFAULT 5,
        images JSON DEFAULT NULL,
        reply TEXT DEFAULT NULL,
        merchant_reply TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      )
    `);

    // ===================== 用户优惠券表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_coupons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        coupon_id INT NOT NULL,
        status ENUM('unused', 'used', 'expired') DEFAULT 'unused',
        claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        used_at TIMESTAMP NULL,
        expires_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // ===================== 用户地址表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_addresses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(50) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        address VARCHAR(255) NOT NULL,
        address_detail VARCHAR(255) DEFAULT NULL,
        latitude DECIMAL(10,7) DEFAULT NULL,
        longitude DECIMAL(10,7) DEFAULT NULL,
        tag VARCHAR(20) DEFAULT NULL,
        is_default TINYINT DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // ===================== 商家评价表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS merchant_reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT DEFAULT NULL,
        user_id INT NOT NULL,
        merchant_id INT NOT NULL,
        rating INT NOT NULL DEFAULT 5,
        content TEXT DEFAULT NULL,
        taste_rating INT DEFAULT 5,
        packaging_rating INT DEFAULT 5,
        delivery_rating INT DEFAULT 5,
        images JSON DEFAULT NULL,
        reply TEXT DEFAULT NULL,
        merchant_reply TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      )
    `);

    // ===================== 商家退款表 =====================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS merchant_refunds (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT DEFAULT NULL,
        merchant_id INT NOT NULL,
        refund_amount DECIMAL(10,2) NOT NULL,
        reason TEXT DEFAULT NULL,
        type ENUM('full', 'partial') DEFAULT 'full',
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      )
    `);

    // ===================== 补全辅助表（路由文件中使用但不在主建表逻辑中的表） =====================
    const auxiliaryTables = [
      // 通知表（商家消息）
      `CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT, target_type VARCHAR(20) DEFAULT 'user',
        type VARCHAR(50), title VARCHAR(200), content TEXT,
        is_read TINYINT DEFAULT 0, data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 商家结算表
      `CREATE TABLE IF NOT EXISTS merchant_settlements (
        id INT AUTO_INCREMENT PRIMARY KEY, merchant_id INT NOT NULL,
        period_start DATE, period_end DATE,
        order_count INT DEFAULT 0, gross_amount DECIMAL(12,2) DEFAULT 0,
        commission DECIMAL(12,2) DEFAULT 0, net_amount DECIMAL(12,2) DEFAULT 0,
        total_amount DECIMAL(12,2) DEFAULT 0, delivery_fee DECIMAL(12,2) DEFAULT 0,
        status ENUM('pending','settled','completed') DEFAULT 'pending',
        settled_at TIMESTAMP NULL, settled_by INT, bank_info TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 财务账单表（merchant finance/statements 使用）
      `CREATE TABLE IF NOT EXISTS finance_settlements (
        id INT AUTO_INCREMENT PRIMARY KEY, merchant_id INT NOT NULL,
        settlement_no VARCHAR(64), total_amount DECIMAL(12,2) DEFAULT 0,
        service_fee DECIMAL(12,2) DEFAULT 0, settled_amount DECIMAL(12,2) DEFAULT 0,
        status ENUM('pending','settled','failed') DEFAULT 'pending',
        settled_at TIMESTAMP NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_merchant (merchant_id), INDEX idx_status (status)
      )`,
      // 商家资质审核
      `CREATE TABLE IF NOT EXISTS merchant_qualifications (
        id INT AUTO_INCREMENT PRIMARY KEY, merchant_id INT NOT NULL,
        business_license VARCHAR(500), food_license VARCHAR(500),
        legal_id_front VARCHAR(500), legal_id_back VARCHAR(500),
        shop_front_photo VARCHAR(500), kitchen_photo VARCHAR(500),
        legal_name VARCHAR(100), business_address VARCHAR(255),
        status ENUM('pending','approved','rejected') DEFAULT 'pending',
        reject_reason TEXT, reviewed_at TIMESTAMP NULL, reviewer_id INT,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 商家合同
      `CREATE TABLE IF NOT EXISTS merchant_contracts (
        id INT AUTO_INCREMENT PRIMARY KEY, merchant_id INT NOT NULL UNIQUE,
        commission_rate DECIMAL(5,2) DEFAULT 8.00,
        settlement_cycle VARCHAR(10) DEFAULT 'T1',
        signed_at TIMESTAMP NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 菜单分类
      `CREATE TABLE IF NOT EXISTS menu_categories (
        id INT AUTO_INCREMENT PRIMARY KEY, merchant_id INT NOT NULL,
        name VARCHAR(50) NOT NULL, parent_id INT,
        sort_order INT DEFAULT 0, is_visible TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 商家员工
      `CREATE TABLE IF NOT EXISTS merchant_staff (
        id INT AUTO_INCREMENT PRIMARY KEY, merchant_id INT NOT NULL,
        name VARCHAR(50), phone VARCHAR(20), password VARCHAR(255),
        role VARCHAR(20), permissions JSON, status VARCHAR(20) DEFAULT 'active',
        is_deleted TINYINT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 商家套餐
      `CREATE TABLE IF NOT EXISTS merchant_combos (
        id INT AUTO_INCREMENT PRIMARY KEY, merchant_id INT NOT NULL,
        name VARCHAR(100), description TEXT, price DECIMAL(10,2),
        original_price DECIMAL(10,2), image VARCHAR(500),
        items JSON, is_available TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 商家促销
      `CREATE TABLE IF NOT EXISTS merchant_promotions (
        id INT AUTO_INCREMENT PRIMARY KEY, merchant_id INT NOT NULL,
        type VARCHAR(50), title VARCHAR(200), config JSON,
        status VARCHAR(20) DEFAULT 'active',
        start_at DATETIME, end_at DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 商家优惠券
      `CREATE TABLE IF NOT EXISTS merchant_coupons (
        id INT AUTO_INCREMENT PRIMARY KEY, merchant_id INT NOT NULL,
        type VARCHAR(20), name VARCHAR(100),
        face_value DECIMAL(10,2), min_order_amount DECIMAL(10,2) DEFAULT 0,
        total_quantity INT DEFAULT 100, remaining_quantity INT DEFAULT 100,
        total_count INT DEFAULT 100, used_count INT DEFAULT 0, claimed_count INT DEFAULT 0,
        start_time DATETIME, end_time DATETIME,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 商家操作日志
      `CREATE TABLE IF NOT EXISTS merchant_operation_logs (
        id INT AUTO_INCREMENT PRIMARY KEY, merchant_id INT NOT NULL,
        operator_id INT, action VARCHAR(100), detail TEXT, ip VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 商家提现
      `CREATE TABLE IF NOT EXISTS merchant_withdrawals (
        id INT AUTO_INCREMENT PRIMARY KEY, merchant_id INT NOT NULL,
        amount DECIMAL(12,2), bank_name VARCHAR(100), account_no VARCHAR(50),
        account_name VARCHAR(50), status ENUM('pending','processing','approved','rejected') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 商家订单地址变更记录
      `CREATE TABLE IF NOT EXISTS merchant_order_address_changes (
        id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL,
        old_address TEXT, new_address TEXT, changed_by INT, changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 商家评价回复
      `CREATE TABLE IF NOT EXISTS merchant_review_replies (
        id INT AUTO_INCREMENT PRIMARY KEY, review_id INT NOT NULL,
        merchant_id INT NOT NULL, content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 商家评价申诉
      `CREATE TABLE IF NOT EXISTS merchant_review_appeals (
        id INT AUTO_INCREMENT PRIMARY KEY, review_id INT NOT NULL,
        merchant_id INT NOT NULL, reason TEXT, evidence JSON,
        status ENUM('pending','approved','rejected') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 商家处罚记录
      `CREATE TABLE IF NOT EXISTS merchant_punishments (
        id INT AUTO_INCREMENT PRIMARY KEY, merchant_id INT NOT NULL,
        admin_id INT, type VARCHAR(20), reason TEXT,
        amount DECIMAL(10,2) DEFAULT 0, duration_days INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 商家订单明细
      `CREATE TABLE IF NOT EXISTS merchant_order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        merchant_order_id INT, merchant_id INT,
        item_id INT, item_name VARCHAR(200), item_qty INT DEFAULT 1,
        item_price DECIMAL(10,2), menu_name VARCHAR(200),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 管理员操作日志
      `CREATE TABLE IF NOT EXISTS admin_operation_logs (
        id INT AUTO_INCREMENT PRIMARY KEY, admin_id INT,
        action VARCHAR(100), target_type VARCHAR(50), target_id INT,
        detail TEXT, details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 管理员日志（旧版兼容）
      `CREATE TABLE IF NOT EXISTS admin_logs (
        id INT AUTO_INCREMENT PRIMARY KEY, admin_id INT,
        action VARCHAR(100), target_type VARCHAR(50), target_id INT,
        details TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 骑手评价
      `CREATE TABLE IF NOT EXISTS rider_reviews (
        id INT AUTO_INCREMENT PRIMARY KEY, rider_id INT NOT NULL,
        order_id INT, order_no VARCHAR(50), rating INT DEFAULT 5,
        comment TEXT, type VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 骑手扣分记录
      `CREATE TABLE IF NOT EXISTS credit_deductions (
        id INT AUTO_INCREMENT PRIMARY KEY, rider_id INT NOT NULL,
        reason VARCHAR(200), score INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 骑手申诉
      `CREATE TABLE IF NOT EXISTS rider_appeals (
        id INT AUTO_INCREMENT PRIMARY KEY, rider_id INT NOT NULL,
        type VARCHAR(20), target_id INT, reason TEXT, evidence JSON,
        status ENUM('pending','approved','rejected') DEFAULT 'pending',
        result TEXT, arbitrated_by INT, arbitrated_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      // 骑手接单设置
      `CREATE TABLE IF NOT EXISTS rider_settings (
        id INT AUTO_INCREMENT PRIMARY KEY, rider_id INT NOT NULL UNIQUE,
        max_distance DECIMAL(5,1) DEFAULT 10,
        accept_normal TINYINT DEFAULT 1, accept_long TINYINT DEFAULT 1,
        accept_errand TINYINT DEFAULT 0, auto_accept TINYINT DEFAULT 0,
        voice_broadcast TINYINT DEFAULT 1
      )`,
      // 骑手工作日志
      `CREATE TABLE IF NOT EXISTS rider_work_logs (
        id INT AUTO_INCREMENT PRIMARY KEY, rider_id INT NOT NULL,
        log_date DATE NOT NULL, duration_minutes INT DEFAULT 0,
        UNIQUE KEY unique_rider_logdate (rider_id, log_date)
      )`,
      // 骑手银行卡
      `CREATE TABLE IF NOT EXISTS rider_bank_cards (
        id INT AUTO_INCREMENT PRIMARY KEY, rider_id INT NOT NULL,
        bank_name VARCHAR(100), card_number_last4 VARCHAR(4),
        card_holder VARCHAR(50), is_default TINYINT DEFAULT 0,
        is_deleted TINYINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 骑手消息
      `CREATE TABLE IF NOT EXISTS rider_messages (
        id INT AUTO_INCREMENT PRIMARY KEY, rider_id INT NOT NULL,
        type VARCHAR(20), title VARCHAR(200), content TEXT,
        is_read TINYINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 骑手安全报备
      `CREATE TABLE IF NOT EXISTS rider_safety_reports (
        id INT AUTO_INCREMENT PRIMARY KEY, rider_id INT NOT NULL,
        latitude DECIMAL(10,7), longitude DECIMAL(10,7), note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 骑手奖励活动
      `CREATE TABLE IF NOT EXISTS rider_reward_activities (
        id INT AUTO_INCREMENT PRIMARY KEY, rider_id INT,
        title VARCHAR(200), description TEXT,
        reward_amount DECIMAL(10,2), target_count INT, current_count INT DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active',
        start_at DATETIME, end_at DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 收入扣款记录
      `CREATE TABLE IF NOT EXISTS income_deductions (
        id INT AUTO_INCREMENT PRIMARY KEY, rider_id INT NOT NULL,
        order_id INT, order_no VARCHAR(50),
        amount DECIMAL(10,2), reason VARCHAR(200),
        status VARCHAR(20) DEFAULT 'deducted',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 订单异常记录
      `CREATE TABLE IF NOT EXISTS order_exceptions (
        id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL,
        rider_id INT NOT NULL, type VARCHAR(50),
        description TEXT, photos JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 平台广告位
      `CREATE TABLE IF NOT EXISTS platform_banners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        position VARCHAR(50), image VARCHAR(500), title VARCHAR(200),
        link_type VARCHAR(20), link_target VARCHAR(500),
        sort_order INT DEFAULT 0, is_active TINYINT DEFAULT 1,
        start_at DATETIME, end_at DATETIME, created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 风控事件
      `CREATE TABLE IF NOT EXISTS risk_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type VARCHAR(50), status VARCHAR(20) DEFAULT 'pending',
        action VARCHAR(50), note TEXT,
        target_id INT, target_type VARCHAR(50),
        handled_by INT, handled_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 配送费配置
      `CREATE TABLE IF NOT EXISTS delivery_fee_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        base_fee DECIMAL(8,2) DEFAULT 5.00, base_distance DECIMAL(5,1) DEFAULT 3.0,
        extra_fee_per_km DECIMAL(8,2) DEFAULT 1.50, max_fee DECIMAL(8,2) DEFAULT 30.00,
        night_fee_extra DECIMAL(8,2) DEFAULT 2.00,
        night_start_time TIME DEFAULT '22:00:00', night_end_time TIME DEFAULT '06:00:00',
        is_default TINYINT DEFAULT 0, status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 平台优惠券
      `CREATE TABLE IF NOT EXISTS coupons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) UNIQUE, name VARCHAR(100), type VARCHAR(20) DEFAULT 'platform',
        discount_type VARCHAR(20), discount_value DECIMAL(10,2),
        threshold_amount DECIMAL(10,2) DEFAULT 0, max_discount DECIMAL(10,2),
        total_quantity INT DEFAULT 0, remaining_quantity INT DEFAULT 0,
        per_user_limit INT DEFAULT 1,
        start_time DATETIME, end_time DATETIME,
        merchant_id INT, status VARCHAR(20) DEFAULT 'active',
        created_by INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 用户反馈
      `CREATE TABLE IF NOT EXISTS user_feedback (
        id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL,
        type VARCHAR(50), content TEXT, images JSON,
        status ENUM('pending','processed','closed') DEFAULT 'pending',
        admin_reply TEXT, processed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      // 评价图片
      `CREATE TABLE IF NOT EXISTS review_images (
        id INT AUTO_INCREMENT PRIMARY KEY, review_id INT NOT NULL,
        image_url VARCHAR(500), sort_order INT DEFAULT 0
      )`,
      // 基础订单表（部分前端路由使用）
      // ===================== 骑手地图标记表 =====================
      `CREATE TABLE IF NOT EXISTS rider_map_markers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rider_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(20) DEFAULT 'other',
        description TEXT,
        notes TEXT,
        latitude DECIMAL(10,7) NOT NULL,
        longitude DECIMAL(10,7) NOT NULL,
        address VARCHAR(255),
        photos JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_rider (rider_id),
        INDEX idx_type (type),
        INDEX idx_location (latitude, longitude)
      )`,
      // ===================== 骑手地图路线表 =====================
      `CREATE TABLE IF NOT EXISTS rider_map_routes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rider_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        start_time DATETIME,
        end_time DATETIME,
        duration_seconds INT,
        total_distance DECIMAL(10,2),
        avg_speed DECIMAL(5,2),
        start_address VARCHAR(255),
        end_address VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_rider (rider_id)
      )`,
      // ===================== 骑手地图路线点表 =====================
      `CREATE TABLE IF NOT EXISTS rider_map_route_points (
        id INT AUTO_INCREMENT PRIMARY KEY,
        route_id INT NOT NULL,
        latitude DECIMAL(10,7) NOT NULL,
        longitude DECIMAL(10,7) NOT NULL,
        timestamp DATETIME,
        speed DECIMAL(5,2),
        accuracy DECIMAL(5,2),
        altitude DECIMAL(8,2),
        bearing DECIMAL(5,2),
        sequence INT NOT NULL,
        INDEX idx_route (route_id),
        INDEX idx_sequence (route_id, sequence),
        FOREIGN KEY (route_id) REFERENCES rider_map_routes(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_no VARCHAR(50) UNIQUE, user_id INT, merchant_id INT,
        rider_id INT, total_amount DECIMAL(10,2) DEFAULT 0,
        payment_status VARCHAR(20) DEFAULT 'unpaid',
        status VARCHAR(20) DEFAULT 'pending',
        delivery_address TEXT, delivery_name VARCHAR(50), delivery_phone VARCHAR(20),
        items JSON, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    ];

    for (const createSql of auxiliaryTables) {
      try {
        await connection.query(createSql);
      } catch (e) {
        if (!e.message.includes('already exists')) {
          console.warn('辅助表创建警告:', e.message.substring(0, 80));
        }
      }
    }

    // ===================== 自动执行迁移脚本（仅首次部署时） =====================
    try {
      const fs = require('fs');
      const path = require('path');
      const migrationFile = path.join(__dirname, '..', 'migrations', '003_production_migration.sql');
      
      if (fs.existsSync(migrationFile)) {
        // 使用 merchant_settlements 作为迁移标记（仅在迁移文件中创建）
        const [tables] = await connection.query(
          "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'merchant_settlements'"
        );
        
        if (tables.length === 0) {
          console.log('检测到首次部署，正在执行完整迁移...');
          const migrationSql = fs.readFileSync(migrationFile, 'utf8');
          
          // 按语句分割执行（处理存储过程中的分号）
          const statements = migrationSql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('DELIMITER') && !s.startsWith('CALL') && !s.startsWith('DROP PROCEDURE'));
          
          for (const stmt of statements) {
            try {
              await connection.query(stmt);
            } catch (e) {
              // 忽略已存在的错误，记录其他错误
              if (!e.message.includes('already exists') && !e.message.includes('Duplicate')) {
                console.warn('迁移警告:', e.message.substring(0, 100));
              }
            }
          }
          
          // 单独执行存储过程（需要特殊处理DELIMITER）
          try {
            // [P0修复] 不再通过命令行参数传递密码（ps aux可泄露）
            const { spawnSync } = require('child_process');
            const dbConfig = {
              host: process.env.DB_HOST || 'localhost',
              port: process.env.DB_PORT || 3306,
              user: process.env.DB_USER || 'root',
              password: process.env.DB_PASSWORD || '',
              database: process.env.DB_NAME || 'kuailv',
            };
            // 使用 MYSQL_PWD 环境变量传递密码，不会出现在进程列表中
            const env = { ...process.env };
            if (dbConfig.password) {
              env.MYSQL_PWD = dbConfig.password;
            }
            spawnSync('mysql', [
              '-h', dbConfig.host,
              '-P', String(dbConfig.port),
              '-u', dbConfig.user,
              dbConfig.database,
            ], {
              env,
              stdio: 'pipe',
              input: require('fs').readFileSync(migrationFile),
            });
          } catch (e) {
            // execSync失败不影响启动，核心表已通过上面的循环创建
          }
          
          console.log('✅ 数据库迁移完成');
        } else {
          console.log('数据库已是最新版本（迁移已执行过）');
        }
      }
    } catch (e) {
      console.warn('自动迁移检查失败（不影响启动）:', e.message);
    }

    console.log('Database tables initialized successfully');

    // ===================== Schema补丁：修复已有表缺失的列 =====================
    const alterStatements = [
      // merchant_reviews: 补 merchant_reply 列（服务器旧表列名为 reply，代码用 merchant_reply）
      "ALTER TABLE merchant_reviews ADD COLUMN merchant_reply TEXT DEFAULT NULL AFTER comment",
      // merchant_reviews: 补 content 列
      "ALTER TABLE merchant_reviews ADD COLUMN content TEXT DEFAULT NULL AFTER rating",
      // merchant_reviews: 补 tags 列
      "ALTER TABLE merchant_reviews ADD COLUMN tags VARCHAR(500) DEFAULT NULL AFTER content",
      // merchant_reviews: 补 reply_at 列
      "ALTER TABLE merchant_reviews ADD COLUMN reply_at DATETIME DEFAULT NULL AFTER merchant_reply",
      // merchant_settlements: 补 total_amount 和 delivery_fee 列
      "ALTER TABLE merchant_settlements ADD COLUMN total_amount DECIMAL(12,2) DEFAULT 0 AFTER net_amount",
      "ALTER TABLE merchant_settlements ADD COLUMN delivery_fee DECIMAL(12,2) DEFAULT 0 AFTER total_amount",
      // merchant_promotions: 补 name 列（代码用 name，旧表可能只有 title）
      "ALTER TABLE merchant_promotions ADD COLUMN name VARCHAR(200) DEFAULT NULL AFTER type",
      // merchant_promotions: 补 rules 列
      "ALTER TABLE merchant_promotions ADD COLUMN rules JSON DEFAULT NULL AFTER name",
      // merchant_promotions: 补 start_time/end_time 列
      "ALTER TABLE merchant_promotions ADD COLUMN start_time DATETIME DEFAULT NULL AFTER status",
      "ALTER TABLE merchant_promotions ADD COLUMN end_time DATETIME DEFAULT NULL AFTER start_time",
      // user_coupons: 补 expires_at 列
      "ALTER TABLE user_coupons ADD COLUMN expires_at TIMESTAMP NULL AFTER used_at",
      // merchant_order_items: 补 menu_name 列
      "ALTER TABLE merchant_order_items ADD COLUMN menu_name VARCHAR(200) DEFAULT NULL AFTER item_price",
      // merchant_order_items: 补 quantity 列（代码可能用 quantity 而非 item_qty）
      "ALTER TABLE merchant_order_items ADD COLUMN quantity INT DEFAULT 1 AFTER menu_name",
    ];
    for (const sql of alterStatements) {
      try {
        await connection.query(sql);
      } catch (e) {
        // 忽略"列已存在"错误 (Duplicate column)
        if (!e.message.includes('Duplicate column')) {
          // 静默忽略其他错误（表不存在等）
        }
      }
    }

    // 确保 user_favorites 表存在（可能因外键失败未创建）
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS user_favorites (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          merchant_id INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_user_merchant (user_id, merchant_id)
        )
      `);
    } catch (e) { /* ignore */ }

  } finally {
    connection.release();
  }
}

module.exports = { pool, initDatabase };
