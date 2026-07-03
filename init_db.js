const { initDatabase } = require('./config/database.js');
initDatabase()
  .then(() => {
    console.log('✅ 数据库初始化完成');
    process.exit(0);
  })
  .catch(e => {
    console.error('❌ 初始化失败:', e.message);
    process.exit(1);
  });
