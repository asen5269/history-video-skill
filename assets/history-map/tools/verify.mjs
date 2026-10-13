import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch {
  const bundled = process.env.PLAYWRIGHT_MODULE_PATH ?? join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  playwright = require(bundled);
}
const url = process.argv[2] ?? 'http://127.0.0.1:8846/';
const output = process.argv[3];
if (!output) throw new Error('usage: node verify.mjs <preview-url> <output-directory> [--render]');
mkdirSync(output, { recursive: true });
const platformBrowsers = {
  win32: [join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
};
const candidates = [playwright.chromium.executablePath(), ...(platformBrowsers[process.platform] ?? [])];
const executablePath = candidates.find(existsSync);
const browser = await playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1600, height: 1150 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function frame(time) {
  const png = await page.evaluate(t => { window.mapDemo.seek(t); return document.getElementById('map').toDataURL('image/png').split(',')[1]; }, time);
  return Buffer.from(png, 'base64');
}
try {
  await page.goto(url); await page.waitForFunction(() => window.mapDemo?.renderer?.loaded, { timeout: 45000 });
  const results = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(i => window.mapDemo.showScene(i), i);
    const eight = await frame(8); await frame(12); const back = await frame(8);
    assert.equal(hash(eight), hash(back), '向前再拖回同一时间必须得到同一帧');
    assert.notEqual(hash(eight), hash(await frame(12)), '镜头应随时间改变');
    writeFileSync(join(output, ['01-overview.png', '02-focus.png', '03-factions.png'][i]), eight);
    results.push({ scene: i, deterministic: true, width: 1920, height: 1080 });
  }
  await page.getByRole('tab', { name: '局部高亮', exact: true }).click();
  await page.waitForFunction(() => window.mapDemo.renderer.scene.id === 'focus' && !document.getElementById('play').disabled);
  await page.getByRole('button', { name: '播放动画', exact: true }).click();
  const before = await page.evaluate(() => window.mapDemo.renderer.time);
  await page.waitForFunction(t => window.mapDemo.renderer.time > t + 0.1, before);
  await page.getByRole('button', { name: '暂停动画', exact: true }).click();
  await page.locator('#seek').evaluate(node => node.value = '6'); await page.locator('#seek').dispatchEvent('input');
  assert.ok(Math.abs(await page.evaluate(() => window.mapDemo.renderer.time) - 6) < 1e-6);
  await page.getByRole('button', { name: '回到开头', exact: true }).click();
  assert.equal(await page.evaluate(() => window.mapDemo.renderer.time), 0);
  await page.getByRole('button', { name: '编辑故事', exact: true }).click();
  const modified = await page.evaluate(() => ({ ...window.mapDemo.scenes[1], title: '自定义故事', flags: [{ ...window.mapDemo.scenes[1].flags[0], name: '人物旗帜' }] }));
  await page.locator('#scene-json').fill(JSON.stringify(modified));
  await page.getByRole('button', { name: '应用场景', exact: true }).click();
  await page.waitForFunction(() => window.mapDemo.renderer.scene.title === '自定义故事');
  assert.equal(await page.evaluate(() => window.mapDemo.renderer.scene.flags[0].name), '人物旗帜');
  await page.locator('#scene-json').fill('{invalid'); await page.getByRole('button', { name: '应用场景', exact: true }).click();
  assert.ok(await page.locator('#editor-error').textContent());
  await page.evaluate(() => window.mapDemo.showScene(0)); await frame(6);
  await page.getByRole('button', { name: '编辑故事', exact: true }).click();
  await page.screenshot({ path: join(output, 'preview-page.png'), fullPage: true });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '保存当前帧', exact: true }).click();
  const file = await download; await file.saveAs(join(output, 'downloaded-frame.png'));
  assert.equal(errors.length, 0, errors.join('\n'));
  if (process.argv.includes('--render')) {
    const frames = join(output, 'frames'); mkdirSync(frames, { recursive: true });
    await page.evaluate(() => window.mapDemo.showScene(2));
    for (let frameNumber = 0; frameNumber < 180; frameNumber++) {
      writeFileSync(join(frames, String(frameNumber).padStart(4, '0') + '.png'), await frame(frameNumber / 30));
      if (frameNumber % 30 === 0) console.log('render', frameNumber, '/ 180');
    }
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '30', '-i', join(frames, '%04d.png'), '-c:v', 'libx264', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'map-demo.mp4')], { stdio: 'inherit' });
    assert.equal(r.status, 0);
  }
  writeFileSync(join(output, 'verification.json'), JSON.stringify({ scenes: results, playPauseSeek: true, editScene: true, downloadFrame: true, browserErrors: errors }, null, 2));
  console.log('PASS 3 scenes; deterministic seek; playback; JSON editing; PNG export; no browser errors');
} finally { await browser.close(); }
