import { createMiddleware } from 'hono/factory';
import { upsertUser } from './db.js';

export const requireUserId = createMiddleware(async (c, next) => {
  let userId = c.req.header('x-user-id');
  if (!userId) {
    try {
      const body = await c.req.json();
      userId = body?.userId;
    } catch {
      // 忽略非 JSON body
    }
  }
  if (!userId) {
    return c.json({ error: '缺少用户标识 (x-user-id)' }, 400);
  }
  await upsertUser(c.env.DB, userId);
  c.set('userId', userId);
  await next();
});
