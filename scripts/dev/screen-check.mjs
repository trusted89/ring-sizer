import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { CARD_WIDTH_MM, circlePixels } from '../../public/screen-sizing.js';

assert.equal(CARD_WIDTH_MM, 85.60);
assert.equal(circlePixels(20, 428), 100);

const files = new URL('../../public/', import.meta.url);
const mime = { js: 'text/javascript', css: 'text/css', jpg: 'image/jpeg', html: 'text/html' };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname.replace(/^\/+/, '') || 'index.html';
    const contents = await readFile(new URL(pathname, files));
    res.writeHead(200, { 'Content-Type': mime[pathname.split('.').pop()] || 'application/octet-stream' });
    res.end(contents);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const runtimeErrors = [];
  phone.on('pageerror', error => runtimeErrors.push(error.message));
  // Test screen mode even with the photo engine unavailable.
  await phone.route('**/vendor/opencv.js', route => route.abort());
  await phone.goto(url);
  assert.equal(await phone.locator('#screen-fit').isVisible(), false);
  const calibration = phone.locator('#cal-width');
  assert.ok(Number(await calibration.getAttribute('max')) >= 323);
  await calibration.fill('323');
  const line = await phone.locator('#cal-line').boundingBox();
  assert.equal(line.width, 323);
  await phone.getByRole('button', { name: 'My card edges line up' }).click();
  assert.equal(await phone.locator('#screen-fit').isVisible(), true);
  await phone.locator('#screen-diameter').fill('20');
  const circle = await phone.locator('#screen-circle').boundingBox();
  assert.ok(Math.abs(circle.width - circlePixels(20, 323)) < .02);
  assert.equal(circle.width, circle.height);
  await phone.getByRole('button', { name: 'The circle fits' }).click();
  assert.match(await phone.locator('#screen-reading').textContent(), /20\.0 mm · ISO 63/);
  await phone.getByRole('button', { name: 'Make ring circle larger' }).click();
  assert.equal(await phone.locator('#screen-reading').textContent(), '');
  assert.equal(await phone.locator('#screen-diameter').inputValue(), '20.1');
  await phone.setViewportSize({ width: 820, height: 390 });
  await phone.locator('#screen-fit').waitFor({ state: 'hidden' });
  assert.match(await phone.locator('#cal-status').textContent(), /Match your card again/);
  await phone.getByRole('button', { name: 'My card edges line up' }).click();
  await phone.getByRole('button', { name: 'Shorten calibration line' }).click();
  assert.equal(await phone.locator('#screen-fit').isVisible(), false);
  assert.deepEqual(runtimeErrors, []);

  const photo = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await photo.goto(url);
  await photo.getByRole('link', { name: 'Try a sample photo' }).click();
  await photo.getByRole('button', { name: 'Measure sample ring' }).click();
  await photo.waitForFunction(() => window.__lastResult?.status === 'ok', null, { timeout: 30000 });
  assert.ok(Math.abs(await photo.evaluate(() => window.__lastResult.diameterMm) - 18.80) < .15);
  assert.equal(await photo.locator('#screen').isVisible(), false);
  await photo.getByRole('button', { name: 'Start over' }).click();
  assert.equal(await photo.locator('#screen').isVisible(), true);
  console.log('PASS: calibration geometry, match/size, nudge, viewport reset, recalibration and no-print sample photo.');
} finally {
  if (browser) await browser.close();
  server.close();
}
