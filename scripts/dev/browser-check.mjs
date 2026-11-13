// Developer aid: drives the page in headless Chrome at phone size and saves screenshots.
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(base);
await page.waitForFunction(() => document.querySelector('#engine').textContent.includes('ready'), null, { timeout: 60000 });
console.log(await page.textContent('#engine'));
await page.screenshot({ path: '/tmp/shot-home.png', fullPage: true });
const waitResult = () => page.waitForFunction(() => document.querySelector('#result .checks'), null, { timeout: 60000 });
// 1. upload a real file through the file input (same path as a phone photo)
await page.setInputFiles('#file', 'test-set/synthetic/synthetic-03-wide-band-h6-offaxis.jpg');
await waitResult();
console.log('upload ->', await page.evaluate(() => JSON.stringify({ s: window.__lastResult.status, d: window.__lastResult.diameterMm, u: window.__lastResult.uncertaintyMm })));
console.log(await page.innerText('#result .meter'));
await page.locator('#result').screenshot({ path: '/tmp/shot-ok.png' });
// 2. ambiguity -> choose
await page.setInputFiles('#file', 'test-set/synthetic/synthetic-06-two-rings.jpg');
await page.waitForSelector('[data-choose]');
await page.locator('#result').screenshot({ path: '/tmp/shot-choose.png' });
await page.click('[data-choose="1"]');
await page.waitForFunction(() => window.__lastResult && window.__lastResult.status === 'ok');
console.log('choose ring 2 ->', await page.evaluate(() => window.__lastResult.diameterMm.toFixed(2)));
// 3. unsupported -> retake
await page.setInputFiles('#file', 'test-set/synthetic/synthetic-08-out-of-focus.jpg');
await page.waitForFunction(() => window.__lastResult && window.__lastResult.status === 'retake');
console.log('blur ->', await page.innerText('#result .verdict'));
await page.locator('#result').screenshot({ path: '/tmp/shot-retake.png' });
// 4. sample button + not-an-image
await page.click('[data-back]'); await page.click('[data-sample*="steep"]');
await page.waitForFunction(() => window.__lastResult && window.__lastResult.reasons[0]?.code === 'PERSPECTIVE');
console.log('sample steep ->', await page.innerText('#result .verdict h3'));
await page.setInputFiles('#file', 'package.json');
await page.waitForSelector('#result .verdict:has-text("wrong")');
console.log('non-image ->', await page.innerText('#result .verdict p'));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
