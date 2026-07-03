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
 * 动态定价控制器
 *
 * @module ai_modules/dynamic_pricing/controller
 */

const { success, fail, paginate } = require('../common/response');
const service = require('./service');

/**
 * POST /api/v2/ai/dynamic_pricing/estimate
 * 估算配送费
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleEstimate(req, res) {
  try {
    const { user_id, merchant_lng, merchant_lat, delivery_lng, delivery_lat, district_id } = req.body;

    const result = await service.estimateFee(
      user_id,
      merchant_lng,
      merchant_lat,
      delivery_lng,
      delivery_lat,
      district_id,
    );

    res.json(success(result, 'success'));
  } catch (err) {
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

/**
 * GET /api/v2/ai/dynamic_pricing/zone
 * 获取区域定价系数列表
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleZone(req, res) {
  try {
    let districtIds = null;
    if (req.query.district_ids) {
      districtIds = req.query.district_ids
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !isNaN(id) && id > 0);
    }

    const zones = await service.getZoneFactors(districtIds);

    res.json(success({
      zones,
      cached_at: new Date().toISOString(),
    }));
  } catch (err) {
    res.json(fail(9001, '服务器内部错误'));
  }
}

/**
 * GET /api/v2/ai/dynamic_pricing/config
 * 获取定价配置
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleGetConfig(req, res) {
  try {
    const configData = await service.getConfig();
    res.json(success(configData));
  } catch (err) {
    res.json(fail(9001, '服务器内部错误'));
  }
}

/**
 * PUT /api/v2/ai/dynamic_pricing/config
 * 更新定价配置
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleUpdateConfig(req, res) {
  try {
    const { configs } = req.body;
    const updatedKeys = await service.updateConfig(configs);
    res.json(success({ updated_keys: updatedKeys }, '配置更新成功'));
  } catch (err) {
    res.json(fail(9001, '服务器内部错误'));
  }
}

/**
 * GET /api/v2/ai/dynamic_pricing/logs
 * 获取定价日志
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleLogs(req, res) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const size = parseInt(req.query.size, 10) || 20;
    const filters = {
      district_id: req.query.district_id ? parseInt(req.query.district_id, 10) : undefined,
      user_id: req.query.user_id ? parseInt(req.query.user_id, 10) : undefined,
      start_date: req.query.start_date,
      end_date: req.query.end_date,
    };

    const result = await service.getLogs(page, size, filters);
    res.json(paginate(result.total, result.page, result.size, result.items));
  } catch (err) {
    res.json(fail(9001, '服务器内部错误'));
  }
}

/**
 * GET /api/v2/ai/dynamic_pricing/report
 * 获取价格影响分析报表
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleReport(req, res) {
  try {
    const { reportBuilder } = require('./report-builder');
    const { dimension, start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.json(fail(2001, 'start_date 和 end_date 是必填参数'));
    }

    const report = await reportBuilder.getReport(
      dimension || 'district',
      start_date,
      end_date,
    );

    // 支持 CSV 导出
    if (req.query.export === 'csv') {
      const csvContent = await reportBuilder.exportCSV(report);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="pricing_report_${start_date}_${end_date}.csv"`);
      return res.send(csvContent);
    }

    res.json(success(report));
  } catch (err) {
    if (err.code) {
      res.json(fail(err.code, err.message));
    } else {
      res.json(fail(9001, '服务器内部错误'));
    }
  }
}

module.exports = {
  handleEstimate,
  handleZone,
  handleGetConfig,
  handleUpdateConfig,
  handleLogs,
  handleReport,
};
