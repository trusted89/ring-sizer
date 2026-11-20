import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { CARD_LONG_MM, CARD_SHORT_MM, measureCardRing } from '../../public/card-camera.js';
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
  {name:'card observed alone',code:'RING_NOT_CLEAR',noRing:true},
  {name:'ring without card',code:'NO_CARD',noCard:true},
  {name:'square wrong aspect',code:'NO_CARD',cardWidth:54},
  {name:'card clipped by frame',code:'NO_CARD',cardX:-119},
  {name:'wrong striped card',code:'NO_CARD',pattern:true},
  {name:'low card and background contrast',code:'NO_CARD',color:'#d9d9d9'},
  {name:'ring overlaps card',code:'RING_NOT_CLEAR|NO_CARD',ringX:8},
  {name:'multiple plausible cards',code:'CARD_AMBIGUOUS',twoCards:true},
  {name:'multiple rings',code:'RING_AMBIGUOUS',twoRings:true},
  {name:'steep angle',code:'NO_CARD|CARD_PERSPECTIVE',pitch:29,roll:15},
  {name:'blur',code:'NO_CARD|RING_NOT_CLEAR|RING_BOUNDARY',blur:4},
  {name:'radial distortion',code:'NO_CARD|CARD_EDGE_UNCLEAR',radial:.17},
  {name:'unsupported ring diameter',code:'RING_RANGE',truth:29},
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
  const ring=(x,y)=>{const d=o.truth??17.6,r=d/2,e=o.ellipse??1;return `<path d="${path(round(x,y,r+2,(r+2)*e),project)} ${path(round(x,y,r,r*e),project)}" fill="#424043" fill-rule="evenodd"/>`;};
  const x=o.cardX??-79,y=o.twoCards?-57:-27;
  const svg=`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#e7e7e7"/>
    ${o.noCard?'':card(x,y)}${o.twoCards?card(x,3):''}
    ${o.pattern?[9,28,47,66].map(dx=>`<path d="${path(polygonRect(x+dx,y+3,8,48),project)}" fill="#888"/>`).join(''):''}
    ${o.noRing?'':ring(o.ringX??26,0)}${o.twoRings?ring(24,29):''}</svg>`;
  let pipeline=sharp(Buffer.from(svg));
  if(o.blur)pipeline=pipeline.blur(o.blur);
  if(scale!==1)pipeline=pipeline.resize(Math.round(W*scale),Math.round(H*scale));
  const {data,info}=await pipeline.ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {data,width:info.width,height:info.height};
}
const normal=await fixture(opts[0]);
assert.equal(measureCardRing(cv,normal).reasons[0].code,'CARD_NOT_CONFIRMED');
let passed=0,previewPassed=0;
for(const o of opts){
  const r=measureCardRing(cv,await fixture(o),{confirmedStandardCard:true});
  if(o.code){
    assert.equal(r.status,'retake',o.name);
    assert.ok(o.code.split('|').includes(r.reasons[0].code),o.name+': '+r.reasons[0].code);
    assert.equal(r.diameterMm,undefined);
  }else{
    assert.equal(r.status,'ok',o.name+': '+JSON.stringify(r));
    const error=Math.abs(r.diameterMm-o.truth);
    assert.ok(error<=.50 && error<=r.uncertaintyMm,o.name+': '+error);
    const p=measureCardRing(cv,await fixture(o,true),{confirmedStandardCard:true,preview:true});
    assert.equal(p.status,'preview',o.name+' preview: '+JSON.stringify(p));
    assert.equal(p.diameterMm,undefined);
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
console.log(`PASS ${passed} optical fixtures and ${previewPassed} downscaled preview checks (not physical calibration).`);
