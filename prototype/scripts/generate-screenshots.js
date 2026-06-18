const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'screenshots');

const SHOTS = [
  'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'
];

(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  const fileUrl = 'file://' + path.join(PUBLIC_DIR, 'screenshot-kit.html');
  await page.goto(fileUrl, { waitUntil: 'networkidle' });

  // 等待字体加载
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  // 渲染全部
  await page.selectOption('#viewSelect', 'all');
  await page.selectOption('#materialSelect', 'all');
  await page.waitForTimeout(800);

  // 进入生成模式：元素自然高度，方便 Playwright 截图
  await page.evaluate(() => document.body.classList.add('generate-mode'));
  await page.waitForTimeout(200);

  for (const shot of SHOTS) {
    for (const panel of ['qa-0', 'qa-1', 'snapshot']) {
      const innerId = `frame-${shot}-${panel}`;
      const selector = `#${innerId}`;
      const outPath = path.join(OUTPUT_DIR, `mindmirror-${shot}-${panel.replace('qa-', 'qa')}.png`);

      const el = await page.$(selector);
      if (!el) throw new Error('missing ' + selector);
      await el.screenshot({ path: outPath, type: 'png' });
      console.log(`✓ ${outPath}`);
    }
  }

  await browser.close();
  console.log(`\nAll screenshots saved to ${OUTPUT_DIR}`);
})();
