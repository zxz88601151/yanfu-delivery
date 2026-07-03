/**
 * ========================================
 * 盐阜配送 - Yanfu Delivery
 * ========================================
 * © 中哥  All Rights Reserved. 商用需联系本人授权
 * FP_UUID_31adb5871aea40b8b0c288773f094ab2|FP_AUTHOR_中哥_SN_20260531|FP_HASH_20260531B9F3|FP_ORIGIN_2026_AUTHOR_中哥
 * ========================================
 * 严禁未经授权转载、商用，商用需联系作者授权
 * 遵循开源协议，仅限项目内部使用，商用需联系本人授权
 * ========================================
 */

module.exports = {
  apps: [{
    name: 'yanfu-backend',
    script: 'app.js',
    cwd: '/www/wwwroot/yanfu_backend',
    instances: 1,
    autorestart: true,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DB_HOST: 'localhost',
      DB_PORT: 3306,
      DB_USER: 'kuailv',
      DB_PASSWORD: 'Kuailv@2026!Secure',
      DB_NAME: 'kuailv',
      YANFU_DB_HOST: 'localhost',
      YANFU_DB_PORT: 3306,
      YANFU_DB_USER: 'kuailv',
      YANFU_DB_PASSWORD: 'Kuailv@2026!Secure',
      YANFU_DB_NAME: 'kuailv',
      JWT_SECRET: 'kuailv_super_secret_jwt_key_2026_production_32chars!!',
      JWT_EXPIRES_IN: 259200,
      JWT_REFRESH_EXPIRES_IN: 604800,
    }
  }]
};

---

© 中哥  All Rights Reserved. 商用需联系本人授权
FP_UUID_31adb5871aea40b8b0c288773f094ab2|FP_AUTHOR_中哥_SN_20260531|FP_HASH_20260531B9F3|FP_ORIGIN_2026_AUTHOR_中哥
