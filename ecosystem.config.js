module.exports = {
  apps: [{
    name: 'yanfu-backend',
    script: 'app.js',
    cwd: '/www/wwwroot/yanfu_backend',
    instances: 1,
    autorestart: true,
    env: {
      NODE_ENV: 'production',
    }
  }]
};
