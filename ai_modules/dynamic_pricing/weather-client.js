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

'use strict';

/**
 * 天气 API 客户端 + 缓存
 *
 * 由于无真实天气 API Key，实现为模拟客户端：
 * 1. 先查 node-cache（TTL 30 分钟）
 * 2. 未命中：根据经纬度哈希 + 当前小时，生成伪随机天气
 * 3. 返回 WeatherData 对象
 *
 * @module ai_modules/dynamic_pricing/weather-client
 */

const NodeCache = require('node-cache');
const config = require('../../config/ai_modules');

const cache = new NodeCache({
  stdTTL: config.dynamicPricing.weatherCacheTtl || 1800,
  checkperiod: 300,
});

/**
 * 获取缓存的键名
 *
 * @param {number} lng - 经度
 * @param {number} lat - 纬度
 * @returns {string}
 * @private
 */
function _getCacheKey(lng, lat) {
  return `weather:${lng.toFixed(4)},${lat.toFixed(4)}`;
}

/**
 * 天气等级定义
 */
const WEATHER_GRADES = ['good', 'mild', 'moderate', 'severe'];

const WEATHER_CONDITIONS = {
  good: [
    { condition: 'clear', temperature: [20, 30], humidity: [30, 50], windSpeed: [0, 3] },
    { condition: 'cloudy', temperature: [18, 28], humidity: [40, 60], windSpeed: [1, 5] },
  ],
  mild: [
    { condition: 'light_rain', temperature: [15, 25], humidity: [60, 80], windSpeed: [3, 8] },
    { condition: 'light_snow', temperature: [-5, 5], humidity: [50, 70], windSpeed: [2, 6] },
    { condition: 'windy', temperature: [10, 25], humidity: [30, 50], windSpeed: [8, 12] },
  ],
  moderate: [
    { condition: 'moderate_rain', temperature: [12, 22], humidity: [70, 90], windSpeed: [5, 10] },
    { condition: 'moderate_snow', temperature: [-10, 0], humidity: [60, 80], windSpeed: [4, 8] },
    { condition: 'strong_wind', temperature: [8, 20], humidity: [30, 50], windSpeed: [12, 18] },
  ],
  severe: [
    { condition: 'heavy_rain', temperature: [10, 20], humidity: [80, 95], windSpeed: [8, 15] },
    { condition: 'heavy_snow', temperature: [-15, -5], humidity: [70, 90], windSpeed: [6, 12] },
    { condition: 'storm', temperature: [5, 18], humidity: [70, 95], windSpeed: [15, 25] },
  ],
};

/**
 * 伪随机数生成器（基于种子）
 *
 * @param {number} seed - 种子值
 * @returns {number} 0~1 之间的伪随机数
 * @private
 */
function _seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * 模拟从天气 API 获取数据
 * 基于坐标和时间的伪随机天气生成
 *
 * @param {number} lng - 经度
 * @param {number} lat - 纬度
 * @returns {Promise<Object>} WeatherData
 * @private
 */
async function _fetchFromApi(lng, lat) {
  // 模拟网络延迟 50~200ms
  await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 150));

  const now = new Date();
  const hour = now.getHours();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const seed = Math.floor(lng * 10000) + Math.floor(lat * 10000) * 7 + dayOfYear * 31 + hour;

  const rand = _seededRandom(seed);

  // 根据概率选择天气等级
  let gradeIndex;
  if (rand < 0.45) gradeIndex = 0;        // good 45%
  else if (rand < 0.70) gradeIndex = 1;   // mild 25%
  else if (rand < 0.88) gradeIndex = 2;   // moderate 18%
  else gradeIndex = 3;                     // severe 12%

  const grade = WEATHER_GRADES[gradeIndex];
  const conditions = WEATHER_CONDITIONS[grade];
  const conditionIndex = Math.floor(_seededRandom(seed + 1) * conditions.length);
  const conditionData = conditions[conditionIndex];

  const tempRand = _seededRandom(seed + 2);
  const temperature = Math.round(
    (conditionData.temperature[0] + tempRand * (conditionData.temperature[1] - conditionData.temperature[0])) * 10,
  ) / 10;

  const humidity = Math.round(
    conditionData.humidity[0] + _seededRandom(seed + 3) * (conditionData.humidity[1] - conditionData.humidity[0]),
  );

  const windSpeed = Math.round(
    (conditionData.windSpeed[0] + _seededRandom(seed + 4) * (conditionData.windSpeed[1] - conditionData.windSpeed[0])) * 10,
  ) / 10;

  return {
    condition: conditionData.condition,
    temperature,
    humidity,
    windSpeed,
    grade,
    fetchedAt: now.toISOString(),
  };
}

/**
 * 获取指定坐标的天气数据
 *
 * 策略：先查缓存 → 未命中则模拟获取 → 写入缓存 → 返回
 * 缓存 TTL = 30 分钟
 *
 * @param {number} lng - 经度
 * @param {number} lat - 纬度
 * @returns {Promise<Object>} WeatherData
 */
async function getWeather(lng, lat) {
  const cacheKey = _getCacheKey(lng, lat);

  // 1. 查缓存
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // 2. 模拟获取
    const weatherData = await _fetchFromApi(lng, lat);

    // 3. 写缓存
    cache.set(cacheKey, weatherData);

    return weatherData;
  } catch (err) {
    // 4. 降级：再次尝试读缓存（可能是并发写入）
    const retry = cache.get(cacheKey);
    if (retry) {
      return retry;
    }
    // 5. 完全降级：返回默认天气
    return {
      condition: 'clear',
      temperature: 25,
      humidity: 50,
      windSpeed: 2,
      grade: 'good',
      fetchedAt: new Date().toISOString(),
    };
  }
}

/**
 * 清除天气缓存
 *
 * @param {number} lng - 经度
 * @param {number} lat - 纬度
 */
function clearCache(lng, lat) {
  const cacheKey = _getCacheKey(lng, lat);
  cache.del(cacheKey);
}

/**
 * 清除全部天气缓存
 */
function clearAllCache() {
  cache.flushAll();
}

module.exports = {
  getWeather,
  clearCache,
  clearAllCache,
};
