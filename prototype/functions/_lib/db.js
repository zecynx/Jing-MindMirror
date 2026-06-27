/**
 * D1 数据库封装
 */

export async function upsertUser(db, userId) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO users (id, created_at, last_active_at, conversation_count)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET last_active_at = excluded.last_active_at`
    )
    .bind(userId, now, now)
    .run();
  return getUser(db, userId);
}

export async function getUser(db, userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
}

export async function saveConversation(db, conversation) {
  const id = String(conversation.id || crypto.randomUUID());
  const now = new Date().toISOString();
  const createdAt = conversation.createdAt || now;
  const updatedAt = now;
  const annotations = JSON.stringify(conversation.annotations || []);
  const messages = JSON.stringify(conversation.messages || []);

  await db
    .prepare(
      `INSERT INTO conversations (
        id, user_id, title, type, status, confidence, hero_quote, essay,
        annotations, schema_version, stances, premortem_change, premortem_stay,
        blindspots, future_perspective, calibration_date, messages, total_turns,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        title = excluded.title,
        type = excluded.type,
        status = excluded.status,
        confidence = excluded.confidence,
        hero_quote = excluded.hero_quote,
        essay = excluded.essay,
        annotations = excluded.annotations,
        schema_version = excluded.schema_version,
        stances = excluded.stances,
        premortem_change = excluded.premortem_change,
        premortem_stay = excluded.premortem_stay,
        blindspots = excluded.blindspots,
        future_perspective = excluded.future_perspective,
        calibration_date = excluded.calibration_date,
        messages = excluded.messages,
        total_turns = excluded.total_turns,
        created_at = conversations.created_at,
        updated_at = excluded.updated_at`
    )
    .bind(
      id,
      conversation.userId,
      conversation.title || '',
      conversation.type || '',
      conversation.status || '',
      conversation.confidence ?? null,
      conversation.hero_quote || '',
      conversation.essay || '',
      annotations,
      conversation.schema_version || 'v2',
      conversation.stances || '',
      conversation.premortem_change || '',
      conversation.premortem_stay || '',
      conversation.blindspots || '',
      conversation.future_perspective || '',
      conversation.calibrationDate || null,
      messages,
      conversation.totalTurns || 0,
      createdAt,
      updatedAt
    )
    .run();

  return { ...conversation, id, createdAt, updatedAt };
}

export async function getConversationsByUser(db, userId) {
  const { results } = await db
    .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all();
  return results.map(rowToConversation);
}

export async function getConversation(db, id) {
  const row = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
  return row ? rowToConversation(row) : null;
}

export async function deleteConversation(db, id) {
  const result = await db.prepare('DELETE FROM conversations WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

export async function recordEvent(db, { userId, type, conversationId, data }) {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO events (id, user_id, type, conversation_id, data, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(id, userId, type, conversationId || null, JSON.stringify(data || {}), timestamp)
    .run();
  return true;
}

export async function queryEvents(db, { userId, type, since, limit = 1000 } = {}) {
  let sql = 'SELECT * FROM events WHERE 1=1';
  const params = [];
  if (userId) {
    sql += ' AND user_id = ?';
    params.push(userId);
  }
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  if (since) {
    sql += ' AND timestamp >= ?';
    params.push(since);
  }
  sql += ' ORDER BY timestamp ASC LIMIT ?';
  params.push(limit);
  const { results } = await db.prepare(sql).bind(...params).all();
  return results.map((r) => ({ ...r, data: JSON.parse(r.data || '{}') }));
}

export async function getStats(db) {
  const { totalUsers } = await db.prepare('SELECT COUNT(*) AS totalUsers FROM users').first();
  const { totalConversations } = await db
    .prepare('SELECT COUNT(*) AS totalConversations FROM conversations')
    .first();
  const { totalEvents } = await db.prepare('SELECT COUNT(*) AS totalEvents FROM events').first();
  const { completed } = await db
    .prepare("SELECT COUNT(*) AS completed FROM conversations WHERE status = 'completed'")
    .first();
  const avgRow = await db
    .prepare('SELECT AVG(confidence) AS avgConfidence FROM conversations WHERE confidence IS NOT NULL')
    .first();
  const { recentUsers } = await db
    .prepare("SELECT COUNT(*) AS recentUsers FROM users WHERE last_active_at >= datetime('now', '-7 days')")
    .first();

  return {
    totalUsers,
    totalConversations,
    totalEvents,
    completedConversations: completed,
    avgConfidence: avgRow.avgConfidence ? Number(avgRow.avgConfidence).toFixed(1) : '0.0',
    recentUsers,
  };
}

function rowToConversation(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    type: row.type,
    status: row.status,
    confidence: row.confidence,
    hero_quote: row.hero_quote,
    essay: row.essay,
    annotations: JSON.parse(row.annotations || '[]'),
    schema_version: row.schema_version,
    stances: row.stances,
    premortem_change: row.premortem_change,
    premortem_stay: row.premortem_stay,
    blindspots: row.blindspots,
    future_perspective: row.future_perspective,
    calibrationDate: row.calibration_date,
    messages: JSON.parse(row.messages || '[]'),
    totalTurns: row.total_turns,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
