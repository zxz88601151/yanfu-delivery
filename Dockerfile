FROM node:22-slim

WORKDIR /app

# 安装系统依赖（中文字体、MySQL客户端）
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-wqy-zenhei \
    mysql-client \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖配置
COPY package*.json ./

# 安装依赖
RUN npm install --only=production

# 复制应用代码
COPY . .

# 创建必要的目录
RUN mkdir -p logs fonts

# 复制中文字体
RUN cp /usr/share/fonts/truetype/wqy/wqy-zenhei.ttc fonts/ 2>/dev/null || true

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => {process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "app.js"]

---

© 中哥  All Rights Reserved. 商用需联系本人授权
FP_UUID_31adb5871aea40b8b0c288773f094ab2|FP_AUTHOR_中哥_SN_20260531|FP_HASH_20260531B9F3|FP_ORIGIN_2026_AUTHOR_中哥
