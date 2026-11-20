// Dependency-free screen state and geometry regression; browser smoke is test:screen.
import assert from 'node:assert/strict';
class Element extends EventTarget {
  style = { setProperty(key, value) { this[key] = value; } };
  max = 26;
  classList = new Set();
  dataset = {};
  value = '';
  textContent = '';
  hidden = false;
  clientWidth = 360;
  open = false;
  disabled = false;
  constructor() { super(); this.classList.remove = this.classList.delete.bind(this.classList); }
  getBoundingClientRect() { return { width: parseFloat(this.style.width) }; }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
}
const ids = ['screen', 'cal-dialog', 'ring-dialog', 'ring-stage', 'ring-space-note', 'ring-open', 'ring-exit', 'screen-last-reading', 'cal-stage', 'cal-line', 'cal-card-shape', 'cal-open', 'cal-cancel', 'cal-guide-note',
  'screen-diameter', 'ring-fit-title', 'screen-circle', 'screen-fit', 'cal-confirm', 'ring-confirm', 'cal-status', 'screen-reading'];
const storage = new Map();
globalThis.requestAnimationFrame = fn => fn();
const make = async (token, scale = 1, dpr = 2, blocked = false) => {
  const dom = Object.fromEntries(ids.map(id => [id, new Element()]));
  const click = id => dom[id].dispatchEvent(new Event('click'));
  const input = (id, value) => { dom[id].value = String(value); dom[id].dispatchEvent(new Event('input')); };
  dom['screen-fit'].hidden = true;
  const classes = new Set();
  const refs = ['53.98', '85.6'].map(value => Object.assign(new Element(), { value }));
  const minus = Object.assign(new Element(), { dataset: { adjust: '-1' } });
  globalThis.document = {
    getElementById: id => dom[id],
    querySelectorAll: s => s === '[data-adjust]' ? [minus] : s === '[name=cal-reference]' ? refs : [],
    documentElement: { classList: { add: x => classes.add(x), remove: x => classes.delete(x) } },
  };
  const visualViewport = Object.assign(new EventTarget(), { scale });
  globalThis.window = Object.assign(new EventTarget(), {
    innerWidth: 390, devicePixelRatio: dpr, visualViewport, screen: { width: 390, height: 844 },
    localStorage: { getItem: k => { if (blocked) throw Error(); return storage.get(k); },
      setItem: (k, v) => { if (blocked) throw Error(); storage.set(k, v); } },
  });
  const mod = await import('../../public/screen-sizing.js?' + token);
  return { dom, click, input, visualViewport, classes, minus, refs, ...mod };
};
const t = await make('initial');
const { dom, click, input, visualViewport, classes, minus, refs, CARD_WIDTH_MM, CARD_SHORT_MM, START_LINE_PX, circlePixels, CALIBRATION_KEY } = t;
assert.equal(CARD_WIDTH_MM, 85.60);
assert.equal(START_LINE_PX, 324);
assert.equal(circlePixels(20, 428), 100);
assert.equal(circlePixels(20, CARD_SHORT_MM * 5, CARD_SHORT_MM), 100);
assert.equal(dom['screen-fit'].hidden, true);
click('cal-confirm');
assert.equal(dom['screen-fit'].hidden, true, 'no result before opening and confirming');
click('cal-open');
assert.ok(classes.has('calibration-open'));
const wheel = new Event('wheel', { cancelable: true });
dom['cal-stage'].dispatchEvent(wheel);
assert.equal(wheel.defaultPrevented, true);
const touch = new Event('touchmove', { cancelable: true });
dom['cal-stage'].dispatchEvent(touch);
assert.equal(touch.defaultPrevented, true);
assert.equal(dom['cal-line'].style.width, '204px');
assert.equal(dom['cal-card-shape'].style.width, '204px');
assert.ok(parseFloat(dom['cal-card-shape'].style.height) > 204);
assert.ok(dom['cal-card-shape'].classList.has('cal-cue-intro'));
assert.equal(refs[0].checked, true);
refs[1].checked = true; refs[1].dispatchEvent(new Event('change'));
assert.equal(dom['cal-line'].style.width, '324px');
assert.equal(dom['cal-card-shape'].style.width, '324px');
assert.ok(parseFloat(dom['cal-card-shape'].style.height) < 324);
minus.dispatchEvent(new Event('click'));
assert.equal(dom['cal-line'].style.width, '323px');
const right = Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowRight', shiftKey: true });
dom['cal-dialog'].dispatchEvent(right);
assert.equal(right.defaultPrevented, true);
assert.equal(dom['cal-line'].style.width, '333px');
click('cal-confirm');
assert.ok(classes.has('calibration-open'));
assert.equal(dom['ring-dialog'].open, true);
assert.ok(!dom['cal-card-shape'].classList.has('cal-cue-intro'));
assert.equal(JSON.parse(storage.get(CALIBRATION_KEY)).at(-1).referenceMm, CARD_WIDTH_MM);
assert.equal(dom['screen-fit'].hidden, false);
assert.equal(dom['ring-fit-title'].focused, true);
assert.equal(dom['ring-fit-title'].scrolled, undefined);
const ringTouch = new Event('touchmove', { cancelable: true });
dom['ring-stage'].dispatchEvent(ringTouch);
assert.equal(ringTouch.defaultPrevented, true);
const pinch = Object.assign(new Event('touchmove', { cancelable: true }), { touches: [1, 2] });
dom['ring-stage'].dispatchEvent(pinch);
assert.equal(pinch.defaultPrevented, false);
const ringWheel = new Event('wheel', { cancelable: true });
dom['ring-stage'].dispatchEvent(ringWheel);
assert.equal(ringWheel.defaultPrevented, true);
input('screen-diameter', 20);
assert.equal(dom['screen-circle'].style.width, circlePixels(20, 333) + 'px');
const reservedHeight = dom['ring-stage'].style['--ring-maximum-px'];
input('screen-diameter', 26);
assert.equal(dom['ring-stage'].style['--ring-maximum-px'], reservedHeight);
dom['ring-stage'].clientWidth = 80;
input('screen-diameter', 26);
assert.equal(dom['ring-confirm'].disabled, true);
assert.equal(dom['screen-circle'].hidden, true);
dom['ring-stage'].clientWidth = 360;
input('screen-diameter', 20);
assert.equal(dom['ring-confirm'].disabled, false);
click('ring-confirm');
assert.match(dom['screen-reading'].textContent, /20\.0 mm · ISO 63/);
assert.equal(dom['ring-exit'].textContent, 'Done');
click('ring-exit');
assert.ok(!classes.has('calibration-open'));
assert.equal(dom['screen-last-reading'].textContent, dom['screen-reading'].textContent);
click('cal-open');
assert.ok(!dom['cal-card-shape'].classList.has('cal-cue-intro'));
click('cal-cancel');
click('ring-open');
assert.ok(dom['ring-dialog'].open);
visualViewport.scale = 1.2;
visualViewport.dispatchEvent(new Event('resize'));
assert.equal(dom['screen-fit'].hidden, true);
assert.equal(dom['ring-dialog'].open, false);
assert.ok(!classes.has('calibration-open'));
assert.equal(dom['screen-reading'].textContent, '');
assert.match(dom['cal-status'].textContent, /screen or zoom changed/);
const confirmed = JSON.parse(storage.get(CALIBRATION_KEY)).at(-1);
const restored = await make('restored');
assert.equal(restored.dom['screen-fit'].hidden, false);
assert.equal(restored.dom['ring-dialog'].open, false);
assert.equal(restored.dom['ring-fit-title'].focused, undefined);
assert.equal(restored.dom['ring-fit-title'].scrolled, undefined);
assert.match(restored.dom['cal-status'].textContent, /Saved calibration restored.*switching displays/);
assert.equal(restored.dom['screen-circle'].style.width, circlePixels(17.5, 333) + 'px');
window.innerWidth = 500;
window.dispatchEvent(new Event('resize'));
assert.equal(restored.dom['screen-fit'].hidden, false, 'window width alone does not change physical scale');
window.screen.width = 844;
window.screen.height = 390;
window.dispatchEvent(new Event('resize'));
assert.equal(restored.dom['screen-fit'].hidden, true);
restored.click('cal-open');
restored.click('cal-confirm'); // second saved geometry, preserves the first
assert.equal(JSON.parse(storage.get(CALIBRATION_KEY)).length, 2);
window.screen.width = 390;
window.screen.height = 844;
window.dispatchEvent(new Event('resize'));
assert.match(restored.dom['cal-status'].textContent, /Saved calibration restored/);
assert.equal(restored.dom['screen-circle'].style.width, circlePixels(17.5, 333) + 'px');
const changed = await make('different-display', 1, 3);
assert.equal(changed.dom['screen-fit'].hidden, true);
changed.dom['cal-stage'].clientWidth = 80;
changed.click('cal-open');
assert.equal(changed.dom['cal-confirm'].disabled, true);
changed.click('cal-confirm');
assert.equal(changed.dom['screen-fit'].hidden, true);
changed.click('cal-cancel');
assert.ok(!changed.classes.has('calibration-open'));
storage.set(CALIBRATION_KEY, JSON.stringify({ ...confirmed, referenceMm: 60 }));
const badReference = await make('invalid-reference');
assert.equal(badReference.dom['screen-fit'].hidden, true);
storage.set(CALIBRATION_KEY, '{malformed');
const malformed = await make('malformed');
assert.equal(malformed.dom['screen-fit'].hidden, true);
const blocked = await make('blocked', 1, 2, true);
assert.equal(blocked.dom['screen-fit'].hidden, true);
blocked.click('cal-open');
blocked.click('cal-confirm');
assert.equal(blocked.dom['screen-fit'].hidden, false);
window.screen.width = 844;
window.dispatchEvent(new Event('resize'));
assert.equal(blocked.dom['screen-fit'].hidden, true);
blocked.click('cal-open');
window.screen.width = 390;
window.dispatchEvent(new Event('resize'));
assert.equal(blocked.dom['screen-fit'].hidden, true, 'do not restore over open calibration');
blocked.click('cal-cancel');
assert.equal(blocked.dom['screen-fit'].hidden, false, 'restores after closing without persistent storage');
console.log('PASS: calibrated sizing, coarse/fine and keyboard, targeted scroll lock, safe persistence, zoom/DPR resets and narrow-screen guard.');
