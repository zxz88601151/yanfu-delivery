/**
 * 盐阜配送 - AI风控核心服务
 * 规则引擎 + 黑白名单管理 + 评分计算 + 自动拉黑
 */
const { pool } = require('../config/database');
const { RISK_CONFIG } = require('../config/ai_dispatch');

class RiskControlService {
  constructor() {
    this.config = RISK_CONFIG;
  }

  /**
   * 风控检查主入口
   * @param {string} targetType - 'rider'|'merchant'|'user'
   * @param {number} targetId
   * @param {string} action - 触发动作
   * @param {object} context - 请求上下文
   * @returns {Promise<{decision: string, score: number, trace_id: string, reason?: string}>}
   */
  async check(targetType, targetId, action, context = {}) {
    const traceId = `RISK-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    try {
      // 1. 白名单检查 — 白名单直接放行
      const whitelisted = await this.isWhitelisted(targetType, targetId);
      if (whitelisted) {
        await this.logRisk(traceId, targetType, targetId, action, 0, 'pass', [], context);
        return { decision: 'pass', score: 0, trace_id: traceId, reason: '白名单用户' };
      }

      // 2. 黑名单检查
      const blacklisted = await this.getBlacklistScore(targetType, targetId);
      
      // 3. 规则匹配
      const rules = await this.getActiveRules();
      const matchedRules = [];
      let maxRuleScore = 0;
      
      for (const rule of rules) {
        const matchResult = await this.matchRule(rule, targetType, targetId, action, context);
        if (matchResult.matched) {
          matchedRules.push({ id: rule.id, name: rule.name, score: rule.score });
          if (rule.score > maxRuleScore) maxRuleScore = rule.score;
        }
      }

      // 4. 综合评分
      const ruleScore = maxRuleScore;
      const blacklistScore = blacklisted.score;
      const totalScore = Math.round(ruleScore * this.config.WEIGHT_RULE + blacklistScore * this.config.WEIGHT_BLACKLIST);

      // 5. 决策
      const decision = totalScore >= this.config.THRESHOLD_BLOCK ? 'block'
        : totalScore >= this.config.THRESHOLD_REVIEW ? 'review'
        : 'pass';

      // 6. 记录日志
      await this.logRisk(traceId, targetType, targetId, action, totalScore, decision, matchedRules, context);

      // 7. 自动拉黑（连续高风险）
      if (decision === 'block') {
        await this.incrementRiskCount(targetType, targetId);
      } else {
        await this.resetRiskCount(targetType, targetId);
      }

      return {
        decision,
        score: totalScore,
        trace_id: traceId,
        reason: decision === 'block' ? '触发风控拦截' : decision === 'review' ? '需人工审核' : undefined,
        matchedRules,
      };
    } catch (error) {
      console.error(`[${traceId}] 风控检查异常:`, error.message);
      if (this.config.FAIL_OPEN) {
        return { decision: 'pass', score: 0, trace_id: traceId, reason: '风控异常-放行' };
      }
      return { decision: 'block', score: 999, trace_id: traceId, reason: '风控异常-拦截' };
    }
  }

  // ==================== 规则管理 ====================

  async getActiveRules() {
    const [rows] = await pool.query(
      'SELECT * FROM ai_risk_rules WHERE status = ? ORDER BY priority DESC',
      ['active']
    );
    return rows;
  }

  async createRule(ruleData) {
    const { name, rule_type, rule_config, score, priority, description } = ruleData;
    const [result] = await pool.query(
      'INSERT INTO ai_risk_rules (name, rule_type, rule_config, score, priority, description) VALUES (?, ?, ?, ?, ?, ?)',
      [name, rule_type, JSON.stringify(rule_config), score || 0, priority || 0, description || null]
    );
    return result.insertId;
  }

  async updateRule(id, ruleData) {
    const fields = [];
    const values = [];
    for (const key of ['name', 'rule_type', 'rule_config', 'score', 'priority', 'status', 'description']) {
      if (ruleData[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(key === 'rule_config' ? JSON.stringify(ruleData[key]) : ruleData[key]);
      }
    }
    if (fields.length === 0) return false;
    values.push(id);
    await pool.query(`UPDATE ai_risk_rules SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
  }

  async deleteRule(id) {
    await pool.query('DELETE FROM ai_risk_rules WHERE id = ?', [id]);
  }

  async getRules(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const [rows] = await pool.query(
      'SELECT * FROM ai_risk_rules ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );
    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM ai_risk_rules');
    return { list: rows, total: countResult[0].total, page, page_size: pageSize };
  }

  // ==================== 规则匹配 ====================

  async matchRule(rule, targetType, targetId, action, context) {
    try {
      const config = typeof rule.rule_config === 'string' ? JSON.parse(rule.rule_config) : rule.rule_config;
      switch (rule.rule_type) {
        case 'keyword':
          return this.matchKeywordRule(config, context);
        case 'frequency':
          return this.matchFrequencyRule(config, targetType, targetId, action);
        case 'amount':
          return this.matchAmountRule(config, context);
        case 'behavior':
          return this.matchBehaviorRule(config, targetType, targetId, action, context);
        case 'custom':
          return { matched: false };
        default:
          return { matched: false };
      }
    } catch {
      return { matched: false };
    }
  }

  async matchKeywordRule(config, context) {
    if (!config.keywords || !Array.isArray(config.keywords)) return { matched: false };
    const text = JSON.stringify(context).toLowerCase();
    for (const kw of config.keywords) {
      if (text.includes(kw.toLowerCase())) {
        return { matched: true, detail: `匹配关键词: ${kw}` };
      }
    }
    return { matched: false };
  }

  async matchFrequencyRule(config, targetType, targetId, action) {
    const windowMinutes = config.window_minutes || this.config.FREQUENCY_WINDOW_MINUTES;
    const maxCount = config.max_count || this.config.FREQUENCY_MAX_COUNT;
    const [rows] = await pool.query(
      `SELECT COUNT(*) as cnt FROM ai_risk_logs 
       WHERE target_type = ? AND target_id = ? AND action = ? 
       AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [targetType, targetId, action, windowMinutes]
    );
    if (rows[0].cnt >= maxCount) {
      return { matched: true, detail: `${windowMinutes}分钟内请求${rows[0].cnt}次，超过阈值${maxCount}` };
    }
    return { matched: false };
  }

  async matchAmountRule(config, context) {
    const amount = context.amount || 0;
    const maxAmount = config.max_amount || this.config.AMOUNT_SINGLE_MAX;
    if (amount > maxAmount) {
      return { matched: true, detail: `金额${amount}超过限制${maxAmount}` };
    }
    return { matched: false };
  }

  async matchBehaviorRule(config, targetType, targetId, action, context) {
    if (config.type === 'same_ip_rapid_order') {
      const ip = context.ip || context.req_ip;
      if (!ip) return { matched: false };
      const [rows] = await pool.query(
        `SELECT COUNT(*) as cnt FROM ai_risk_logs 
         WHERE JSON_EXTRACT(context, '$.ip') = ? 
         AND created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)`,
        [ip]
      );
      if (rows[0].cnt >= 3) {
        return { matched: true, detail: `同一IP(${ip})1分钟内下单${rows[0].cnt}次` };
      }
    }
    if (config.type === 'geo_anomaly') {
      // 地理位置异常检测（P2占位）
      return { matched: false };
    }
    return { matched: false };
  }

  // ==================== 黑白名单 ====================

  async isWhitelisted(targetType, targetId) {
    const [rows] = await pool.query(
      'SELECT id FROM blacklist WHERE blocked_type = ? AND blocked_id = ? AND reason = ?',
      [targetType, targetId, 'whitelist']
    );
    return rows.length > 0;
  }

  async getBlacklistScore(targetType, targetId) {
    const [rows] = await pool.query(
      "SELECT id, reason, created_at FROM blacklist WHERE blocked_type = ? AND blocked_id = ? AND reason != 'whitelist' AND (blocked_phone IS NULL OR blocked_phone != 'whitelist')",
      [targetType, targetId]
    );
    if (rows.length === 0) return { score: 0, items: [] };
    const baseScore = Math.min(rows.length * 30, 90);
    return { score: baseScore, items: rows };
  }

  async addToBlacklist(blockedType, blockedId, blockedName, blockedPhone, reason, blockerType) {
    const [existing] = await pool.query(
      'SELECT id FROM blacklist WHERE blocked_type = ? AND blocked_id = ?',
      [blockedType, blockedId]
    );
    if (existing.length > 0) return existing[0].id;
    const [result] = await pool.query(
      'INSERT INTO blacklist (blocked_type, blocked_id, blocked_name, blocked_phone, reason, blocker_type) VALUES (?, ?, ?, ?, ?, ?)',
      [blockedType, blockedId, blockedName || null, blockedPhone || null, reason || 'auto', blockerType || 'system']
    );
    return result.insertId;
  }

  async removeFromBlacklist(blockedType, blockedId) {
    await pool.query('DELETE FROM blacklist WHERE blocked_type = ? AND blocked_id = ?', [blockedType, blockedId]);
  }

  async getBlacklist(params = {}) {
    let sql = 'SELECT b.*, ' +
      'CASE WHEN b.blocked_type = ? THEN (SELECT name FROM riders WHERE id = b.blocked_id) ' +
      'WHEN b.blocked_type = ? THEN (SELECT name FROM merchants WHERE id = b.blocked_id) ' +
      'WHEN b.blocked_type = ? THEN (SELECT name FROM users WHERE id = b.blocked_id) END as target_name ' +
      'FROM blacklist b WHERE 1=1';
    const values = ['rider', 'merchant', 'user'];

    if (params.blocked_type) {
      sql += ' AND b.blocked_type = ?';
      values.push(params.blocked_type);
    }
    if (params.keyword) {
      sql += ' AND (b.blocked_name LIKE ? OR b.blocked_phone LIKE ?)';
      values.push(`%${params.keyword}%`, `%${params.keyword}%`);
    }

    sql += ' ORDER BY b.created_at DESC';

    const page = params.page || 1;
    const pageSize = params.page_size || 20;
    const offset = (page - 1) * pageSize;

    const countResult = await pool.query(
      sql.replace('SELECT b.*, ', 'SELECT COUNT(*) as total '),
      values
    );

    sql += ' LIMIT ? OFFSET ?';
    values.push(pageSize, offset);
    const [rows] = await pool.query(sql, values);

    return { list: rows, total: countResult[0][0]?.total || 0, page, page_size: pageSize };
  }

  async getBlacklistQuota() {
    const [rows] = await pool.query(
      "SELECT blocked_type, COUNT(*) as count FROM blacklist GROUP BY blocked_type"
    );
    return rows;
  }

  // ==================== 风险计数 ====================

  async incrementRiskCount(targetType, targetId) {
    const [existing] = await pool.query(
      `SELECT id, count FROM risk_events WHERE type = ? AND target_id = ? AND target_type = ? AND DATE(created_at) = CURDATE()`,
      ['auto_blacklist', targetId, targetType]
    );

    if (existing.length > 0) {
      const newCount = existing[0].count + 1;
      await pool.query('UPDATE risk_events SET count = ? WHERE id = ?', [newCount, existing[0].id]);
      if (newCount >= this.config.AUTO_BLACKLIST_COUNT) {
        await this.addToBlacklist(targetType, targetId, null, null, `连续${newCount}次高风险自动拉黑`, 'system');
        await pool.query('UPDATE risk_events SET status = ? WHERE id = ?', ['handled', existing[0].id]);
      }
    } else {
      await pool.query(
        'INSERT INTO risk_events (type, status, action, target_id, target_type, note) VALUES (?, ?, ?, ?, ?, ?)',
        ['auto_blacklist', 'pending', 'block', targetId, targetType, '高风险拦截计数']
      );
    }
  }

  async resetRiskCount(targetType, targetId) {
    // 非高风险时不累计
  }

  // ==================== 日志 ====================

  async logRisk(traceId, targetType, targetId, action, score, decision, matchedRules, context) {
    try {
      await pool.query(
        'INSERT INTO ai_risk_logs (trace_id, target_type, target_id, action, risk_score, decision, matched_rules, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [traceId, targetType, targetId, action, score, decision, JSON.stringify(matchedRules), JSON.stringify(context)]
      );
    } catch (e) {
      console.error('[RISK] 日志写入失败:', e.message);
    }
  }

  async getRiskLogs(params = {}) {
    let sql = 'SELECT * FROM ai_risk_logs WHERE 1=1';
    const values = [];

    if (params.target_type) { sql += ' AND target_type = ?'; values.push(params.target_type); }
    if (params.target_id) { sql += ' AND target_id = ?'; values.push(Number(params.target_id)); }
    if (params.decision) { sql += ' AND decision = ?'; values.push(params.decision); }

    sql += ' ORDER BY created_at DESC';

    const page = params.page || 1;
    const pageSize = params.page_size || 20;
    const offset = (page - 1) * pageSize;

    const [countResult] = await pool.query(
      sql.replace('SELECT *', 'SELECT COUNT(*) as total'), values
    );
    sql += ' LIMIT ? OFFSET ?';
    values.push(pageSize, offset);
    const [rows] = await pool.query(sql, values);

    return { list: rows, total: countResult[0].total, page, page_size: pageSize };
  }
}

// 导出单例
module.exports = new RiskControlService();
