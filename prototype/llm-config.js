/**
 * LLM 配置 — 从环境变量读取
 * ⚠️ API Key 必须通过 .env 文件配置,禁止硬编码
 */
module.exports = {
  LLM_BASE_URL: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
  LLM_API_KEY: process.env.LLM_API_KEY || '',
  LLM_MODEL: process.env.LLM_MODEL || 'deepseek-chat',
};
