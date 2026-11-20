// Dependency-free app controller regression with synthetic browser APIs.
// The photo fixture suite is responsible for the real OpenCV measurements.
import assert from 'node:assert/strict';
class Element extends EventTarget {
  hidden = false;
  value = '';
  textContent = '';
  innerHTML = '';
  className = '';
  classList = { add() {}, remove() {}, toggle() {} };
  validity = { badInput: false };
  files = [];
  style = {};
  focus() {}
  setAttribute() {}
  toggleAttribute() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  getContext() { return { drawImage() {}, getImageData() { return {}; } }; }
}
const elements = new Map();
const get = (key) => {
  if (!elements.has(key)) elements.set(key, new Element());
  return elements.get(key);
};
const click = (key) => get(key).dispatchEvent(new Event('click'));
const field = get('#lineMm');
let releaseCamera, stopped = 0;
const mediaDevices = {
  getUserMedia: () => new Promise(resolve => { releaseCamera = resolve; }),
};
Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices } });
const sample = get('sample');
sample.dataset = { sample: 'unit-test.jpg' };
sample.textContent = 'Sample ring';
let releaseSample, releaseEngine, bitmapCall = 0;
globalThis.fetch = () => new Promise(resolve => { releaseSample = resolve; });
globalThis.createImageBitmap = () => { bitmapCall++; throw new Error('decoder failed'); };
globalThis.Image = class {
  set src(_) { queueMicrotask(() => this.onerror()); }
};
globalThis.document = Object.assign(new EventTarget(), {
  querySelector: get,
  querySelectorAll: (x) => x === '[data-sample]' ? [sample] : [],
  createElement: () => new Element(),
  head: { appendChild: element => { releaseEngine = element.onerror; } },
  body: new Element(),
});
globalThis.window = Object.assign(new EventTarget(), { scrollTo() {} });
await import('../../public/app.js');
const flush = () => new Promise(resolve => setImmediate(resolve));
const upload = () => {
  get('#file').files = [Object.assign(new Blob(['fixture']), { name: 'fixture.jpg' })];
  get('#file').dispatchEvent(new Event('change'));
};
field.value = '69';
field.dispatchEvent(new Event('input'));
upload();
await flush();
assert.equal(bitmapCall, 0);
assert.match(get('#lineMsg').textContent, /Correct the check line/);
click('sample');
releaseSample({ ok: true, blob: async () => new Blob(['fixture']) });
await flush();
assert.equal(bitmapCall, 1, 'invalid print scale never blocks sample decode');
assert.match(get('#result').innerHTML, /not a photo/);

click('sample'); // this older sample will fail only after the upload starts
const oldSample = releaseSample;
field.value = '';
field.dispatchEvent(new Event('input'));
upload();
await flush();
assert.match(get('#result').innerHTML, /not a photo/);
const latestError = get('#result').innerHTML;
oldSample({ ok: false });
await flush();
assert.equal(get('#result').innerHTML, latestError, 'late sample must not replace newer upload');

click('#liveBtn');
assert.equal(get('#live').hidden, false);
assert.equal(get('#liveShot').disabled, true);
click('#liveCancel');
releaseCamera({ getTracks: () => [{ stop: () => stopped++ }] });
await flush();
assert.equal(stopped, 1);
assert.equal(get('#live').hidden, true);
assert.equal(get('#liveVideo').srcObject, null);
field.value = '69';
field.dispatchEvent(new Event('input'));
const priorCam = releaseCamera;
click('#liveCardBtn');
click('#card-start');
assert.notEqual(get('#card-confirm').open, true, 'the paused card-camera entry cannot open its confirmation');
assert.equal(releaseCamera, priorCam, 'the paused card-camera entry cannot request a camera');
assert.equal(get('#live').hidden, true);
releaseEngine();
await flush();
console.log('PASS: invalid print scale isolates user photos, latest input wins, and a cancelled late camera stream is stopped.');
