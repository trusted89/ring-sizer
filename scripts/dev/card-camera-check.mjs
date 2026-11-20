import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { CARD_LONG_MM, CARD_SHORT_MM, detectCard, measureCardRing } from '../../public/card-camera.js';
const require=createRequire(import.meta.url);let cv=require('@techstark/opencv-js');if(cv instanceof Promise)cv=await cv;else if(!cv.Mat)await new Promise(resolve=>{cv.onRuntimeInitialized=resolve});
const W=1280,H=960;
const subdivide=(p)=>p.flatMap((a,i)=>{const b=p[(i+1)%p.length],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/1.5));return Array.from({length:n},(_,j)=>[a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);});
const path=(p,f)=>subdivide(p).map(([a,b],i)=>`${i?'L':'M'}${f(a,b).join(',')}`).join(' ')+' Z';
function polygonRect(x,y,w,h,r=0){
  if(!r)return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
  return [[x+w-r,y+r,-90],[x+w-r,y+h-r,0],[x+r,y+h-r,90],[x+r,y+r,180]].flatMap(([u,v,delta])=>
    Array.from({length:11},(_,i)=>{const a=(delta+i*9)*Math.PI/180;return [u+r*Math.cos(a),v+r*Math.sin(a)];}));
}
function round(x,y,rx,ry){return [...Array(180)].map((_,i)=>{const t=Math.PI*i/90;return [x+rx*Math.cos(t),y+ry*Math.sin(t)];})}
const opts=[
  {name:'level and flat',truth:17.6},
  {name:'card and ring rotated',truth:20,angle:23,pitch:3,roll:-5},
  {name:'near overhead photographed from 18 cm',truth:16.4,pitch:7,roll:4},
  {name:'abstract center print with light wood-like grain and rotated card',truth:18.3,angle:14,pitch:5,print:true,grain:true},
  {name:'bright center print covers most of the card face',truth:19.1,print:true,grain:true,densePrint:true},
  {name:'bright ink compromises part of one edge',code:'CARD_EDGE_UNCLEAR',print:true,marginPrint:true,grain:true},
  {name:'card with a large bent or occluded corner',code:'CARD_EDGE_UNCLEAR|NO_CARD|CARD_GEOMETRY',damaged:true,grain:true},
  {name:'card rotated near vertical with ring at another angle',truth:18,angle:90,pitch:0,roll:0},
  {name:'matte red card on a pale table',truth:18.5,color:'#cf2528',angle:12},
  {name:'matte green card on pale table',truth:16.9,color:'#14964e',angle:-14,pitch:3},
  {name:'light matte card and bright ring on dark surface',truth:19.5,color:'#e7dada',bg:'#343434',ringColor:'#d9d9d9',angle:14,pitch:3},
  {name:'different hues but matching luminance',color:'#b40000',bg:'#005d00',code:'NO_CARD'},
  {name:'one missing edge middle with both ends clear',truth:18.1,bridge:true,expectBridge:true},
  {name:'weak edge missing one endpoint',bridge:true,missingEnd:true,code:'NO_CARD|CARD_EDGE_UNCLEAR|CARD_GEOMETRY'},
  {name:'two visible ends on different lines',bridge:true,offsetEnd:true,code:'NO_CARD|CARD_EDGE_UNCLEAR|CARD_GEOMETRY'},
  {name:'two weak edge middles cannot supply a reference',bridge:true,twoWeak:true,code:'NO_CARD|CARD_EDGE_UNCLEAR|CARD_GEOMETRY'},
  {name:'card observed alone',code:'RING_NOT_CLEAR',noRing:true},
  {name:'ring without card',code:'NO_CARD',noCard:true},
  {name:'square wrong aspect',code:'NO_CARD',cardWidth:54},
  {name:'card clipped by frame',code:'NO_CARD',cardX:-119},
  {name:'wrong edge-striped card',code:'CARD_EDGE_UNCLEAR',pattern:true},
  {name:'low card and background contrast',code:'NO_CARD',color:'#d9d9d9'},
  {name:'ring overlaps card',code:'RING_NOT_CLEAR|NO_CARD',ringX:8},
  {name:'multiple plausible cards',code:'CARD_AMBIGUOUS',twoCards:true},
  {name:'multiple rings',code:'RING_AMBIGUOUS',twoRings:true},
  {name:'steep angle',code:'NO_CARD|CARD_PERSPECTIVE',pitch:29,roll:15},
  {name:'blur',code:'NO_CARD|CARD_EDGE_UNCLEAR|RING_NOT_CLEAR|RING_BOUNDARY',blur:4},
  {name:'radial distortion',code:'NO_CARD|CARD_EDGE_UNCLEAR',radial:.17},
  {name:'oversized ring crowded against card',code:'CARD_EDGE_UNCLEAR|RING_RANGE',truth:29},
  {name:'unsupported ring diameter with clear card margin',code:'RING_RANGE',truth:29,ringX:29},
  {name:'ring leaning/elliptical hole',code:'RING_NOT_CLEAR|RING_BOUNDARY',ellipse:.66}
];
async function fixture(o,preview=false){
  const f=920,scale=preview?.55:(o.scale??1);
  const angle=(o.angle??0)*Math.PI/180,p=(o.pitch??0)*Math.PI/180,r=(o.roll??0)*Math.PI/180;
  const project=(x,y)=>{
    let a=Math.cos(angle)*x-Math.sin(angle)*y,b=Math.sin(angle)*x+Math.cos(angle)*y;
    const v=b*Math.cos(p),z=b*Math.sin(p),u=a*Math.cos(r)+z*Math.sin(r),depth=180-a*Math.sin(r)+z*Math.cos(r);
    const dispX=f*u/depth,dispY=f*v/depth,k=1+(o.radial??0)*((dispX/(W/2))**2+(dispY/(H/2))**2);
    return [(W/2+k*dispX).toFixed(3),(H/2+k*dispY).toFixed(3)];
  };
  const card=(x,y)=>`<path d="${path(polygonRect(x,y,o.cardWidth??CARD_LONG_MM,CARD_SHORT_MM,3.2),project)}" fill="${o.color??'#46535e'}"/>`;
  const ring=(x,y)=>{const d=o.truth??17.6,r=d/2,e=o.ellipse??1;return `<path d="${path(round(x,y,r+2,(r+2)*e),project)} ${path(round(x,y,r,r*e),project)}" fill="${o.ringColor??'#424043'}" fill-rule="evenodd"/>`;};
  const x=o.cardX??-79,y=o.twoCards?-57:-27;
  const grain=o.grain?Array.from({length:121},(_,i)=>`<path d="M 0 ${i*8} Q 540 ${i*8+Math.sin(i)*4} 1280 ${i*8+Math.cos(i)*5}" fill="none" stroke="${i%4===0?'#b79e81':'#eaddcb'}" opacity=".45" stroke-width="${i%4===0?2.5:1}"/>`).join(''):'';
  const ink=(dx,dy,w,h,color='#ded9c0')=>`<path d="${path(polygonRect(x+dx,y+dy,w,h,0),project)}" fill="${color}"/>`;
  const print=o.print?(o.densePrint?ink(7,7,71,40):ink(14,12,28,11)+ink(53,12,15,24)+ink(11,29,33,4)+ink(13,36,12,6))+ (o.marginPrint?ink(8,2.4,12,5):''):'';
  const damage=o.damaged?`<path d="${path([[x,y],[x+24,y],[x,y+22]],project)}" fill="#e7e7e7"/>`:'';
  const occlusion=o.bridge?ink(o.missingEnd?0:31,-2,o.missingEnd?34:23,5,'#e7e7e7') +
    (o.twoWeak?ink(31,CARD_SHORT_MM-3,23,5,'#e7e7e7'):'') + (o.offsetEnd?ink(61,-2,28,4.6,'#e7e7e7'):''):'';
  const svg=`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${o.bg??'#e7e7e7'}"/>
    ${grain}${o.noCard?'':card(x,y)}${o.twoCards?card(x,3):''}${print}${damage}${occlusion}
    ${o.pattern?[9,28,47,66].map(dx=>`<path d="${path(polygonRect(x+dx,y+3,8,48),project)}" fill="#888"/>`).join(''):''}
    ${o.noRing?'':ring(o.ringX??26,0)}${o.twoRings?ring(24,29):''}</svg>`;
  let pipeline=sharp(Buffer.from(svg));
  if(o.blur)pipeline=pipeline.blur(o.blur);
  if(scale!==1)pipeline=pipeline.resize(Math.round(W*scale),Math.round(H*scale));
  const {data,info}=await pipeline.ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {data,width:info.width,height:info.height};
}
// Global Otsu merges the reference with the gray background in this case
// (verified against ff97436); a bounded alternative recovers its true edges.
const unevenScene=`<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
  <rect width="800" height="600" fill="#ddd"/>
  <rect x="15" y="26" width="210" height="400" fill="#9b9b9b"/>
  <rect x="132" y="160" rx="10" width="260" height="164" fill="#46535e"/>
  <rect x="165" y="205" width="70" height="20" fill="#ccc"/>
</svg>`;
const unevenGray=await sharp(Buffer.from(unevenScene)).greyscale().raw().toBuffer();
const recovered=detectCard(cv,unevenGray,800,600);
assert.equal(recovered.card,true);
for(const [i,[x,y]] of [[132,160],[392,160],[392,324],[132,324]].entries()){
  assert.ok(recovered.quad.some(([a,b])=>Math.hypot(a-x,b-y)<1),'refitted real corner '+i);
}
if (process.env.RING_REDACTED_TEST_FRAME) {
  // Deliberately preview-only, and never log radii or size estimates.
  const {data,info}=await sharp(process.env.RING_REDACTED_TEST_FRAME).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const r=measureCardRing(cv,{data,width:info.width,height:info.height},{preview:true,confirmedStandardCard:true});
  assert.equal(r.status,'retake');assert.equal(r.reasons[0].code,'CARD_EDGE_UNCLEAR');
  assert.equal(r.overlay.cardHint?.length,4);assert.equal(r.overlay.card,undefined);assert.equal(r.overlay.inner,undefined);
  assert.equal(r.diameterMm,undefined);assert.equal(r.guideDiameterMm,undefined);
  console.log('PASS blurred reference in redacted static preview only earns a provisional outline.');
}
// One independently valid dark reference and one independently valid light
// reference are ambiguous even though their luminance polarity differs.
const twoColors=`<svg width="1100" height="700" xmlns="http://www.w3.org/2000/svg">
  <rect width="550" height="700" fill="#e4e4e4"/>
  <rect x="550" width="550" height="700" fill="#303030"/>
  <rect x="107" y="238" rx="10" width="310" height="196" fill="#54333c"/>
  <rect x="660" y="238" rx="10" width="310" height="196" fill="#bfd0b0"/>
</svg>`;
const mixedGray=await sharp(Buffer.from(twoColors)).greyscale().raw().toBuffer();
assert.equal(detectCard(cv,mixedGray,1100,700).code,'CARD_AMBIGUOUS');
const normal=await fixture(opts[0]);
assert.equal(measureCardRing(cv,normal).reasons[0].code,'CARD_NOT_CONFIRMED');
let passed=0,previewPassed=0;
for(const o of opts){
  const r=measureCardRing(cv,await fixture(o),{confirmedStandardCard:true});
  if(o.code){
    assert.equal(r.status,'retake',o.name);
    assert.ok(o.code.split('|').includes(r.reasons[0].code),o.name+': '+r.reasons[0].code);
    assert.equal(r.diameterMm,undefined);
    if(o.noRing) {const p=measureCardRing(cv,await fixture(o),{confirmedStandardCard:true,preview:true});
      assert.equal(p.overlay.card.length,4);assert.equal(p.overlay.inner,undefined);}
    if(o.noCard) {const p=measureCardRing(cv,await fixture(o),{confirmedStandardCard:true,preview:true});
      assert.deepEqual(p.overlay,{});}

  }else{
    assert.equal(r.status,'ok',o.name+': '+JSON.stringify(r));
    if(o.expectBridge)assert.equal(r.checks.edgeBridge,true);
    const error=Math.abs(r.diameterMm-o.truth);
    assert.ok(error<=.50 && error<=r.uncertaintyMm,o.name+': '+error);
    const p=measureCardRing(cv,await (o.expectBridge?fixture({...o,scale:.9}):fixture(o,true)),{confirmedStandardCard:true,preview:true});
    assert.equal(p.status,'preview',o.name+' preview: '+JSON.stringify(p));
    assert.equal(p.diameterMm,undefined);
    if(o.expectBridge){
      assert.equal(p.checks.edgeBridge,true);
      const small=measureCardRing(cv,await fixture(o,true),{confirmedStandardCard:true,preview:true});
      assert.equal(small.status,'retake');
      assert.equal(small.reasons[0].code,'CARD_BRIDGE_UNCERTAIN');
    }
    previewPassed++;
  }
  console.log('PASS',o.name,r.status==='ok'?`error=${Math.abs(r.diameterMm-o.truth).toFixed(3)} mm`:r.reasons[0].code);passed++;
}
for(const scale of [1.5,3]){
  const r=measureCardRing(cv,await fixture({...opts[1],scale}),{confirmedStandardCard:true});
  assert.equal(r.status,'ok','full native '+(W*scale)+'px capture: '+JSON.stringify(r));
  assert.ok(Math.abs(r.diameterMm-opts[1].truth)<=.5);
  console.log('PASS native-size simulated capture',W*scale,'px');
}
const light=opts.find(o=>o.ringColor);
const hi=measureCardRing(cv,await fixture({...light,scale:1.5}),{confirmedStandardCard:true});
assert.equal(hi.status,'ok');assert.ok(Math.abs(hi.diameterMm-light.truth)<=.5);
console.log('PASS light reference is refitted at full image resolution');
console.log(`PASS ${passed} optical fixtures and ${previewPassed} downscaled preview checks (not physical calibration).`);
