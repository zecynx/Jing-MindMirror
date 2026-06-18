const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'screenshots');

const SHOTS = [
  'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10'
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

  for (const shot of SHOTS) {
    for (const panel of ['home', 'dialogue', 'snapshot']) {
      const innerId = `frame-${shot}-${panel}`;
      const selector = `#${innerId}`;
      const outPath = path.join(OUTPUT_DIR, `mindmirror-${shot}-${panel}.png`);

      // 使用 html2canvas 在浏览器内渲染完整内容，避免 frame 高度截断
      await page.evaluate(({ selector, outName }) => {
        return new Promise((resolve, reject) => {
          const inner = document.querySelector(selector);
          if (!inner) return reject(new Error('missing ' + selector));
          const frame = inner.closest('.shot-frame');
          const originalFrameHeight = frame.style.height;
          const originalInnerHeight = inner.style.height;
          const originalInnerOverflow = inner.style.overflow;
          frame.style.height = 'auto';
          inner.style.height = 'auto';
          inner.style.overflow = 'visible';

          if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(capture);
          } else {
            capture();
          }

          function capture() {
            html2canvas(inner, {
              backgroundColor: '#0b0b0d',
              scale: 2,
              useCORS: true,
              logging: false,
              windowWidth: inner.scrollWidth,
              windowHeight: inner.scrollHeight,
            }).then(canvas => {
              frame.style.height = originalFrameHeight;
              inner.style.height = originalInnerHeight;
              inner.style.overflow = originalInnerOverflow;
              window.__lastScreenshotDataUrl = canvas.toDataURL('image/png');
              window.__lastScreenshotName = outName;
              resolve();
            }).catch(err => {
              frame.style.height = originalFrameHeight;
              inner.style.height = originalInnerHeight;
              inner.style.overflow = originalInnerOverflow;
              reject(err);
            });
          }
        });
      }, { selector, outName: path.basename(outPath) });

      const dataUrl = await page.evaluate(() => window.__lastScreenshotDataUrl);
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(outPath, Buffer.from(base64, 'base64'));
      console.log(`✓ ${outPath}`);
    }
  }

  await browser.close();
  console.log(`\nAll screenshots saved to ${OUTPUT_DIR}`);
})();
