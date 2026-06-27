import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { getLLMConfig } from '../_lib/llm-config.js';
import { requireUserId } from '../_lib/require-user.js';
import chatApp from '../_lib/routes/chat.js';
import conversationsApp from '../_lib/routes/conversations.js';
import systemApp from '../_lib/routes/system.js';

const app = new Hono({ strict: false }).basePath('/api');

app.use(async (c, next) => {
  c.set('llmConfig', getLLMConfig(c.env));
  await next();
});

app.use('/chat', requireUserId);
app.use('/snapshot', requireUserId);
app.use('/conversations/*', requireUserId);
app.use('/user', requireUserId);
app.use('/events', requireUserId);

app.route('/', chatApp);
app.route('/conversations', conversationsApp);
app.route('/', systemApp);

export const onRequest = handle(app);
