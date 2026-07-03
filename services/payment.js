// 支付服务 - 微信支付、支付宝、余额支付
const crypto = require('crypto');

// ========== 配置 ==========
const PAYMENT_CONFIG = {
  wechat: {
    appId: process.env.WECHAT_APP_ID || '',
    mchId: process.env.WECHAT_MCH_ID || '',
    apiKey: process.env.WECHAT_API_KEY || '',
    apicertPath: process.env.WECHAT_APICERT_PATH || '',
    notifyUrl: process.env.WECHAT_NOTIFY_URL || '',
  },
  alipay: {
    appId: process.env.ALIPAY_APP_ID || '',
    privateKey: process.env.ALIPAY_PRIVATE_KEY || '',
    alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY || '',
    notifyUrl: process.env.ALIPAY_NOTIFY_URL || '',
    gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
    sandbox: process.env.ALIPAY_SANDBOX === 'true',
  },
};

// ========== 工具函数 ==========

// 生成订单号（KL前缀 - 真实支付兼容格式）
// 格式: KL + yyyyMMddHHmmss + 6位随机数 (共22位)
function generateOrderNo(prefix = 'KL') {
  const date = new Date().toISOString().replace(/[-T:\.Z]/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `KL${date}${random}`;
}

// 生成纯KL前缀订单号（推荐用于订单）
function generateKLOrderNo() {
  const date = new Date().toISOString().replace(/[-T:\.Z]/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `KL${date}${random}`;
}

// 生成退款单号
function generateRefundNo() {
  return generateOrderNo('RF');
}

// 微信支付签名
function wechatSign(params, apiKey) {
  const sortedKeys = Object.keys(params).filter(k => params[k] !== '' && params[k] !== undefined).sort();
  const stringA = sortedKeys.map(k => `${k}=${params[k]}`).join('&');
  const stringSignTemp = `${stringA}&key=${apiKey}`;
  return crypto.createHash('md5').update(stringSignTemp, 'utf8').digest('hex').toUpperCase();
}

// XML转JSON
function xmlToJson(xml) {
  const json = {};
  const regex = /<(\w+)>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/\1>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    json[match[1]] = match[2];
  }
  return json;
}

// JSON转XML
function jsonToXml(json) {
  let xml = '<xml>';
  for (const [key, value] of Object.entries(json)) {
    xml += `<${key}><![CDATA[${value}]]></${key}>`;
  }
  xml += '</xml>';
  return xml;
}

// ========== 微信支付 ==========

class WechatPay {
  constructor() {
    this.config = PAYMENT_CONFIG.wechat;
    this.enabled = !!(this.config.appId && this.config.mchId && this.config.apiKey);
  }

  // 统一下单（JSAPI - 小程序/公众号）
  async createOrder({ orderNo, amount, body, openid, ip = '127.0.0.1' }) {
    if (!this.enabled) {
      return this._mockOrder(orderNo, amount, 'wechat');
    }

    const params = {
      appid: this.config.appId,
      mch_id: this.config.mchId,
      nonce_str: crypto.randomBytes(16).toString('hex'),
      body: body.slice(0, 128),
      out_trade_no: orderNo,
      total_fee: Math.round(amount * 100), // 单位：分
      spbill_create_ip: ip,
      notify_url: this.config.notifyUrl,
      trade_type: 'JSAPI',
      openid: openid,
    };

    params.sign = wechatSign(params, this.config.apiKey);

    try {
      const https = require('https');
      const xmlData = jsonToXml(params);

      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.mch.weixin.qq.com',
          path: '/pay/unifiedorder',
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(xmlToJson(data)));
        });
        req.on('error', reject);
        req.write(xmlData);
        req.end();
      });

      if (result.return_code === 'SUCCESS' && result.result_code === 'SUCCESS') {
        // 生成前端调起支付所需的参数
        const payParams = {
          appId: this.config.appId,
          timeStamp: Math.floor(Date.now() / 1000).toString(),
          nonceStr: crypto.randomBytes(16).toString('hex'),
          package: `prepay_id=${result.prepay_id}`,
          signType: 'MD5',
        };
        payParams.paySign = wechatSign(payParams, this.config.apiKey);

        return {
          success: true,
          paymentNo: orderNo,
          prepayId: result.prepay_id,
          payParams, // 前端调起支付所需参数
        };
      } else {
        return {
          success: false,
          errCode: result.err_code,
          errMsg: result.err_code_des || result.return_msg,
        };
      }
    } catch (err) {
      console.error('微信支付统一下单失败:', err.message);
      return { success: false, errMsg: err.message };
    }
  }

  // H5支付（手机浏览器）
  async createH5Order({ orderNo, amount, body, ip = '127.0.0.1' }) {
    if (!this.enabled) {
      return this._mockOrder(orderNo, amount, 'wechat_h5');
    }

    const params = {
      appid: this.config.appId,
      mch_id: this.config.mchId,
      nonce_str: crypto.randomBytes(16).toString('hex'),
      body: body.slice(0, 128),
      out_trade_no: orderNo,
      total_fee: Math.round(amount * 100),
      spbill_create_ip: ip,
      notify_url: this.config.notifyUrl,
      trade_type: 'MWEB',
      scene_info: JSON.stringify({ h5_info: { type: 'Wap', wap_url: process.env.BASE_URL || '', wap_name: '盐阜配送' } }),
    };

    params.sign = wechatSign(params, this.config.apiKey);

    try {
      const https = require('https');
      const xmlData = jsonToXml(params);

      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.mch.weixin.qq.com',
          path: '/pay/unifiedorder',
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(xmlToJson(data)));
        });
        req.on('error', reject);
        req.write(xmlData);
        req.end();
      });

      if (result.return_code === 'SUCCESS' && result.result_code === 'SUCCESS') {
        return {
          success: true,
          paymentNo: orderNo,
          mwebUrl: result.mweb_url, // H5支付跳转链接
        };
      } else {
        return { success: false, errCode: result.err_code, errMsg: result.err_code_des };
      }
    } catch (err) {
      return { success: false, errMsg: err.message };
    }
  }

  // 处理支付回调
  async handleNotify(xmlData) {
    const data = xmlToJson(xmlData);

    if (data.return_code !== 'SUCCESS') {
      return { success: false, message: '通信失败' };
    }

    // 验证签名
    const sign = data.sign;
    delete data.sign;
    const expectedSign = wechatSign(data, this.config.apiKey);

    if (sign !== expectedSign) {
      return { success: false, message: '签名验证失败' };
    }

    if (data.result_code !== 'SUCCESS') {
      return { success: false, message: data.err_code_des };
    }

    return {
      success: true,
      paymentNo: data.out_trade_no,
      transactionId: data.transaction_id,
      amount: parseInt(data.total_fee) / 100,
      channel: 'wechat',
      paidAt: data.time_end,
      rawData: data,
    };
  }

  // 生成回调响应XML
  notifyResponse(success) {
    return success
      ? '<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>'
      : '<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[FAIL]]></return_msg></xml>';
  }

  _mockOrder(orderNo, amount, type) {
    console.log(`[Mock] 微信支付下单: ${orderNo}, 金额: ${amount}`);
    return {
      success: true,
      paymentNo: orderNo,
      mock: true,
      message: '微信支付未配置，使用模拟支付',
      payParams: { mock: true, paymentNo: orderNo, amount },
    };
  }
}

// ========== 支付宝 ==========

class Alipay {
  constructor() {
    this.config = PAYMENT_CONFIG.alipay;
    this.enabled = !!(this.config.appId && this.config.privateKey);
  }

  // 手机网站支付
  async createWapOrder({ orderNo, amount, subject, body = '' }) {
    if (!this.enabled) {
      return this._mockOrder(orderNo, amount, 'alipay_wap');
    }

    try {
      const AlipaySdk = require('alipay-sdk').default;
      const alipaySdk = new AlipaySdk({
        appId: this.config.appId,
        privateKey: this.config.privateKey,
        alipayPublicKey: this.config.alipayPublicKey,
        gateway: this.config.sandbox
          ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
          : this.config.gateway,
      });

      const result = await alipaySdk.pageExec('alipay.trade.wap.pay', {
        method: 'GET',
        bizContent: {
          out_trade_no: orderNo,
          total_amount: amount.toFixed(2),
          subject: subject.slice(0, 256),
          body: body.slice(0, 128),
          product_code: 'QUICK_WAP_WAY',
          timeout_express: '30m',
        },
        notify_url: this.config.notifyUrl,
        return_url: process.env.ALIPAY_RETURN_URL || '',
      });

      return {
        success: true,
        paymentNo: orderNo,
        payUrl: result, // 支付宝跳转URL
      };
    } catch (err) {
      console.error('支付宝下单失败:', err.message);
      return { success: false, errMsg: err.message };
    }
  }

  // 处理支付回调
  async handleNotify(params) {
    try {
      const AlipaySdk = require('alipay-sdk').default;
      const alipaySdk = new AlipaySdk({
        appId: this.config.appId,
        privateKey: this.config.privateKey,
        alipayPublicKey: this.config.alipayPublicKey,
      });

      // 验证签名
      const signVerified = alipaySdk.checkNotifySign(params);
      if (!signVerified) {
        return { success: false, message: '签名验证失败' };
      }

      if (params.trade_status !== 'TRADE_SUCCESS' && params.trade_status !== 'TRADE_FINISHED') {
        return { success: false, message: '交易未成功' };
      }

      return {
        success: true,
        paymentNo: params.out_trade_no,
        transactionId: params.trade_no,
        amount: parseFloat(params.total_amount),
        channel: 'alipay',
        buyerId: params.buyer_id,
        rawData: params,
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  _mockOrder(orderNo, amount, type) {
    console.log(`[Mock] 支付宝下单: ${orderNo}, 金额: ${amount}`);
    return {
      success: true,
      paymentNo: orderNo,
      mock: true,
      message: '支付宝未配置，使用模拟支付',
      payUrl: `mock://alipay?orderNo=${orderNo}&amount=${amount}`,
    };
  }
}

// ========== 余额支付 ==========

class BalancePay {
  constructor(pool) {
    this.pool = pool;
  }

  async pay({ userId, orderNo, amount, orderId, orderType }) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      // 检查余额
      const [users] = await conn.query('SELECT balance FROM users WHERE id = ? FOR UPDATE', [userId]);
      if (users.length === 0) {
        await conn.rollback();
        return { success: false, message: '用户不存在' };
      }

      const balance = parseFloat(users[0].balance);
      if (balance < amount) {
        await conn.rollback();
        return { success: false, message: '余额不足', currentBalance: balance };
      }

      // 扣减余额
      await conn.query('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, userId]);

      // 记录支付
      await conn.query(
        `INSERT INTO payments (order_no, user_id, merchant_order_id, rider_order_id, amount, channel, status, paid_at)
         VALUES (?, ?, ?, ?, ?, 'balance', 'success', NOW())`,
        [orderNo, userId, orderType === 'merchant' ? orderId : null, orderType === 'rider' ? orderId : null, amount]
      );

      await conn.commit();

      return {
        success: true,
        paymentNo: orderNo,
        channel: 'balance',
        amount,
        remainingBalance: balance - amount,
      };
    } catch (err) {
      await conn.rollback();
      console.error('余额支付失败:', err.message);
      return { success: false, message: '余额支付失败' };
    } finally {
      conn.release();
    }
  }
}

// ========== 云闪付 ==========

class UnionPay {
  constructor() {
    this.enabled = false; // 模拟模式，无需真实配置
  }

  async createOrder({ orderNo, amount, body }) {
    console.log(`[MockPay] 云闪付下单: ${orderNo}, 金额: ${amount}`);
    return {
      success: true,
      paymentNo: orderNo,
      mock: true,
      message: '云闪付模拟支付',
      payUrl: `mock://unionpay?orderNo=${orderNo}&amount=${amount}`,
    };
  }
}

// ========== 翼支付 ==========

class BestPay {
  constructor() {
    this.enabled = false; // 模拟模式，无需真实配置
  }

  async createOrder({ orderNo, amount, body }) {
    console.log(`[MockPay] 翼支付下单: ${orderNo}, 金额: ${amount}`);
    return {
      success: true,
      paymentNo: orderNo,
      mock: true,
      message: '翼支付模拟支付',
      payUrl: `mock://bestpay?orderNo=${orderNo}&amount=${amount}`,
    };
  }
}

// ========== 导出 ==========
module.exports = {
  WechatPay,
  Alipay,
  BalancePay,
  UnionPay,
  BestPay,
  generateOrderNo,
  generateKLOrderNo,
  generateRefundNo,
  PAYMENT_CONFIG,
};
