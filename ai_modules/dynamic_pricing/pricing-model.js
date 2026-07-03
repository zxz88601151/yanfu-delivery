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
 * 动态定价 5 因子乘法模型（纯函数）
 *
 * 综合浮动系数 = 1.0 × supply_demand_factor × weather_factor × time_factor
 *                  × distance_factor × density_factor
 *
 * @module ai_modules/dynamic_pricing/pricing-model
 */

/**
 * 计算运力供需因子
 *
 * ratio ≥ 2.0 → 0.90（运力充裕）
 * 1.0 ≤ ratio < 2.0 → 1.0 - (ratio - 1.0) * 0.1（线性过渡 1.0→0.90）
 * 0.5 ≤ ratio < 1.0 → 1.0 + (1.0 - ratio) * 0.6（线性过渡 1.0→1.30）
 * ratio < 0.5 → 1.50（严重紧张）
 *
 * @param {number} ratio - 供需比
 * @returns {number}
 */
function calcSupplyDemandFactor(ratio) {
  if (ratio >= 2.0) {
    return 0.90;
  }
  if (ratio >= 1.0) {
    return +(1.0 - (ratio - 1.0) * 0.1).toFixed(4);
  }
  if (ratio >= 0.5) {
    return +(1.0 + (1.0 - ratio) * 0.6).toFixed(4);
  }
  return 1.50;
}

/**
 * 计算天气因子
 *
 * @param {Object} weatherData - 天气数据
 * @param {string} weatherData.grade - 天气等级: good|mild|moderate|severe
 * @returns {number}
 */
function calcWeatherFactor(weatherData) {
  const grade = (weatherData && weatherData.grade) || 'good';

  const factorMap = {
    good: 1.0,
    mild: 1.08,
    moderate: 1.20,
    severe: 1.40,
  };

  return factorMap[grade] || 1.0;
}

/**
 * 计算时段因子
 * 根据当前时间匹配 timeFactorMap 中的时段
 *
 * @param {string|Date} time - 时间（Date 对象或 "HH:mm" 字符串）
 * @param {Object} timeFactorMap - 时段映射 { "00:00-06:00": 1.30, ... }
 * @returns {number}
 */
function calcTimeFactor(time, timeFactorMap) {
  let hour, minute;

  if (time instanceof Date) {
    hour = time.getHours();
    minute = time.getMinutes();
  } else if (typeof time === 'string') {
    const parts = time.split(':');
    hour = parseInt(parts[0], 10);
    minute = parseInt(parts[1], 10);
  } else {
    const now = new Date();
    hour = now.getHours();
    minute = now.getMinutes();
  }

  const currentMinutes = hour * 60 + minute;

  // 默认时段映射
  const map = timeFactorMap || {
    '00:00-06:00': 1.30,
    '06:00-09:00': 1.0,
    '09:00-11:00': 1.0,
    '11:00-14:00': 1.15,
    '14:00-17:00': 0.90,
    '17:00-21:00': 1.10,
    '21:00-24:00': 1.15,
  };

  for (const [range, factor] of Object.entries(map)) {
    const [start, end] = range.split('-');
    const startParts = start.split(':');
    const endParts = end.split(':');
    const startMinutes = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
    const endMinutes = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);

    // 处理跨天情况（如 21:00-06:00）
    if (endMinutes < startMinutes) {
      if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
        return factor;
      }
    } else {
      if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
        return factor;
      }
    }
  }

  return 1.0;
}

/**
 * 计算距离因子
 *
 * @param {number} distance - 距离（米）
 * @param {Array} distanceRanges - 距离区间配置
 * @returns {number}
 */
function calcDistanceFactor(distance, distanceRanges) {
  const ranges = distanceRanges || [
    { max: 1000, factor: 0.90 },
    { max: 3000, factor: [0.95, 1.0] },
    { max: 5000, factor: [1.0, 1.10] },
    { max: 10000, factor: [1.10, 1.25] },
    { max: 999999, factor: [1.25, 1.50] },
  ];

  for (const range of ranges) {
    if (distance <= range.max) {
      const factor = range.factor;
      if (Array.isArray(factor)) {
        // 取区间中值
        return +((factor[0] + factor[1]) / 2).toFixed(4);
      }
      return factor;
    }
  }

  return 1.25;
}

/**
 * 计算订单密度因子
 *
 * @param {number} density - 订单密度（单/平方公里）
 * @param {Array} densityRanges - 密度区间配置
 * @returns {number}
 */
function calcDensityFactor(density, densityRanges) {
  const ranges = densityRanges || [
    { max: 5, factor: [0.90, 0.95] },
    { max: 20, factor: 1.0 },
    { max: 50, factor: [1.05, 1.15] },
    { max: 999999, factor: [1.15, 1.25] },
  ];

  for (const range of ranges) {
    if (density <= range.max) {
      const factor = range.factor;
      if (Array.isArray(factor)) {
        return +((factor[0] + factor[1]) / 2).toFixed(4);
      }
      return factor;
    }
  }

  return 1.0;
}

/**
 * 应用浮动上下限约束
 *
 * 规则：
 * 1. 综合系数控制在 [compositeFactorMin, compositeFactorMax] 范围内
 * 2. 极端天气保护：当 weatherFactor >= weatherProtectionThreshold 时，启用天气保护上限
 *
 * @param {number} compositeFactor - 综合浮动系数（封顶前）
 * @param {number} weatherFactor - 天气因子
 * @param {Object} config - 配置对象
 * @param {number} config.compositeFactorMax - 综合系数上限
 * @param {number} config.compositeFactorMin - 综合系数下限
 * @param {number} config.weatherProtectionThreshold - 天气保护阈值
 * @returns {number} 封顶后系数
 */
function applyCap(compositeFactor, weatherFactor, config) {
  const maxFactor = config.compositeFactorMax || 1.50;
  const minFactor = config.compositeFactorMin || 0.85;
  const weatherThreshold = config.weatherProtectionThreshold || 1.30;

  // 极端天气保护：当天气因子 ≥ 阈值时，允许更高的上限
  let effectiveMax = maxFactor;
  if (weatherFactor >= weatherThreshold) {
    effectiveMax = (config.weatherProtectionCap || 8.0) / (config.baseFee || 5.0);
    effectiveMax = Math.max(effectiveMax, maxFactor);
  }

  let result = Math.min(compositeFactor, effectiveMax);
  result = Math.max(result, minFactor);

  return +result.toFixed(4);
}

/**
 * 生成用户端可读的涨价原因
 *
 * @param {Object} factors - 各因子值 { supplyDemand, weather, time, distance, density }
 * @param {number} supplyDemandRatio - 供需比
 * @param {Object} weatherData - 天气数据
 * @param {number} surgeAmount - 浮动金额
 * @returns {string}
 */
function generateSurgeReason(factors, supplyDemandRatio, weatherData, surgeAmount) {
  const reasons = [];

  // 运力原因
  if (factors.supplyDemand > 1.0) {
    reasons.push(`当前运力紧张（供需比${supplyDemandRatio.toFixed(1)}）`);
  } else if (factors.supplyDemand < 0.95) {
    reasons.push('当前运力充裕');
  }

  // 天气原因
  if (weatherData && weatherData.grade !== 'good') {
    const weatherLabels = {
      mild: '轻度天气',
      moderate: '中度天气',
      severe: '恶劣天气',
    };
    reasons.push(weatherLabels[weatherData.grade] || weatherData.condition || '');
  }

  // 时段原因
  const timeLabels = {
    '00:00-06:00': '凌晨时段',
    '11:00-14:00': '午间高峰',
    '17:00-21:00': '晚间高峰',
    '21:00-24:00': '夜宵时段',
  };

  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const cm = h * 60 + m;

  for (const [range, label] of Object.entries(timeLabels)) {
    const [s, e] = range.split('-');
    const sm = parseInt(s) * 60 + parseInt(s.split(':')[1] || '0');
    const em = parseInt(e) * 60 + parseInt(e.split(':')[1] || '0');
    if (cm >= sm && cm < em) {
      reasons.push(label);
      break;
    }
  }

  if (reasons.length === 0) {
    return '当前配送费基于标准价格';
  }

  const reasonStr = reasons.join('+');

  if (surgeAmount > 0) {
    return `${reasonStr}，配送费临时上浮${surgeAmount.toFixed(2)}元`;
  }
  if (surgeAmount < 0) {
    return `${reasonStr}，配送费临时下调${Math.abs(surgeAmount).toFixed(2)}元`;
  }
  return reasonStr;
}

/**
 * 5 因子综合定价计算（主入口）
 *
 * @param {number} supplyDemandRatio - 运力供需比
 * @param {Object} weatherData - 天气数据
 * @param {string|Date} time - 时间
 * @param {number} distance - 距离（米）
 * @param {number} density - 订单密度（单/平方公里）
 * @param {Object} config - 配置对象
 * @returns {Object} 计算结果
 */
function calculate(supplyDemandRatio, weatherData, time, distance, density, config) {
  const sdFactor = calcSupplyDemandFactor(supplyDemandRatio);
  const wFactor = calcWeatherFactor(weatherData);
  const tFactor = calcTimeFactor(time, config && config.timeFactorMap);
  const dFactor = calcDistanceFactor(distance, config && config.distanceRanges);
  const denFactor = calcDensityFactor(density, config && config.densityRanges);

  const composite = sdFactor * wFactor * tFactor * dFactor * denFactor;
  const capped = applyCap(composite, wFactor, config);

  const baseFee = (config && config.baseFee) || 5.00;
  const finalFee = Math.round(baseFee * capped * 100) / 100;
  const surgeAmount = Math.round((finalFee - baseFee) * 100) / 100;

  const surgeReason = generateSurgeReason(
    { supplyDemand: sdFactor, weather: wFactor, time: tFactor, distance: dFactor, density: denFactor },
    supplyDemandRatio,
    weatherData,
    surgeAmount,
  );

  return {
    factors: {
      supplyDemand: sdFactor,
      weather: wFactor,
      time: tFactor,
      distance: dFactor,
      density: denFactor,
    },
    compositeFactor: +composite.toFixed(4),
    cappedFactor: capped,
    finalFee,
    surgeAmount,
    surgeReason,
  };
}

module.exports = {
  calculate,
  calcSupplyDemandFactor,
  calcWeatherFactor,
  calcTimeFactor,
  calcDistanceFactor,
  calcDensityFactor,
  applyCap,
  generateSurgeReason,
};
