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
 * 地理工具（基于 @turf/turf）
 *
 * @module ai_modules/common/geo-utils
 */

const turf = require('@turf/turf');

/**
 * 计算两点之间的距离（米）
 *
 * @param {number} lat1 - 起点纬度
 * @param {number} lng1 - 起点经度
 * @param {number} lat2 - 终点纬度
 * @param {number} lng2 - 终点经度
 * @returns {number} 距离（米）
 */
function calcDistance(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) {
    return 0;
  }
  if (isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) {
    return 0;
  }
  try {
    const from = turf.point([lng1, lat1]);
    const to = turf.point([lng2, lat2]);
    const options = { units: 'meters' };
    return Math.round(turf.distance(from, to, options));
  } catch (err) {
    return 0;
  }
}

/**
 * 计算 GeoHash 编码
 *
 * @param {number} lat - 纬度
 * @param {number} lng - 经度
 * @param {number} [precision=7] - 精度（1~12，默认7约76m精度）
 * @returns {string} GeoHash 字符串
 */
function geoHashEncode(lat, lng, precision = 7) {
  // @turf/turf 6.x 不直接提供 geoHash，使用 turf 的 coordEach 方式
  // 此处使用简化的 Base32 GeoHash 实现
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let hash = '';
  let isEven = true;
  let bit = 0;
  let ch = 0;

  while (hash.length < precision) {
    if (isEven) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch |= (1 << (4 - bit));
        minLng = mid;
      } else {
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch |= (1 << (4 - bit));
        minLat = mid;
      } else {
        maxLat = mid;
      }
    }

    isEven = !isEven;
    if (bit < 4) {
      bit++;
    } else {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}

/**
 * 判断目标点是否在中心点指定半径范围内
 *
 * @param {{ lat: number, lng: number }} center - 中心点
 * @param {{ lat: number, lng: number }} target - 目标点
 * @param {number} radius - 半径（米）
 * @returns {boolean}
 */
function isWithinRadius(center, target, radius) {
  const distance = calcDistance(center.lat, center.lng, target.lat, target.lng);
  return distance <= radius;
}

/**
 * 计算多个点的中心点（几何中心）
 *
 * @param {Array<{ lat: number, lng: number }>} points - 点数组
 * @returns {{ lat: number, lng: number }|null}
 */
function calcCenter(points) {
  if (!points || points.length === 0) {
    return null;
  }

  const turfPoints = points.map((p) => turf.point([p.lng, p.lat]));
  const featureCollection = turf.featureCollection(turfPoints);
  const center = turf.center(featureCollection);

  return {
    lat: center.geometry.coordinates[1],
    lng: center.geometry.coordinates[0],
  };
}

module.exports = {
  calcDistance,
  geoHashEncode,
  isWithinRadius,
  calcCenter,
};
