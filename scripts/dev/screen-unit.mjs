// Dependency-free screen state and geometry regression; browser smoke is test:screen.
import assert from 'node:assert/strict';

class Element extends EventTarget {
  style = {};
  dataset = {};
  value = '';
  textContent = '';
  hidden = false;
  clientWidth = 340;
  getBoundingClientRect() { return { width: parseFloat(this.style.width) }; }
}
const ids = ['screen', 'cal-stage', 'cal-line', 'cal-width', 'screen-diameter',
  'screen-circle', 'screen-fit', 'cal-confirm', 'ring-confirm', 'cal-status', 'screen-reading'];
const dom = Object.fromEntries(ids.map(id => [id, new Element()]));
const click = id => dom[id].dispatchEvent(new Event('click'));
const input = (id, value) => { dom[id].value = String(value); dom[id].dispatchEvent(new Event('input')); };
dom['cal-width'].value = '320';
dom['screen-fit'].hidden = true;
globalThis.document = { getElementById: id => dom[id], querySelectorAll: () => [] };
const visualViewport = Object.assign(new EventTarget(), { scale: 1 });
globalThis.window = Object.assign(new EventTarget(), {
  innerWidth: 390, devicePixelRatio: 2, visualViewport, screen: {},
});
const { CARD_WIDTH_MM, circlePixels } = await import('../../public/screen-sizing.js');
assert.equal(CARD_WIDTH_MM, 85.60);
assert.equal(circlePixels(20, 428), 100);
assert.equal(dom['cal-width'].max, 328);
assert.equal(dom['screen-fit'].hidden, true);
input('cal-width', 323);
assert.equal(dom['cal-line'].style.width, '323px');
click('cal-confirm');
assert.equal(dom['screen-fit'].hidden, false);
assert.equal(dom['screen-reading'].textContent, '');
input('screen-diameter', 20);
assert.equal(dom['screen-circle'].style.width, circlePixels(20, 323) + 'px');
assert.equal(dom['screen-circle'].style.height, dom['screen-circle'].style.width);
click('ring-confirm');
assert.match(dom['screen-reading'].textContent, /20\.0 mm · ISO 63 · US\/Canada ≈ 10½/);
visualViewport.scale = 1.2;
visualViewport.dispatchEvent(new Event('resize'));
assert.equal(dom['screen-fit'].hidden, true);
assert.equal(dom['screen-reading'].textContent, '');
assert.match(dom['cal-status'].textContent, /screen or zoom changed/);
click('ring-confirm');
assert.equal(dom['screen-reading'].textContent, '');
click('cal-confirm');
window.innerWidth = 390;
window.devicePixelRatio = 3;
window.dispatchEvent(new Event('resize'));
assert.equal(dom['screen-fit'].hidden, true);
click('cal-confirm');
input('cal-width', 324);
assert.equal(dom['screen-fit'].hidden, true);
assert.match(dom['cal-status'].textContent, /Line changed/);
dom['cal-stage'].clientWidth = 80;
click('cal-confirm');
assert.equal(dom['screen-fit'].hidden, true);
assert.match(dom['cal-status'].textContent, /too narrow/);
console.log('PASS: calibration math and UI state, resize/zoom/DPR invalidation, no stale result and narrow-screen guard.');
