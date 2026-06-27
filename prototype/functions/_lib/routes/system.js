import { Hono } from 'hono';
import * as db from '../db.js';

const app = new Hono();

app.get('/health', (c) => {
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL } = c.get('llmConfig');
  return c.json({
    status: 'ok',
    llm: LLM_API_KEY ? 'configured' : 'not configured',
    model: LLM_MODEL,
    baseUrl: LLM_BASE_URL,
  });
});

app.get('/stats', async (c) => {
  return c.json(await db.getStats(c.env.DB));
});

app.get('/user', async (c) => {
  const user = await db.getUser(c.env.DB, c.get('userId'));
  return c.json(user);
});

app.post('/events', async (c) => {
  const { type, conversationId, data } = await c.req.json();
  if (!type) {
    return c.json({ error: '缺少事件类型' }, 400);
  }
  await db.recordEvent(c.env.DB, {
    userId: c.get('userId'),
    type,
    conversationId,
    data,
  });
  return c.json({ ok: true });
});

export default app;
