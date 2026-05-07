/**
 * /api/conversations  — 对话 CRUD
 *  POST   /                创建/更新对话
 *  GET    /                列表(精简元数据)
 *  GET    /:id             单条详情
 *  DELETE /:id             删除
 */
const express = require('express');
const db = require('../db');
const requireUserId = require('../middleware/require-user');

const router = express.Router();

router.post('/', requireUserId, (req, res) => {
  const saved = db.saveConversation({ ...req.body, userId: req.userId });
  res.json(saved);
});

router.get('/', requireUserId, (req, res) => {
  const conversations = db.getConversationsByUser(req.userId);
  const lite = conversations.map(c => ({
    id: c.id,
    title: c.title,
    type: c.type,
    status: c.status,
    confidence: c.confidence,
    phase: c.phase,
    totalTurns: c.totalTurns,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    calibrationDate: c.calibrationDate,
  }));
  res.json(lite);
});

router.get('/:id', requireUserId, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || conv.userId !== req.userId) {
    return res.status(404).json({ error: '对话不存在' });
  }
  res.json(conv);
});

router.delete('/:id', requireUserId, (req, res) => {
  const conv = db.getConversation(req.params.id);
  if (!conv || conv.userId !== req.userId) {
    return res.status(404).json({ error: '对话不存在' });
  }
  db.deleteConversation(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
