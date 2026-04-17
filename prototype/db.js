/**
 * 思维棱镜 - JSON 文件数据库模块
 * 零依赖，基于 Node.js fs 模块
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============ 通用读写 ============

function readJSON(filePath, defaultVal = []) {
  try {
    if (!fs.existsSync(filePath)) return defaultVal;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error(`读取 ${filePath} 失败:`, e.message);
    return defaultVal;
  }
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error(`写入 ${filePath} 失败:`, e.message);
    return false;
  }
}

// ============ 用户 ============

/**
 * 创建或获取用户
 * @param {string} userId - 前端生成的匿名用户ID
 * @returns {object} 用户对象
 */
function upsertUser(userId) {
  const users = readJSON(USERS_FILE, {});
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      conversationCount: 0,
    };
  } else {
    users[userId].lastActiveAt = new Date().toISOString();
  }
  writeJSON(USERS_FILE, users);
  return users[userId];
}

function getUser(userId) {
  const users = readJSON(USERS_FILE, {});
  return users[userId] || null;
}

// ============ 对话 ============

/**
 * 保存完整对话（含快照）
 */
function saveConversation(conversation) {
  const conversations = readJSON(CONVERSATIONS_FILE, []);

  // 生成 ID
  if (!conversation.id) {
    conversation.id = crypto.randomUUID();
  }

  // 检查是否已存在（更新场景）
  const idx = conversations.findIndex(c => c.id === conversation.id);
  if (idx >= 0) {
    conversations[idx] = { ...conversations[idx], ...conversation, updatedAt: new Date().toISOString() };
  } else {
    conversation.createdAt = conversation.createdAt || new Date().toISOString();
    conversation.updatedAt = new Date().toISOString();
    conversations.unshift(conversation); // 最新的在前
  }

  writeJSON(CONVERSATIONS_FILE, conversations);
  return conversation;
}

/**
 * 获取用户的对话列表
 */
function getConversationsByUser(userId) {
  const conversations = readJSON(CONVERSATIONS_FILE, []);
  return conversations.filter(c => c.userId === userId);
}

/**
 * 获取单个对话
 */
function getConversation(conversationId) {
  const conversations = readJSON(CONVERSATIONS_FILE, []);
  return conversations.find(c => c.id === conversationId) || null;
}

/**
 * 删除对话
 */
function deleteConversation(conversationId) {
  const conversations = readJSON(CONVERSATIONS_FILE, []);
  const filtered = conversations.filter(c => c.id !== conversationId);
  writeJSON(CONVERSATIONS_FILE, filtered);
  return filtered.length < conversations.length;
}

// ============ 埋点事件 ============

/**
 * 记录埋点事件
 * @param {object} event
 * @param {string} event.userId
 * @param {string} event.type - 事件类型: page_view|conversation_start|message_send|phase_advance|snapshot_generate|conversation_complete|feedback
 * @param {string} [event.conversationId]
 * @param {object} [event.data] - 事件附加数据
 */
function recordEvent(event) {
  const events = readJSON(EVENTS_FILE, []);
  events.push({
    ...event,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  });
  writeJSON(EVENTS_FILE, events);
  return true;
}

/**
 * 查询事件（按用户/类型/时间范围）
 */
function queryEvents({ userId, type, since, limit = 1000 } = {}) {
  let events = readJSON(EVENTS_FILE, []);

  if (userId) events = events.filter(e => e.userId === userId);
  if (type) events = events.filter(e => e.type === type);
  if (since) events = events.filter(e => e.timestamp >= since);

  return events.slice(-limit);
}

// ============ 统计 ============

function getStats() {
  const users = readJSON(USERS_FILE, {});
  const conversations = readJSON(CONVERSATIONS_FILE, []);
  const events = readJSON(EVENTS_FILE, []);

  const userList = Object.values(users);

  return {
    totalUsers: userList.length,
    totalConversations: conversations.length,
    totalEvents: events.length,
    completedConversations: conversations.filter(c => c.status === 'completed').length,
    avgConfidence: conversations.filter(c => c.confidence)
      .reduce((sum, c, _, arr) => sum + c.confidence / arr.length, 0).toFixed(1),
    recentUsers: userList.filter(u => {
      const diff = Date.now() - new Date(u.lastActiveAt).getTime();
      return diff < 7 * 24 * 60 * 60 * 1000; // 7天内活跃
    }).length,
  };
}

module.exports = {
  upsertUser,
  getUser,
  saveConversation,
  getConversationsByUser,
  getConversation,
  deleteConversation,
  recordEvent,
  queryEvents,
  getStats,
};
