// Local optical prototype for a confirmed ISO 7810 ID-1 card and one flat ring
// on a matte, light, high-contrast background. This cannot authenticate the card.
import { homographyFrom4, applyH, invert3, mul3, localGeometry, approxPose, findHoleCandidates, refineInnerBoundary } from './measure.js';

export const CARD_LONG_MM = 85.60, CARD_SHORT_MM = 53.98;
const PLANE = [[0, 0], [CARD_LONG_MM, 0], [CARD_LONG_MM, CARD_SHORT_MM], [0, CARD_SHORT_MM]];
const aspect = CARD_LONG_MM / CARD_SHORT_MM;
// Viewfinder hints only. Use the native frame's aspect even when the viewport
// letterboxes it. Keep the ring above the horizontal card in either orientation.
export function cardViewfinder(w,h){
  const width=Math.min(.55*w,.56*h,.35*Math.max(w,h)), height=width/aspect, r=.14*width;
  const above=.28*width, span=height+above+r, top=.53*h-span/2;
  return {circle:{cx:w/2,cy:top+r,r},rect:{x:(w-width)/2,y:top+r+above,width,height,rx:.037*width}};
}

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
const median = a => {const b=a.slice().sort((x,y)=>x-y); return b[Math.floor(b.length/2)];};

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
  const hits=[]; const coverage=[0,0,0];
  // Ignore the rounded corners. Probe perpendicular to each straight edge.
  for(let i=0;i<27;i++){
    const f=.12+.76*i/26, x=a[0]+f*d[0],y=a[1]+f*d[1], pp=[];
    for(let j=-42;j<=42;j++)pp.push(grayAt(gray,w,h,x+j*.33*n[0],y+j*.33*n[1]));
    let k=2;
    for(let j=3;j<pp.length-2;j++)if(pp[j+2]-pp[j-2]>pp[k+2]-pp[k-2])k=j;
    if(k<=2||k>=pp.length-3)continue;
    const inV=avg(pp.slice(0,3)), outV=avg(pp.slice(-3)), contrast=outV-inV;
    if(contrast<36 || pp[k+2]-pp[k-2]<contrast*.50)continue;
    const mid=(inV+outV)/2;
    let nearest=Infinity;
    for(let j=Math.max(0,k-4);j<Math.min(pp.length-1,k+4);j++){
      if((pp[j]-mid)*(pp[j+1]-mid)>0 || pp[j+1]===pp[j])continue;
      const cross=(j-42+(mid-pp[j])/(pp[j+1]-pp[j]))*.33;
      if(Math.abs(cross-(k-42)*.33)<Math.abs(nearest-(k-42)*.33)) nearest=cross;
    }
    if(!Number.isFinite(nearest))continue;
    hits.push([x+nearest*n[0],y+nearest*n[1]]); coverage[Math.floor(i/9)]++;
  }
  if(hits.length<24||coverage.some(n=>n<7))return null;
  const c=center(hits); const ts=hits.map(p=>dot(minus(p,c),t)), ns=hits.map(p=>dot(minus(p,c),n));
  const slope=avg(ts.map((u,i)=>u*ns[i]))/avg(ts.map(v=>v*v));
  const rms=Math.sqrt(avg(ts.map((u,i)=>(ns[i]-slope*u)**2)));
  if(!Number.isFinite(rms)||rms>0.68||Math.abs(slope)>0.04)return null;
  const v=n.map((x,i)=>x-slope*t[i]);
  return {v,k:dot(c,v),rms};
}
function crossLines(a,b){
  const [x,y]=a.v,[u,v]=b.v,det=x*v-y*u;
  return Math.abs(det)<.8?null:[(a.k*v-y*b.k)/det,(x*b.k-a.k*u)/det];
}
// Validate four independent strips just inside/outside the fitted rectangle. The
// central face is irrelevant. Contrast at the true transition is checked separately.
function perimeterSupported(gray,w,h,H) {
  const borders=[
    f=>[[f*CARD_LONG_MM,4],[f*CARD_LONG_MM,-4]],
    f=>[[CARD_LONG_MM-4,f*CARD_SHORT_MM],[CARD_LONG_MM+4,f*CARD_SHORT_MM]],
    f=>[[f*CARD_LONG_MM,CARD_SHORT_MM-4],[f*CARD_LONG_MM,CARD_SHORT_MM+4]],
    f=>[[4,f*CARD_SHORT_MM],[-4,f*CARD_SHORT_MM]],
  ];
  return borders.every(border=>{
    const pairs=Array.from({length:21},(_,i)=>border(.12+.76*i/20).map(p=>grayAt(gray,w,h,...applyH(H,...p))));
    if(pairs.some(p=>p.some(v=>!Number.isFinite(v))))return false;
    const inner=median(pairs.map(p=>p[0]));
    const support=pairs.map(([a,b])=>b-a>=36 && a<=inner+37);
    return support.filter(Boolean).length>=16 && [0,7,14].every(i=>support.slice(i,i+7).filter(Boolean).length>=4);
  });
}
export function detectCard(cv,gray,w,h){
  const input=new cv.Mat(h,w,cv.CV_8UC1),smooth=new cv.Mat(),mask=new cv.Mat(),curves=new cv.MatVector(),hier=new cv.Mat();
  try{
    input.data.set(gray); cv.GaussianBlur(input,smooth,new cv.Size(3,3),0);
    cv.threshold(smooth,mask,0,255,cv.THRESH_BINARY_INV|cv.THRESH_OTSU);
    cv.findContours(mask,curves,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    if(curves.size()>180)return {card:false,code:'CARD_CLUTTER'};
    const found=[]; let edgeProblem=false, geometryProblem=false;
    for(let i=0;i<curves.size();i++){
      const c=curves.get(i),p=new cv.Mat();
      try{
        if(cv.contourArea(c)<.025*w*h)continue;
        const perimeter=cv.arcLength(c,true); cv.approxPolyDP(c,p,.022*perimeter,true);
        if(p.rows!==4||!cv.isContourConvex(p))continue;
        const q=ordered(Array.from({length:4},(_,j)=>[p.data32S[j*2],p.data32S[j*2+1]]));
        if(!plausible(q,w,h))continue;
        const edges=q.map((pt,j)=>sampleEdge(gray,w,h,pt,q[(j+1)%4]));
        if(edges.some(e=>!e)){edgeProblem=true;continue;}
        const fit=q.map((_,j)=>crossLines(edges[(j+3)%4],edges[j]));
        if(fit.some(pt=>!pt)||!plausible(fit,w,h)){geometryProblem=true;continue;}
        const H=homographyFrom4(PLANE,fit);
        if(!H){geometryProblem=true;continue;}
        if(!perimeterSupported(gray,w,h,H)){edgeProblem=true;continue;}
        found.push({quad:fit,H,rmsPx:Math.max(...edges.map(e=>e.rms))});
      }finally{c.delete();p.delete();}
    }
    if(found.length!==1)return {card:false,code:found.length?'CARD_AMBIGUOUS':geometryProblem?'CARD_GEOMETRY':edgeProblem?'CARD_EDGE_UNCLEAR':'NO_CARD'};
    return {card:true,...found[0]};
  }finally{input.delete();smooth.delete();mask.delete();curves.delete();hier.delete();}
}
const cardCenter=[CARD_LONG_MM/2,CARD_SHORT_MM/2];
const gap = c => Math.hypot(Math.max(0,-c.cx,c.cx-CARD_LONG_MM),Math.max(0,-c.cy,c.cy-CARD_SHORT_MM))-c.r;
export const CARD_HELP = {
  CARD_NOT_CONFIRMED: 'Confirm you’re using a standard bank-size card.',
  NO_CARD: 'No full card outline found. Use a dark card on plain white paper and keep all four edges in view.',
  CARD_CLUTTER: 'Use a clear, plain, matte light surface with the card and ring only.',
  CARD_AMBIGUOUS: 'Keep only one card in the camera view.',
  CARD_EDGE_UNCLEAR: 'Card edges aren’t clear enough to measure. Lay the card flat on plain white paper and avoid shadows or glare.',
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
    if(ratio<1&&!perimeterSupported(fullGray,w,h,H))return fail('CARD_EDGE_UNCLEAR',{card:true});
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
