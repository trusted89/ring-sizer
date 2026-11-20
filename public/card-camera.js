// Local optical prototype for a confirmed ISO 7810 ID-1 card and one flat ring
// on a matte, light, high-contrast background. This cannot authenticate the card.
import { homographyFrom4, applyH, invert3, mul3, localGeometry, approxPose, findHoleCandidates, refineInnerBoundary } from './measure.js';

export const CARD_LONG_MM = 85.60, CARD_SHORT_MM = 53.98;
const PLANE = [[0, 0], [CARD_LONG_MM, 0], [CARD_LONG_MM, CARD_SHORT_MM], [0, CARD_SHORT_MM]];
const aspect = CARD_LONG_MM / CARD_SHORT_MM;
const dist = (a,b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const dot = (a,b) => a[0]*b[0]+a[1]*b[1];
const minus = (a,b) => [a[0]-b[0],a[1]-b[1]];
const center = q => q.reduce(([x,y],p)=>[x+p[0]/q.length,y+p[1]/q.length],[0,0]);
const grayAt = (gray,w,h,x,y) => {
  if(x<0||y<0||x>=w-1||y>=h-1)return NaN;
  const i=Math.floor(x), j=Math.floor(y), a=x-i,b=y-j,n=j*w+i;
  return (gray[n]*(1-a)+gray[n+1]*a)*(1-b)+(gray[n+w]*(1-a)+gray[n+w+1]*a)*b;
};
function avg(a) { return a.reduce((s,x)=>s+x,0)/a.length; }
const std = a => {const m=avg(a); return Math.sqrt(avg(a.map(v=>(v-m)**2)));};

function ordered(points){
  const c=center(points);
  const q=points.slice().sort((a,b)=>Math.atan2(a[1]-c[1],a[0]-c[0])-Math.atan2(b[1]-c[1],b[0]-c[0]));
  if(dist(q[0],q[1])+dist(q[2],q[3]) < dist(q[1],q[2])+dist(q[3],q[0])) q.push(q.shift());
  return q;
}
function plausible(q,w,h){
  const x=q.map(t=>t[0]),y=q.map(t=>t[1]),c=center(q);
  if(Math.min(...x)<0.05*w || Math.max(...x)>0.95*w || Math.min(...y)<0.05*h || Math.max(...y)>0.95*h)return false;
  if(Math.abs(c[0]-w/2)>0.34*w||Math.abs(c[1]-h/2)>0.28*h)return false;
  const [a,b,d,e]=q.map((p,i)=>dist(p,q[(i+1)%4]));
  if(Math.min(a,d)<Math.max(w,h)*0.19||Math.min(b,e)<95)return false;
  const r=(a+d)/(b+e);
  if(Math.abs(r/aspect-1)>0.085||Math.abs(a/d-1)>0.11||Math.abs(b/e-1)>0.11)return false;
  return q.every((p,i)=>{const u=minus(q[(i+1)%4],p),v=minus(q[(i+3)%4],p);return Math.abs(dot(u,v)/(Math.hypot(...u)*Math.hypot(...v)))<0.15;});
}
function sampleEdge(gray,w,h,a,b){
  const d=minus(b,a),l=Math.hypot(...d),t=d.map(v=>v/l),n=[t[1],-t[0]];
  const hits=[]; const noiseRef=[]; const shifts=[];
  // Ignore the rounded corners. Probe perpendicular to each straight edge.
  for(let i=0;i<27;i++){
    const f=.12+.76*i/26, x=a[0]+f*d[0],y=a[1]+f*d[1], pp=[];
    for(let j=-30;j<=30;j++)pp.push(grayAt(gray,w,h,x+j*.33*n[0],y+j*.33*n[1]));
    let k=2;
    for(let j=3;j<pp.length-2;j++)if(Math.abs(pp[j+2]-pp[j-2])>Math.abs(pp[k+2]-pp[k-2]))k=j;
    if(k<=2||k>=pp.length-3)continue;
    const inV=avg(pp.slice(0,3)), outV=avg(pp.slice(-3)), contrast=Math.abs(outV-inV);
    if(contrast<36 || Math.abs(pp[k+2]-pp[k-2])<contrast*.50 || Math.sign(pp[k+2]-pp[k-2])!==Math.sign(outV-inV))continue;
    const mid=(inV+outV)/2;
    let nearest=Infinity;
    for(let j=Math.max(0,k-4);j<Math.min(pp.length-1,k+4);j++){
      if((pp[j]-mid)*(pp[j+1]-mid)>0 || pp[j+1]===pp[j])continue;
      const cross=(j-30+(mid-pp[j])/(pp[j+1]-pp[j]))*.33;
      if(Math.abs(cross-(k-30)*.33)<Math.abs(nearest-(k-30)*.33)) nearest=cross;
    }
    if(!Number.isFinite(nearest))continue;
    hits.push([x+nearest*n[0],y+nearest*n[1]]); noiseRef.push(inV); shifts.push(Math.sign(outV-inV));
  }
  if(hits.length<24||std(noiseRef)>24||Math.abs(avg(shifts))<.95)return null;
  const c=center(hits); const ts=hits.map(p=>dot(minus(p,c),t)), ns=hits.map(p=>dot(minus(p,c),n));
  const slope=avg(ts.map((u,i)=>u*ns[i]))/avg(ts.map(v=>v*v));
  const rms=Math.sqrt(avg(ts.map((u,i)=>(ns[i]-slope*u)**2)));
  if(!Number.isFinite(rms)||rms>0.68||Math.abs(slope)>0.04)return null;
  const v=n.map((x,i)=>x-slope*t[i]);
  return {v,k:dot(c,v),rms,sign:Math.sign(avg(shifts))};
}
function crossLines(a,b){
  const [x,y]=a.v,[u,v]=b.v,det=x*v-y*u;
  return Math.abs(det)<.8?null:[(a.k*v-y*b.k)/det,(x*b.k-a.k*u)/det];
}
export function detectCard(cv,gray,w,h){
  const input=new cv.Mat(h,w,cv.CV_8UC1),smooth=new cv.Mat(),mask=new cv.Mat(),curves=new cv.MatVector(),hier=new cv.Mat();
  try{
    input.data.set(gray); cv.GaussianBlur(input,smooth,new cv.Size(3,3),0);
    cv.threshold(smooth,mask,0,255,cv.THRESH_BINARY_INV|cv.THRESH_OTSU);
    cv.findContours(mask,curves,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    if(curves.size()>180)return {card:false,code:'CARD_CLUTTER'};
    const found=[];
    for(let i=0;i<curves.size();i++){
      const c=curves.get(i),p=new cv.Mat();
      try{
        if(cv.contourArea(c)<.025*w*h)continue;
        const perimeter=cv.arcLength(c,true); cv.approxPolyDP(c,p,.022*perimeter,true);
        if(p.rows!==4||!cv.isContourConvex(p))continue;
        const q=ordered(Array.from({length:4},(_,j)=>[p.data32S[j*2],p.data32S[j*2+1]]));
        if(!plausible(q,w,h))continue;
        const edges=q.map((pt,j)=>sampleEdge(gray,w,h,pt,q[(j+1)%4]));
        if(edges.some(e=>!e||e.sign!==edges[0]?.sign))continue;
        const fit=q.map((_,j)=>crossLines(edges[(j+3)%4],edges[j]));
        if(fit.some(pt=>!pt)||!plausible(fit,w,h))continue;
        // A single matt-backed, near-uniform card. Colored strips and logos are not trusted by this prototype.
        const H=homographyFrom4(PLANE,fit);
        if(!H)continue;
        const values=[];
        for(const x of [10,23,36,49,62,75])for(const y of [9,21,33,45])values.push(grayAt(gray,w,h,...applyH(H,x,y)));
        if(values.some(v=>!Number.isFinite(v))||std(values)>18)continue;
        found.push({quad:fit,H,rmsPx:Math.max(...edges.map(e=>e.rms))});
      }finally{c.delete();p.delete();}
    }
    if(found.length!==1)return {card:false,code:found.length?'CARD_AMBIGUOUS':'NO_CARD'};
    return {card:true,...found[0]};
  }finally{input.delete();smooth.delete();mask.delete();curves.delete();hier.delete();}
}
const cardCenter=[CARD_LONG_MM/2,CARD_SHORT_MM/2];
const gap = c => Math.hypot(Math.max(0,-c.cx,c.cx-CARD_LONG_MM),Math.max(0,-c.cy,c.cy-CARD_SHORT_MM))-c.r;
export const CARD_HELP = {
  CARD_NOT_CONFIRMED: 'Confirm you’re using a standard bank-size card.',
  NO_CARD: 'Show all four edges of one dark, plain-backed card on a light surface.',
  CARD_CLUTTER: 'Use a clear, plain, matte light surface with the card and ring only.',
  CARD_AMBIGUOUS: 'Keep only one card in the camera view.',
  CARD_EDGE_UNCLEAR: 'Keep all four card edges clear and avoid shadows or glare.',
  CARD_GEOMETRY: 'Move the camera directly above the objects.',
  CARD_PERSPECTIVE: 'Level the phone directly above the ring and card.',
  CARD_RESOLUTION: 'The camera image is too small for a reliable estimate. Try a high-resolution rear camera in good light, or measure on screen.',
  CARD_TOO_CLOSE: 'Move the phone a little farther back. Keep both objects in view.',
  RING_NOT_CLEAR: 'Show one flat ring beside the card, with light surface visible through it.',
  RING_AMBIGUOUS: 'Remove extra rings or circular objects.',
  RING_OFF_CENTRE: 'Center the ring in the camera view, with the card still visible.',
  RING_BOUNDARY: 'The ring’s inner edge is unclear. Use flat placement and soft light.',
  RING_RANGE: 'This ring falls outside the supported size or placement range.',
};
const fail = (code,d={})=>({status:'retake',reference:'card',reasons:[{code,fix:CARD_HELP[code]}],checks:{},overlay:{},...d});
function makeGray(data){const g=new Uint8Array(data.length/4);for(let i=0,p=0;i<g.length;i++,p+=4)g[i]=(data[p]*77+data[p+1]*150+data[p+2]*29)>>8;return g;}

export function measureCardRing(cv,img,{confirmedStandardCard=false, preview=false}={}){
  if(!confirmedStandardCard)return fail('CARD_NOT_CONFIRMED');
  const {width:w,height:h,data}=img;
  if(w<280||h<280||w*h>17e6||!data||data.length!==w*h*4)return fail('CARD_RESOLUTION');
  const fullGray=makeGray(data), ratio=Math.min(1,1200/Math.max(w,h));
  const rgba=new cv.Mat(h,w,cv.CV_8UC4);rgba.data.set(data);
  const small=ratio<1?new cv.Mat():rgba;
  const cw=Math.round(w*ratio),ch=Math.round(h*ratio),kx=cw/w,ky=ch/h;
  try{
    if(ratio<1)cv.resize(rgba,small,new cv.Size(cw,ch),0,0,cv.INTER_AREA);
    const gray=ratio<1?makeGray(small.data):fullGray;
    const card=detectCard(cv,gray,cw,ch);
    if(!card.card)return fail(card.code);
    // If downsampled, refit virtual corners on full-resolution straight edge samples.
    let q=card.quad.map(p=>[p[0]/kx,p[1]/ky]), rmsPx=card.rmsPx;
    if(ratio<1){
      const e=q.map((a,i)=>sampleEdge(fullGray,w,h,a,q[(i+1)%4]));
      if(e.some(v=>!v))return fail('CARD_EDGE_UNCLEAR',{card:true});
      q=q.map((_,i)=>crossLines(e[(i+3)%4],e[i]));
      if(q.some(p=>!p)||!plausible(q,w,h))return fail('CARD_EDGE_UNCLEAR',{card:true});
      rmsPx=Math.max(...e.map(v=>v.rms));
    }
    const H=homographyFrom4(PLANE,q);
    if(!H)return fail('CARD_GEOMETRY',{card:true});
    const geo=localGeometry(H,...cardCenter), pose=approxPose(H,w,h);
    const base={card:true,reference:'card',overlay:{card:q},checks:{pxPerMm:geo.pxPerMm,tiltDeg:pose.tiltDeg}};
    if(!Number.isFinite(pose.heightMm)||pose.tiltDeg>15||geo.tiltDeg>24)return fail('CARD_PERSPECTIVE',base);
    if(geo.pxPerMm<(preview?2.0:4.0))return fail('CARD_RESOLUTION',base);
    // Focal-length estimate is heuristic; cannot correct height/unknown distortion.
    if(pose.heightMm<170)return fail('CARD_TOO_CLOSE',base);
    const Hsc=mul3(invert3(H),[1/kx,0,0,0,1/ky,0,0,0,1]);
    const candidates=findHoleCandidates(cv,small,Hsc,geo.pxPerMm*Math.sqrt(kx*ky),{chroma:0},undefined,{
      origin:cardCenter, radius:105, mask:[-3,-3,CARD_LONG_MM+3,CARD_SHORT_MM+3]
    }).filter(c=>gap(c)>=4 && gap(c)<40);
    if(candidates.length!==1)return fail(candidates.length?'RING_AMBIGUOUS':'RING_NOT_CLEAR',base);
    const ring=candidates[0], ringGeo=localGeometry(H,ring.cx,ring.cy);
    const [x,y]=applyH(H,ring.cx,ring.cy);
    if(Math.abs(x-w/2)>.28*w||Math.abs(y-h/2)>.28*h)return fail('RING_OFF_CENTRE',base);
    const outline=c=>Array.from({length:80},(_,i)=>{const a=i/40*Math.PI;return applyH(H,c.cx+Math.cos(a)*c.r,c.cy+Math.sin(a)*c.r);});
    if(preview)return {status:'preview',...base,overlay:{...base.overlay,inner:outline(ring)},ring:true,guideDiameterMm:2*ring.r};
    const f=refineInnerBoundary(fullGray,w,h,H,ring,ringGeo.pxPerMm);
    if(!f.ok||f.inlierFrac<.68||f.gapDeg>110||f.rmsMm>.12)return fail('RING_BOUNDARY',base);
    const c=f.circle,d=2*c.r;
    if(d<12||d>26||gap(c)<4)return fail('RING_RANGE',base);
    // Bounded prototype uncertainty only. Never promise clinical or jeweler-grade precision.
    const u=Math.max(.50,Math.hypot(d*4/pose.heightMm, d*rmsPx/(CARD_SHORT_MM*geo.pxPerMm)*3,
      d*.002, d*.0008*pose.tiltDeg, f.rmsMm*3, .5/ringGeo.pxPerMm));
    return {status:'ok',...base,ring:true,overlay:{...base.overlay,inner:outline(c)},diameterMm:d,uncertaintyMm:u};
  }finally{rgba.delete();if(small!==rgba)small.delete();}
}
