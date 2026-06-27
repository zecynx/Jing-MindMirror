/**
 * LLM 配置 — 从 Cloudflare env 读取
 */
export function getLLMConfig(env) {
  return {
    LLM_BASE_URL: env.LLM_BASE_URL || 'https://api.deepseek.com',
    LLM_API_KEY: env.LLM_API_KEY || '',
    LLM_MODEL: env.LLM_MODEL || 'deepseek-chat',
  };
}
