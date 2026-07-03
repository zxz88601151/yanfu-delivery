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
 * 协同配送控制器
 *
 * @module ai_modules/relay_delivery/controller
 */

const { success, fail, paginate } = require('../common/response');
const service = require('./service');

/**
 * POST /api/v2/ai/relay_delivery/split
 * 拆单评估并创建接力配送方案
 */
async function split(req, res) {
  try {
    const result = await service.split({
      order_id: req.body.order_id,
      merchant_location: req.body.merchant_location,
      customer_location: req.body.customer_location,
      total_distance: req.body.total_distance,
      estimated_time: req.body.estimated_time,
      total_fee: req.body.total_fee,
      order_amount: req.body.order_amount,
      tags: req.body.tags || [],
      no_relay: req.body.no_relay || false,
    });

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
 * GET /api/v2/ai/relay_delivery/orders/:id
 * 获取接力配送详情
 */
async function getOrder(req, res) {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId) || orderId < 1) {
      return res.json(fail(5005, '接力订单不存在'));
    }

    const result = await service.getOrder(orderId);
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
 * PUT /api/v2/ai/relay_delivery/handoffs/:id/arrive
 * 骑手到达接力点标记
 */
async function arrive(req, res) {
  try {
    const handoffId = parseInt(req.params.id, 10);
    if (isNaN(handoffId) || handoffId < 1) {
      return res.json(fail(5003, '交接记录不存在'));
    }

    const result = await service.arrive(handoffId, req.body);
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
 * PUT /api/v2/ai/relay_delivery/handoffs/:id/handoff
 * 接力交接确认
 */
async function handoff(req, res) {
  try {
    const handoffId = parseInt(req.params.id, 10);
    if (isNaN(handoffId) || handoffId < 1) {
      return res.json(fail(5003, '交接记录不存在'));
    }

    const result = await service.handoff(handoffId, req.body);
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
 * GET /api/v2/ai/relay_delivery/progress/:order_id
 * 用户端进度查询
 */
async function getProgress(req, res) {
  try {
    const orderId = parseInt(req.params.order_id, 10);
    if (isNaN(orderId) || orderId < 1) {
      return res.json(fail(5005, '接力订单不存在'));
    }

    const result = await service.getProgress(orderId);

    if (!result) {
      return res.json(success({
        is_relay: false,
        message: '该订单非接力配送订单',
      }));
    }

    res.json(success(result));
  } catch (err) {
    res.json(fail(9001, '服务器内部错误'));
  }
}

/**
 * GET /api/v2/ai/relay_delivery/stations
 * 获取可用接力点列表
 */
async function listStations(req, res) {
  try {
    const filters = {
      type: req.query.type !== undefined ? parseInt(req.query.type, 10) : undefined,
      status: req.query.status !== undefined ? parseInt(req.query.status, 10) : undefined,
      page: parseInt(req.query.page, 10) || 1,
      size: parseInt(req.query.size, 10) || 20,
    };

    const result = await service.listStations(filters);
    res.json(success(result));
  } catch (err) {
    res.json(fail(9001, '服务器内部错误'));
  }
}

/**
 * POST /api/v2/ai/relay_delivery/stations
 * 新增接力点
 */
async function createStation(req, res) {
  try {
    const result = await service.createStation(req.body);
    res.json(success({
      id: result.id,
      message: '接力点创建成功',
      station: {
        id: result.id,
        name: result.name,
        status: result.status,
      },
    }, '接力点创建成功'));
  } catch (err) {
    res.json(fail(9001, '服务器内部错误'));
  }
}

module.exports = {
  split,
  getOrder,
  arrive,
  handoff,
  getProgress,
  listStations,
  createStation,
};
