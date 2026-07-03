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

/**
 * 盐阜配送 - 需求预测定时调度器
 * 每日全量预测 + 每小时增量更新
 */
const predictService = require('./ai_predict_service');
const { PREDICT_CONFIG } = require('../config/ai_dispatch');

class PredictScheduler {
  constructor() {
    this.config = PREDICT_CONFIG;
    this.dailyTimer = null;
    this.hourlyTimer = null;
    this.running = false;
  }

  /**
   * 启动调度器
   */
  start() {
    if (this.running) return;
    this.running = true;

    console.log('[PREDICT-SCHEDULER] 启动预测调度器...');

    // 立即执行一次全量预测
    this.runDailyPrediction();

    // 每日定时预测（默认凌晨3点）
    this.scheduleNextDaily();
    
    // 每小时增量更新
    this.scheduleNextHourly();

    console.log('[PREDICT-SCHEDULER] 调度器已启动 (每日3:00全量 + 每小时增量)');
  }

  /**
   * 停止调度器
   */
  stop() {
    this.running = false;
    if (this.dailyTimer) {
      clearTimeout(this.dailyTimer);
      this.dailyTimer = null;
    }
    if (this.hourlyTimer) {
      clearTimeout(this.hourlyTimer);
      this.hourlyTimer = null;
    }
    console.log('[PREDICT-SCHEDULER] 调度器已停止');
  }

  /**
   * 执行每日全量预测
   */
  async runDailyPrediction() {
    console.log('[PREDICT-SCHEDULER] 开始每日全量预测...');
    const regions = predictService.getAllRegions();

    for (const region of regions) {
      try {
        // 24小时预测
        const result = await predictService.predictOrders(region, 24);
        console.log(`[PREDICT-SCHEDULER] ${region} 预测完成: ${result.predictions.length}个时段`);

        // 运力建议
        for (const pred of result.predictions) {
          const hour = new Date(pred.hour).getHours();
          const advice = await predictService.calculateCapacityGap(region, pred.predicted_orders, hour);
          if (advice) {
            await predictService.saveCapacityAdvice(advice);
          }
        }

        // 准确度评估（昨日）
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().split('T')[0];
        await predictService.evaluateAccuracy(region, dateStr);

      } catch (e) {
        console.error(`[PREDICT-SCHEDULER] ${region} 预测失败:`, e.message);
      }
    }
    console.log('[PREDICT-SCHEDULER] 每日全量预测完成');
  }

  /**
   * 执行每小时增量更新
   */
  async runHourlyPrediction() {
    console.log('[PREDICT-SCHEDULER] 开始小时级增量更新...');
    const regions = predictService.getAllRegions();

    for (const region of regions) {
      try {
        // 仅预测最近2小时
        const result = await predictService.predictOrders(region, 2, { historyDays: 2 });
        console.log(`[PREDICT-SCHEDULER] ${region} 增量更新完成`);
      } catch (e) {
        console.error(`[PREDICT-SCHEDULER] ${region} 增量更新失败:`, e.message);
      }
    }
  }

  /**
   * 安排下一次每日调度
   */
  scheduleNextDaily() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(this.config.DAILY_PREDICT_HOUR, 0, 0, 0);

    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }

    const delay = target.getTime() - now.getTime();
    console.log(`[PREDICT-SCHEDULER] 下次每日预测: ${target.toISOString()} (${Math.round(delay / 3600000)}小时后)`);

    this.dailyTimer = setTimeout(() => {
      this.runDailyPrediction();
      if (this.running) this.scheduleNextDaily();
    }, delay);
  }

  /**
   * 安排下一次小时级调度
   */
  scheduleNextHourly() {
    const now = new Date();
    const delay = 3600000 - (now.getMinutes() * 60000 + now.getSeconds() * 1000 + now.getMilliseconds());

    this.hourlyTimer = setTimeout(() => {
      this.runHourlyPrediction();
      if (this.running) this.scheduleNextHourly();
    }, delay);
  }

  /**
   * 获取调度器状态
   */
  getStatus() {
    return {
      running: this.running,
      daily_hour: this.config.DAILY_PREDICT_HOUR,
      history_days: this.config.HISTORY_DAYS,
      regions: predictService.getAllRegions(),
    };
  }
}

module.exports = new PredictScheduler();
