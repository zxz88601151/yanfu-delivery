/**
 * ========================================
 * 盐阜配送 - Yanfu Delivery
 * ========================================
 * © 中哥  All Rights Reserved
 * FP_UUID_31adb5871aea40b8b0c288773f094ab2|FP_AUTHOR_中哥_SN_20260531|FP_HASH_20260531B9F3|FP_ORIGIN_2026_AUTHOR_中哥
 * ========================================
 * 严禁未经授权转载、商用，商用需联系作者授权
 * 遵循开源协议，仅限项目内部使用，商用需联系本人授权
 * ========================================
 */

const crypto = require('crypto');
// 高德地图服务 - 地址解析、距离计算、配送费
const https = require('https');
const http = require('http');

const AMAP_CONFIG = {
  key: process.env.AMAP_REST_KEY || process.env.AMAP_KEY || '',
  privateKey: process.env.AMAP_PRIVATE_KEY || '',
  baseUrl: 'https://restapi.amap.com/v3',
};

// ========== 地址解析 ==========

/**
 * 地址转坐标（地理编码）
 * @param {string} address - 地址文本
 * @param {string} city - 城市名
 * @returns {Promise<{lng, lat, formattedAddress}>}
 */
function geocode(address, city = '') {
  return amapRequest('/geocode/geo', { address, city, output: 'JSON' })
    .then(data => {
      if (data.geocodes && data.geocodes.length > 0) {
        const geo = data.geocodes[0];
        const [lng, lat] = geo.location.split(',');
        return { lng: parseFloat(lng), lat: parseFloat(lat), formattedAddress: geo.formatted_address };
      }
      throw new Error('地址解析失败');
    });
}

/**
 * 坐标转地址（逆地理编码）
 * @param {number} lng - 经度
 * @param {number} lat - 纬度
 */
function reverseGeocode(lng, lat) {
  return amapRequest('/geocode/regeo', { location: `${lng},${lat}`, output: 'JSON' })
    .then(data => {
      if (data.regeocode) {
        return {
          formattedAddress: data.regeocode.formatted_address,
          province: data.regeocode.addressComponent?.province,
          city: data.regeocode.addressComponent?.city,
          district: data.regeocode.addressComponent?.district,
          township: data.regeocode.addressComponent?.township,
        };
      }
      throw new Error('逆地理编码失败');
    });
}

/**
 * 关键词搜索POI
 * @param {string} keyword - 搜索关键词
 * @param {string} city - 城市
 * @param {number} lng - 中心经度
 * @param {number} lat - 中心纬度
 * @param {number} radius - 搜索半径（米）
 */
function searchPOI(keyword, city = '', lng = 0, lat = 0, radius = 5000) {
  const params = { keywords: keyword, city, output: 'JSON', offset: 20 };
  if (lng && lat) {
    params.location = `${lng},${lat}`;
    params.radius = radius;
  }
  return amapRequest('/place/text', params)
    .then(data => {
      if (data.pois) {
        return data.pois.map(poi => {
          const [lng, lat] = poi.location.split(',');
          return {
            id: poi.id,
            name: poi.name,
            address: poi.address,
            lng: parseFloat(lng),
            lat: parseFloat(lat),
            tel: poi.tel,
            type: poi.type,
          };
        });
      }
      return [];
    });
}

// ========== 距离和路线 ==========

/**
 * 计算两点间距离（直线）
 * @param {number} lng1 起点经度
 * @param {number} lat1 起点纬度
 * @param {number} lng2 终点经度
 * @param {number} lat2 终点纬度
 * @returns {Promise<{distance, duration}>} distance单位米, duration单位秒
 */
function calcDistance(lng1, lat1, lng2, lat2) {
  return amapRequest('/direction/distance', {
    origins: `${lng1},${lat1}`,
    destination: `${lng2},${lat2}`,
    type: '1', // 1=驾车距离
    output: 'JSON',
  }).then(data => {
    if (data.route && data.route.paths && data.route.paths.length > 0) {
      const path = data.route.paths[0];
      return {
        distance: parseInt(path.distance), // 米
        duration: parseInt(path.duration), // 秒
      };
    }
    // 回退：Haversine公式计算直线距离
    return {
      distance: haversine(lat1, lng1, lat2, lng2),
      duration: 0,
    };
  });
}

/**
 * 骑行路线规划
 */
function calcRidingRoute(lng1, lat1, lng2, lat2) {
  return amapRequest('/direction/bicycling', {
    origin: `${lng1},${lat1}`,
    destination: `${lng2},${lat2}`,
    output: 'JSON',
  }).then(data => {
    if (data.route && data.route.paths && data.route.paths.length > 0) {
      const path = data.route.paths[0];
      const steps = path.steps.map(step => ({
        instruction: step.instruction,
        distance: parseInt(step.distance),
        duration: parseInt(step.duration),
        road: step.road,
      }));
      return {
        distance: parseInt(path.distance),
        duration: parseInt(path.duration),
        steps,
      };
    }
    throw new Error('路线规划失败');
  });
}

/**
 * 驾车路线规划
 */
function calcDrivingRoute(lng1, lat1, lng2, lat2) {
  return amapRequest('/direction/driving', {
    origin: `${lng1},${lat1}`,
    destination: `${lng2},${lat2}`,
    output: 'JSON',
  }).then(data => {
    if (data.route && data.route.paths && data.route.paths.length > 0) {
      const path = data.route.paths[0];
      return {
        distance: parseInt(path.distance),
        duration: parseInt(path.duration),
        tolls: path.tolls,
        taxiCost: path.taxi_cost,
      };
    }
    throw new Error('驾车路线规划失败');
  });
}

// ========== 配送费计算 ==========

/**
 * 根据起终点计算配送费
 */
async function calcDeliveryFee(fromLng, fromLat, toLng, toLat) {
  try {
    const { distance } = await calcDistance(fromLng, fromLat, toLng, toLat);

    // 从数据库读取配送费配置
    const { pool } = require('../config/database');
    const [configs] = await pool.query(
      "SELECT * FROM delivery_fee_configs WHERE status = 'active' ORDER BY is_default DESC LIMIT 1"
    );

    if (configs.length === 0) {
      return { distance, fee: 3.00, breakdown: { baseFee: 3.00, extraFee: 0 } };
    }

    const config = configs[0];
    const baseDistance = config.base_distance || 3000; // 米
    const baseFee = parseFloat(config.base_fee);
    const extraPerKm = parseFloat(config.extra_fee_per_km);
    const maxFee = config.max_fee ? parseFloat(config.max_fee) : null;

    let fee = baseFee;
    let extraFee = 0;

    if (distance > baseDistance) {
      const extraDistance = (distance - baseDistance) / 1000; // 公里
      extraFee = Math.ceil(extraDistance) * extraPerKm;
      fee = baseFee + extraFee;
    }

    // 夜间加价
    const now = new Date();
    const hour = now.getHours();
    const nightStart = parseInt(String(config.night_start_time || '22:00:00').split(':')[0]);
    const nightEnd = parseInt(String(config.night_end_time || '06:00:00').split(':')[0]);
    let nightExtra = 0;
    if (hour >= nightStart || hour < nightEnd) {
      nightExtra = parseFloat(config.night_fee_extra || 0);
      fee += nightExtra;
    }

    // 最高配送费限制
    if (maxFee && fee > maxFee) {
      fee = maxFee;
    }

    return {
      distance,
      fee: parseFloat(fee.toFixed(2)),
      breakdown: {
        baseFee,
        extraFee: parseFloat(extraFee.toFixed(2)),
        nightExtra,
        totalBeforeCap: parseFloat((baseFee + extraFee + nightExtra).toFixed(2)),
      },
    };
  } catch (err) {
    console.error('计算配送费失败:', err.message);
    return { distance: 0, fee: 3.00, breakdown: { baseFee: 3.00, extraFee: 0 } };
  }
}

// ========== 工具函数 ==========


// 高德签名计算：参数按字母排序，拼接成 key=value&...，末尾加私钥，MD5
function signAmap(params, privateKey) {
  const keys = Object.keys(params).sort();
  let str = '';
  for (const k of keys) {
    str += k + '=' + params[k] + '&';
  }
  str = str.slice(0, -1); // 去掉末尾 &
  str += privateKey;
  return crypto.createHash('md5').update(str).digest('hex');
}

function amapRequest(path, params) {
  return new Promise((resolve, reject) => {
    if (!AMAP_CONFIG.key) {
      reject(new Error('高德地图API Key未配置'));
      return;
    }

    params.key = AMAP_CONFIG.key;

    // 如果配置了私钥，计算签名
    if (AMAP_CONFIG.privateKey) {
      params.sig = signAmap(params, AMAP_CONFIG.privateKey);
    }

    const queryStr = new URLSearchParams(params).toString();
    const url = `${AMAP_CONFIG.baseUrl}${path}?${queryStr}`;

    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.status === '1') {
            resolve(result);
          } else {
            reject(new Error(result.info || '高德API请求失败'));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Haversine公式（球面距离）
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000; // 地球半径（米）
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

module.exports = {
  geocode,
  reverseGeocode,
  searchPOI,
  calcDistance,
  calcRidingRoute,
  calcDrivingRoute,
  calcDeliveryFee,
  AMAP_CONFIG,
};
