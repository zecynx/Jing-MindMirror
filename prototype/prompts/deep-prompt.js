/**
 * 深度模式 System Prompt 构建
 *  - 上下文富化:立场摘要 + 深度信号 + 动态策略
 *  - 困难/阶段开端时注入脚手架
 */
function detectRepetition(userMessages) {
  if (userMessages.length < 3) return false;
  const recent = userMessages.slice(-3);
  const words = recent.map(m => new Set(m.replace(/[,。?!、\s]/g, '').split('')));
  const overlap01 = [...words[0]].filter(c => words[1].has(c)).length / Math.max(words[0].size, 1);
  const overlap12 = [...words[1]].filter(c => words[2].has(c)).length / Math.max(words[1].size, 1);
  return overlap01 > 0.5 && overlap12 > 0.5;
}

function detectStuck(conversationHistory) {
  const userMsgs = conversationHistory.filter(m => m.role === 'user').map(m => m.content);
  if (userMsgs.length < 1) return false;
  const last = userMsgs[userMsgs.length - 1];
  const stuckWords = ['不知道', '没想过', '不清楚', '随便', '都行', '差不多', '没想好', '不知道怎么说', '不知道该怎么', '没想过这个', '没考虑过', '不知道啊', '没概念', '没想过这', '没想过要', '没想过会'];
  if (stuckWords.some(w => last.includes(w))) return true;
  if (last.length < 8) return true;
  if (userMsgs.length >= 3 && detectRepetition(userMsgs)) return true;
  return false;
}

function buildDeepSystemPrompt(phase, turnCount, conversationHistory, style) {
  return '';
}

module.exports = {
  buildDeepSystemPrompt,
};
