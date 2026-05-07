/**
 * 中间件:用户识别
 * 从 x-user-id 头或 body.userId 读取匿名用户 ID,缺失则 400
 */
const db = require('../db');

function requireUserId(req, res, next) {
  const userId = req.headers['x-user-id'] || req.body?.userId;
  if (!userId) {
    return res.status(400).json({ error: '缺少用户标识 (x-user-id)' });
  }
  db.upsertUser(userId);
  req.userId = userId;
  next();
}

module.exports = requireUserId;
