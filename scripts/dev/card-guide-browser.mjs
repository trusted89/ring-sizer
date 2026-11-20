import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';


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
  const phone = await browser.newPage({viewport:{width:390,height:844}});
  await phone.addInitScript(() => {
    window.cameraRequests = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value: async opts => {
      if (opts.audio !== false || opts.video.facingMode.exact !== 'environment') throw Error('unexpected camera constraints');
      window.cameraRequests++;
      const c=document.createElement('canvas'); c.width=720;c.height=1280;
      const ctx=c.getContext('2d');ctx.fillRect(0,0,c.width,c.height);
      setInterval(()=>ctx.fillRect(0,0,c.width,c.height),40);
      return c.captureStream(25);
    }});
  });
  await phone.goto(url+'/#screen');
  await phone.locator('#liveCardBtn').click();
  assert.equal(await phone.evaluate(()=>window.cameraRequests),0,'opening disclosure does not start the camera');
  await phone.locator('#card-start').click();
  const guide=phone.locator('#liveCardGuide');
  await guide.waitFor({state:'visible'});
  await phone.waitForFunction(()=>document.querySelector('#liveMsg').textContent.includes('No full card outline'));
  async function bounds() {
    return await phone.evaluate(()=> {
      const stage=document.querySelector('#liveVideo').getBoundingClientRect(), s=document.querySelector('#liveCardGuide');
      const {a,d,e,f}=s.getScreenCTM();
      const w=720,h=1280,k=Math.min(stage.width/w,stage.height/h);
      const ring = document.querySelector('#liveGuideRing').getBoundingClientRect(), card=document.querySelector('#liveGuideCard').getBoundingClientRect();
      return {a,d,e,f,k,x:stage.x+(stage.width-w*k)/2,y:stage.y+(stage.height-h*k)/2,above:ring.bottom<card.top,horizontal:card.width>card.height};
    });
  }
  for (const dims of [{width:390,height:844},{width:844,height:390}]) {
    await phone.setViewportSize(dims);
    const b=await bounds();
    assert.ok(b.above&&b.horizontal);
    assert.ok(Math.abs(b.a-b.k)<.002 && Math.abs(b.d-b.k)<.002);
    assert.ok(Math.abs(b.e-b.x)<.5 && Math.abs(b.f-b.y)<.5);
    assert.equal(await guide.getAttribute('viewBox'),'0 0 720 1280');
    assert.equal(await phone.locator('#liveCardQuad').getAttribute('points'),'');
    assert.equal(await phone.locator('#liveShot').isDisabled(),true);
  }
  await phone.locator('#liveCancel').click();
  assert.equal(await guide.isVisible(),false);
  console.log('PASS card guides stay positioned inside the native video rectangle while detection is red and after viewport rotation; camera starts only after confirmation.');
} finally {
  if(browser)await browser.close();
  server.close();
}
