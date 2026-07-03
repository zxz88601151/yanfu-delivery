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


