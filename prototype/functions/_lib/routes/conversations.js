import { Hono } from 'hono';
import * as db from '../db.js';

const app = new Hono();

app.post('/', async (c) => {
  const body = await c.req.json();
  const saved = await db.saveConversation(c.env.DB, { ...body, userId: c.get('userId') });
  return c.json(saved);
});

app.get('/', async (c) => {
  const conversations = await db.getConversationsByUser(c.env.DB, c.get('userId'));
  const lite = conversations.map((conv) => ({
    id: conv.id,
    title: conv.title,
    type: conv.type,
    status: conv.status,
    confidence: conv.confidence,
    phase: conv.phase,
    totalTurns: conv.totalTurns,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    calibrationDate: conv.calibrationDate,
  }));
  return c.json(lite);
});

app.get('/:id', async (c) => {
  const conv = await db.getConversation(c.env.DB, c.req.param('id'));
  if (!conv || conv.userId !== c.get('userId')) {
    return c.json({ error: '对话不存在' }, 404);
  }
  return c.json(conv);
});

app.delete('/:id', async (c) => {
  const conv = await db.getConversation(c.env.DB, c.req.param('id'));
  if (!conv || conv.userId !== c.get('userId')) {
    return c.json({ error: '对话不存在' }, 404);
  }
  await db.deleteConversation(c.env.DB, c.req.param('id'));
  return c.json({ ok: true });
});

export default app;
