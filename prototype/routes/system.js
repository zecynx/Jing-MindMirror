/**
 * 系统/通用路由
 *  GET  /api/health   — 健康检查
 *  GET  /api/stats    — 全局统计(无 userId 限制)
 *  GET  /api/user     — 当前用户信息
 *  POST /api/events   — 埋点事件
 */
const express = require('express');
const db = require('../db');
const requireUserId = require('../middleware/require-user');
const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = require('../llm-config');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    llm: LLM_API_KEY ? 'configured' : 'not configured',
    model: LLM_MODEL,
    baseUrl: LLM_BASE_URL,
  });
});

router.get('/stats', (req, res) => {
  res.json(db.getStats());
});

router.get('/user', requireUserId, (req, res) => {
  const user = db.getUser(req.userId);
  res.json(user);
});

router.post('/events', requireUserId, (req, res) => {
  const { type, conversationId, data } = req.body;
  if (!type) {
    return res.status(400).json({ error: '缺少事件类型' });
  }
  db.recordEvent({
    userId: req.userId,
    type,
    conversationId,
    data,
  });
  res.json({ ok: true });
});

module.exports = router;
