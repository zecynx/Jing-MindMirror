/**
 * 质量守门 V3:从"审讯式 8 条" → "伙伴式 4 条柔规则"
 *
 * 4 条规则:
 *   1. 铁律:不给建议、不下结论
 *   2. 真模板句式(只剩 3 条最套路的)
 *   3. 空洞肯定(只剩 2 条最干瘪的)
 *   4. 必须有"引导"(疑问/邀请/留白)
 * 软性:鼓励引用用户原话(扣 5 分)
 *
 * 重试触发(由 chat.js 读 mustRetry):
 *   仅当 破铁律 或 (纯模板 AND 完全无引导) 时为 true
 *   ——score 仍计算供观察,但不再驱动重试
 *
 * 返回:{ passed, reasons, score, mustRetry }
 */

function responseQualityCheck(content, userLastMessage) {
  const reasons = [];
  let score = 100;
  let brokeIron = false;
  let brokeTemplate = false;
  let brokeNoGuide = false;

  // ── 规则1(铁律):建议/结论检测 ──
  const advicePatterns = [
    /你应该/g, /我建议/g, /最好/g, /推荐/g,
    /可以考虑/g, /建议你/g, /不妨试试/g, /你可以试着/g,
    /我认为你应该/g, /我的建议是/g,
  ];
  for (const pat of advicePatterns) {
    if (pat.test(content)) {
      reasons.push('包含建议性表达("你应该/我建议/最好/推荐"等),违反"永远不给建议"铁律');
      score -= 50;
      brokeIron = true;
      break;
    }
  }

  // ── 规则2:真模板句式(只剩 3 条最套路的) ──
  const templatePatterns = [
    /你有没有想过/g,
    /你是否考虑过/g,
    /我们来梳理一下/g,
  ];
  for (const pat of templatePatterns) {
    if (pat.test(content)) {
      reasons.push('使用了真模板句式("你有没有想过/你是否考虑过/我们来梳理一下"),套路感强');
      score -= 25;
      brokeTemplate = true;
      break;
    }
  }

  // ── 规则3:空洞肯定(只禁最干瘪的两句) ──
  const emptyPraisePatterns = [
    /你说得对/g,
    /我完全理解/g,
  ];
  for (const pat of emptyPraisePatterns) {
    if (pat.test(content)) {
      reasons.push('包含空洞肯定("你说得对""我完全理解"),改用具体的承接');
      score -= 20;
      break;
    }
  }

  // ── 规则4:必须有"引导"(疑问/邀请/留白) ──
  const hasQuestion = /[??]/.test(content);
  const hasInvitation = /(说说|聊聊|多讲|愿意|多说点|展开|具体|接着|继续|想想|再想|多说一点|跟我说|告诉我)/.test(content);
  const hasPause = /\.\.\.|……/.test(content);
  if (!hasQuestion && !hasInvitation && !hasPause) {
    reasons.push('回复中没有任何引导(疑问/邀请/留白),作为伙伴需要让对方继续往下说');
    score -= 30;
    brokeNoGuide = true;
  }

  // ── 软性:鼓励引用用户原话(扣少量分) ──
  if (userLastMessage && userLastMessage.length > 5) {
    const hasQuote = /[""「」『』]/.test(content);
    if (!hasQuote) {
      score -= 5;
    }
  }

  score = Math.max(0, score);
  const passed = score >= 60;
  const mustRetry = brokeIron || (brokeTemplate && brokeNoGuide);

  return { passed, reasons, score, mustRetry };
}

module.exports = {
  responseQualityCheck,
};
