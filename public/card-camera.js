// Local optical prototype for a confirmed ISO 7810 ID-1 card and one flat ring
// on a matte, light, high-contrast background. This cannot authenticate the card.
import { homographyFrom4, applyH, invert3, mul3, localGeometry, approxPose, findHoleCandidates, refineInnerBoundary } from './measure.js';

export const CARD_LONG_MM = 85.60, CARD_SHORT_MM = 53.98;
const PLANE = [[0, 0], [CARD_LONG_MM, 0], [CARD_LONG_MM, CARD_SHORT_MM], [0, CARD_SHORT_MM]];
const aspect = CARD_LONG_MM / CARD_SHORT_MM;
const dist = (a,b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
export const CARD_TRACK_MAX_AGE_MS = 950;
const maxDelta = (a,b) => Math.max(...a.map((p,i)=>dist(p,b[i])));
// A contour can begin at a different corner/angle on the next frame. Match
// equivalent clockwise indices before comparing, then ease only the display.
function align(points,previous){
  let best=points, difference=Infinity;
  if(!points.length || points.length!==previous?.length)return best;
  for(let step=0;step<points.length;step++){
    const q=points.map((_,i)=>points[(i+step)%points.length]);
    const error=q.reduce((sum,p,i)=>sum+dist(p,previous[i])**2,0);
    if(error<difference){best=q;difference=error;}
  }
  return best;
}
function eased(next,previous,limit) {
  if(!next.length || next.length!==previous?.length || maxDelta(next,previous)>limit)return next;
  return next.map((p,i)=>p.map((v,j)=>v*.75+previous[i][j]*.25));
}
export function trackCardFrame(previous,reading,{width,height,time,frameTime}){
  const frameKey=`${width}x${height}`;
  if(previous?.frameKey!==frameKey || time-previous.time>=CARD_TRACK_MAX_AGE_MS)previous=null;
  if(previous && frameTime<=previous.frameTime)return previous;
  const confident=!!reading.overlay?.card?.length;
  const card=align(reading.overlay?.card??reading.overlay?.cardHint??[],previous?.card), ring=align(confident?(reading.overlay?.inner??[]):[],previous?.ring);
  const span=Math.max(width,height), state=card.length?(!confident?'card-hint':ring.length?'both':'card-only'):'unconfirmed';
  const qualifies=state==='both' && reading.status==='preview';
  const size=reading.guideDiameterMm, scale=reading.checks?.pxPerMm, bridge=!!reading.checks?.edgeBridge;
  const remains=(q,p,cutoff)=>q.length>0 && q.length===p?.length && maxDelta(q,p)<cutoff;
  const passes=qualifies && previous?.qualifies && bridge===previous.bridge && Math.abs(size-previous.size)<.40 &&
    Math.abs(scale/previous.scale-1)<.025 &&
    remains(card,previous.card,span*.018) && remains(ring,previous.ring,span*.012);
  const stable=passes?previous.stable+1:qualifies?1:0;
  return {card,ring,state,qualifies,stable,frameKey,time,frameTime,size,scale,bridge,
    cardDraw:eased(card,previous?.cardDraw,span*.035),ringDraw:eased(ring,previous?.ringDraw,span*.025)};
}
export const canCaptureCard = (tracked,now) => !!tracked && tracked.qualifies &&
  tracked.stable>=3 && now-tracked.time<CARD_TRACK_MAX_AGE_MS;

export async function enableContinuousFocus(track){
  try {
    const modes=track?.getCapabilities?.().focusMode;
    if(!modes?.includes('continuous') || track.getSettings?.().focusMode==='continuous')return false;
    await track.applyConstraints({advanced:[{focusMode:'continuous'}]});
    return true;
  } catch { return false; }
}

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
function sampleEdge(gray,w,h,a,b,hint=false,polarity=1,bridge=false){
  const d=minus(b,a),l=Math.hypot(...d),t=d.map(v=>v/l),n=[t[1],-t[0]];
  let hits=[]; const coverage=[0,0,0], sections=[], indices=[];
  const wing=hint?8:2, search=hint?10:4;
  // Ignore the rounded corners. Probe perpendicular to each straight edge.
  for(let i=0;i<27;i++){
    if(bridge && i>=9 && i<18)continue;
    const f=.12+.76*i/26, x=a[0]+f*d[0],y=a[1]+f*d[1], pp=[];
    for(let j=-42;j<=42;j++)pp.push(grayAt(gray,w,h,x+j*.33*n[0],y+j*.33*n[1])*polarity);
    let k=wing;
    for(let j=wing+1;j<pp.length-wing;j++)if(pp[j+wing]-pp[j-wing]>pp[k+wing]-pp[k-wing])k=j;
    if(k<=wing||k>=pp.length-wing-1)continue;
    const inV=avg(pp.slice(0,3)), outV=avg(pp.slice(-3)), contrast=outV-inV;
    if(contrast<36 || pp[k+wing]-pp[k-wing]<contrast*.50)continue;
    const mid=(inV+outV)/2;
    let nearest=Infinity;
    for(let j=Math.max(0,k-search);j<Math.min(pp.length-1,k+search);j++){
      if((pp[j]-mid)*(pp[j+1]-mid)>0 || pp[j+1]===pp[j])continue;
      const cross=(j-42+(mid-pp[j])/(pp[j+1]-pp[j]))*.33;
      if(Math.abs(cross-(k-42)*.33)<Math.abs(nearest-(k-42)*.33)) nearest=cross;
    }
    if(!Number.isFinite(nearest))continue;
    hits.push([x+nearest*n[0],y+nearest*n[1]]); coverage[Math.floor(i/9)]++; sections.push(Math.floor(i/9));indices.push(i);
  }
  if(bridge){
    if(coverage[0]<7||coverage[2]<7||!indices.some(i=>i<=2)||!indices.some(i=>i>=24))return null;
  }else if(hits.length<(hint?21:24)||coverage.some(n=>n<(hint?5:7)))return null;
  const fit=points=>{
    const c=center(points), ts=points.map(p=>dot(minus(p,c),t)), ns=points.map(p=>dot(minus(p,c),n));
    const slope=avg(ts.map((u,i)=>u*ns[i]))/avg(ts.map(v=>v*v));
    const residual=ts.map((u,i)=>ns[i]-slope*u);
    return {c,slope,residual,rms:Math.sqrt(avg(residual.map(v=>v*v)))};
  };
  let line=fit(hits), bandPx=0;
  if(bridge){
    const endpoint=[0,2].map(section=>fit(hits.filter((_,i)=>sections[i]===section)));
    if(endpoint.some(e=>!Number.isFinite(e.rms)||e.rms>.55||Math.abs(e.slope)>.04)||line.rms>.60)return null;
    const at=(e,f)=>dot(minus(e.c,a),n)+(f*l-dot(minus(e.c,a),t))*e.slope;
    const disagreement=Math.max(...[.12,.50,.88].map(f=>Math.abs(at(endpoint[0],f)-at(endpoint[1],f))));
    if(disagreement>1.35)return null;
    bandPx=Math.max(1,disagreement+2*Math.max(line.rms,...endpoint.map(e=>e.rms)));
  }
  if(hint){
    // Trim only a few gross residuals and require evidence in each third.
    // This fit may locate the card, but it never supplies scale or unlocks capture.
    const inliers=line.residual.map(v=>Math.abs(v)<=2.7), inlierCoverage=[0,0,0];
    inliers.forEach((v,i)=>{if(v)inlierCoverage[sections[i]]++;});
    if(inliers.filter(Boolean).length<20||inlierCoverage.some(n=>n<5))return null;
    hits=hits.filter((_,i)=>inliers[i]); line=fit(hits);
  }
  if(!Number.isFinite(line.rms)||line.rms>(hint?1.6:.68)||Math.abs(line.slope)>.04)return null;
  const v=n.map((x,i)=>x-line.slope*t[i]);
  return {v,k:dot(line.c,v),rms:line.rms,bandPx};
}
function crossLines(a,b){
  const [x,y]=a.v,[u,v]=b.v,det=x*v-y*u;
  return Math.abs(det)<.8?null:[(a.k*v-y*b.k)/det,(x*b.k-a.k*u)/det];
}
// Validate four independent strips just inside/outside the fitted rectangle. The
// central face is irrelevant. Contrast at the true transition is checked separately.
function perimeterSupported(gray,w,h,H,polarity=1,bridgeSide=-1) {
  const borders=[
    f=>[[f*CARD_LONG_MM,4],[f*CARD_LONG_MM,-4]],
    f=>[[CARD_LONG_MM-4,f*CARD_SHORT_MM],[CARD_LONG_MM+4,f*CARD_SHORT_MM]],
    f=>[[f*CARD_LONG_MM,CARD_SHORT_MM-4],[f*CARD_LONG_MM,CARD_SHORT_MM+4]],
    f=>[[4,f*CARD_SHORT_MM],[-4,f*CARD_SHORT_MM]],
  ];
  return borders.every((border,i)=>{
    const pairs=Array.from({length:21},(_,i)=>border(.12+.76*i/20).map(p=>grayAt(gray,w,h,...applyH(H,...p))*polarity));
    if(pairs.some(p=>p.some(v=>!Number.isFinite(v))))return false;
    const inner=median(pairs.map(p=>p[0]));
    const support=pairs.map(([a,b])=>b-a>=36 && a<=inner+37);
    if(i===bridgeSide){
      const endContrast=[.09,.91].every(f=>{
        const [a,b]=border(f).map(p=>grayAt(gray,w,h,...applyH(H,...p))*polarity);
        return Number.isFinite(a)&&Number.isFinite(b)&&b-a>=36&&a<=inner+37;
      });
      return endContrast&&[0,14].every(j=>support.slice(j,j+7).filter(Boolean).length>=6);
    }
    return support.filter(Boolean).length>=16 && [0,7,14].every(i=>support.slice(i,i+7).filter(Boolean).length>=4);
  });
}
function getCardEdges(gray,w,h,q,polarity){
  const edges=q.map((p,i)=>sampleEdge(gray,w,h,p,q[(i+1)%4],false,polarity));
  const missing=edges.flatMap((edge,i)=>edge?[]:[i]);
  if(missing.length===1){
    const i=missing[0];
    const replacement=sampleEdge(gray,w,h,q[i],q[(i+1)%4],false,polarity,true);
    if(replacement){edges[i]=replacement;return {edges,bridgeSide:i};}
  }
  return {edges,bridgeSide:-1};
}
export function detectCard(cv,gray,w,h,{preview=false}={}){
  const input=new cv.Mat(h,w,cv.CV_8UC1),smooth=new cv.Mat(),mask=new cv.Mat();
  const found=[], provisional=[]; let edgeProblem=false, geometryProblem=false, clutter=false;
  function seed(polarity){
    const curves=new cv.MatVector(),hier=new cv.Mat();
    try{
      cv.findContours(mask,curves,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      if(curves.size()>180){clutter=true;return;}
      for(let i=0;i<curves.size();i++){
        const c=curves.get(i),p=new cv.Mat();
        try{
          if(cv.contourArea(c)<.025*w*h)continue;
          const perimeter=cv.arcLength(c,true); cv.approxPolyDP(c,p,.022*perimeter,true);
          if(p.rows!==4||!cv.isContourConvex(p))continue;
          const q=ordered(Array.from({length:4},(_,j)=>[p.data32S[j*2],p.data32S[j*2+1]]));
          if(!plausible(q,w,h))continue;
          const {edges,bridgeSide}=getCardEdges(gray,w,h,q,polarity);
          if(edges.some(e=>!e)){
            edgeProblem=true;
            if(preview && provisional.length<3){
              const wide=q.map((pt,j)=>sampleEdge(gray,w,h,pt,q[(j+1)%4],true,polarity));
              if(wide.every(Boolean)){
                const candidate=q.map((_,j)=>crossLines(wide[(j+3)%4],wide[j]));
                if(candidate.every(Boolean)&&plausible(candidate,w,h)){
                  const homography=homographyFrom4(PLANE,candidate);
                  if(homography&&perimeterSupported(gray,w,h,homography,polarity)&&
                    !provisional.some(prior=>maxDelta(align(candidate,prior),prior)<3))
                    provisional.push(candidate);
                }
              }
            }
            continue;
          }
          const fit=q.map((_,j)=>crossLines(edges[(j+3)%4],edges[j]));
          if(fit.some(pt=>!pt)||!plausible(fit,w,h)){geometryProblem=true;continue;}
          const H=homographyFrom4(PLANE,fit);
          if(!H){geometryProblem=true;continue;}
          if(!perimeterSupported(gray,w,h,H,polarity,bridgeSide)){edgeProblem=true;continue;}
          if(!found.some(prior=>maxDelta(align(fit,prior.quad),prior.quad)<2))
            found.push({quad:fit,H,polarity,bridgeSide,lines:edges,rmsPx:Math.max(...edges.map(e=>e.rms))});
        }finally{c.delete();p.delete();}
      }
    }finally{curves.delete();hier.delete();}
  }
  try{
    input.data.set(gray); cv.GaussianBlur(input,smooth,new cv.Size(3,3),0);
    const otsu=cv.threshold(smooth,mask,0,255,cv.THRESH_BINARY_INV|cv.THRESH_OTSU);
    seed(1);
    if(Number.isFinite(otsu)){
      cv.threshold(smooth,mask,otsu,255,cv.THRESH_BINARY);
      seed(-1);
    }
    // Retry bounded luminance masks only if the complementary primary seeds
    // found no trustworthy geometry. Genuine competing rectangles veto size.
    if(!found.length&&!clutter&&Number.isFinite(otsu)){
      for(const bias of [-20,20]){
        const k=Math.max(5,Math.min(240,otsu+bias));
        if(k===otsu)continue;
        cv.threshold(smooth,mask,k,255,cv.THRESH_BINARY_INV); seed(1);
        cv.threshold(smooth,mask,k,255,cv.THRESH_BINARY); seed(-1);
      }
    }
    if(found.length>1)return {card:false,code:'CARD_AMBIGUOUS'};
    if(clutter)return {card:false,code:'CARD_CLUTTER'};
    if(!found.length)return {card:false,code:provisional.length>1?'CARD_AMBIGUOUS':geometryProblem?'CARD_GEOMETRY':edgeProblem?'CARD_EDGE_UNCLEAR':'NO_CARD',
      ...(provisional.length===1?{hint:provisional[0]}:{})};
    return {card:true,...found[0]};
  }finally{input.delete();smooth.delete();mask.delete();}
}
const cardCenter=[CARD_LONG_MM/2,CARD_SHORT_MM/2];
const gap = c => Math.hypot(Math.max(0,-c.cx,c.cx-CARD_LONG_MM),Math.max(0,-c.cy,c.cy-CARD_SHORT_MM))-c.r;
export const CARD_HELP = {
  CARD_NOT_CONFIRMED: 'Confirm you’re using a standard bank-size card.',
  NO_CARD: 'No full card outline found. Use a plain surface that clearly contrasts with the card. Keep all four edges in view.',
  CARD_CLUTTER: 'Use a plain matte surface with only the card and ring in view.',
  CARD_AMBIGUOUS: 'Keep only one card in the camera view.',
  CARD_EDGE_UNCLEAR: 'Card edges aren’t clear enough to measure. Lay the card flat on a contrasting surface and avoid shadows or glare.',
  CARD_BRIDGE_UNCERTAIN: 'The weak card edge leaves too much uncertainty. Change the light or use another card.',
  CARD_GEOMETRY: 'Move the camera directly above the objects.',
  CARD_PERSPECTIVE: 'Level the phone directly above the ring and card.',
  CARD_RESOLUTION: 'The camera image is too small for a reliable estimate. Try a high-resolution rear camera in good light, or measure on screen.',
  CARD_TOO_CLOSE: 'Move the phone a little farther back. Keep both objects in view.',
  RING_NOT_CLEAR: 'Show one flat ring beside the card, with the surface visible through it.',
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
    const card=detectCard(cv,gray,cw,ch,{preview});
    if(!card.card)return fail(card.code,card.hint?{overlay:{cardHint:card.hint.map(p=>[p[0]/kx,p[1]/ky])}}:{});
    // If downsampled, refit virtual corners on full-resolution straight edge samples.
    let q=card.quad.map(p=>[p[0]/kx,p[1]/ky]), rmsPx=card.rmsPx, bridgeSide=card.bridgeSide, lines=card.lines;
    if(ratio<1){
      const {edges:e,bridgeSide:side}=getCardEdges(fullGray,w,h,q,card.polarity);
      if(bridgeSide>=0&&side>=0&&side!==bridgeSide)return fail('CARD_EDGE_UNCLEAR',{card:true});
      bridgeSide=side; lines=e;
      if(e.some(v=>!v))return fail('CARD_EDGE_UNCLEAR',{card:true});
      q=q.map((_,i)=>crossLines(e[(i+3)%4],e[i]));
      if(q.some(p=>!p)||!plausible(q,w,h))return fail('CARD_EDGE_UNCLEAR',{card:true});
      rmsPx=Math.max(...e.map(v=>v.rms));
    }
    const H=homographyFrom4(PLANE,q);
    if(!H)return fail('CARD_GEOMETRY',{card:true});
    if(ratio<1&&!perimeterSupported(fullGray,w,h,H,card.polarity,bridgeSide))return fail('CARD_EDGE_UNCLEAR',{card:true});
    const geo=localGeometry(H,...cardCenter), pose=approxPose(H,w,h);
    const base={card:true,reference:'card',overlay:{card:q},checks:{pxPerMm:geo.pxPerMm,tiltDeg:pose.tiltDeg,edgeBridge:bridgeSide>=0}};
    if(!Number.isFinite(pose.heightMm)||pose.tiltDeg>15||geo.tiltDeg>24)return fail('CARD_PERSPECTIVE',base);
    if(geo.pxPerMm<(preview?2.0:4.0))return fail('CARD_RESOLUTION',base);
    // Focal-length estimate is heuristic; cannot correct height/unknown distortion.
    if(pose.heightMm<170)return fail('CARD_TOO_CLOSE',base);
    const Hsc=mul3(invert3(H),[1/kx,0,0,0,1/ky,0,0,0,1]);
    // A light card requires a darker surface. Normalize that scene's ring and
    // surface to the existing dark-on-light detector without changing geometry.
    const inverted=card.polarity===-1?new cv.Mat():null;
    let candidates;
    try{
      if(inverted)cv.bitwise_not(small,inverted);
      candidates=findHoleCandidates(cv,inverted??small,Hsc,geo.pxPerMm*Math.sqrt(kx*ky),{chroma:0},undefined,{
        origin:cardCenter, radius:105, mask:[-3,-3,CARD_LONG_MM+3,CARD_SHORT_MM+3]
      }).filter(c=>gap(c)>=4 && gap(c)<40);
    }finally{inverted?.delete();}
    if(candidates.length!==1)return fail(candidates.length?'RING_AMBIGUOUS':'RING_NOT_CLEAR',base);
    const ring=candidates[0], ringGeo=localGeometry(H,ring.cx,ring.cy);
    const [x,y]=applyH(H,ring.cx,ring.cy);
    const outline=c=>Array.from({length:80},(_,i)=>{const a=i/40*Math.PI;return applyH(H,c.cx+Math.cos(a)*c.r,c.cy+Math.sin(a)*c.r);});
    if(Math.abs(x-w/2)>.28*w||Math.abs(y-h/2)>.28*h)return fail('RING_OFF_CENTRE',{
      ...base,...(preview?{overlay:{...base.overlay,inner:outline(ring)}}:{})
    });
    let bridgeUncertaintyMm=0;
    if(bridgeSide>=0){
      const a=bridgeSide,b=(a+1)%4;
      // Perturb each independently observed endpoint along its adjacent strong
      // edge by the fitted weak line's error band, not arbitrary coordinates.
      const ringPixels=[0,Math.PI/2,Math.PI,1.5*Math.PI].map(theta=>applyH(H,ring.cx+ring.r*Math.cos(theta),ring.cy+ring.r*Math.sin(theta)));
      for(const sa of [-1,1])for(const sb of [-1,1]){
        const q2=q.slice(), weak=lines[a];
        q2[a]=crossLines(lines[(a+3)%4],{...weak,k:weak.k+sa*weak.bandPx});
        q2[b]=crossLines(lines[b],{...weak,k:weak.k+sb*weak.bandPx});
        const shifted=q2.every(Boolean)?homographyFrom4(PLANE,q2):null;
        if(!shifted)return fail('CARD_BRIDGE_UNCERTAIN',base);
        const inv=invert3(shifted);
        if(!inv)return fail('CARD_BRIDGE_UNCERTAIN',base);
        const rect=ringPixels.map(p=>applyH(inv,...p));
        bridgeUncertaintyMm=Math.max(bridgeUncertaintyMm,...[0,1].map(j=>Math.abs(dist(rect[j],rect[j+2])-2*ring.r)));
      }
      if(!Number.isFinite(bridgeUncertaintyMm)||bridgeUncertaintyMm>.35)return fail('CARD_BRIDGE_UNCERTAIN',base);
    }
    if(preview)return {status:'preview',...base,overlay:{...base.overlay,inner:outline(ring)},ring:true,guideDiameterMm:2*ring.r};
    const f=refineInnerBoundary(card.polarity===-1?fullGray.map(v=>255-v):fullGray,w,h,H,ring,ringGeo.pxPerMm);
    if(!f.ok||f.inlierFrac<.68||f.gapDeg>110||f.rmsMm>.12)return fail('RING_BOUNDARY',base);
    const c=f.circle,d=2*c.r;
    if(d<12||d>26||gap(c)<4)return fail('RING_RANGE',base);
    // Bounded prototype uncertainty only. Never promise clinical or jeweler-grade precision.
    const u=Math.max(.50,Math.hypot(d*4/pose.heightMm, d*rmsPx/(CARD_SHORT_MM*geo.pxPerMm)*3,
      d*.002, d*.0008*pose.tiltDeg, f.rmsMm*3, .5/ringGeo.pxPerMm, bridgeUncertaintyMm));
    return {status:'ok',...base,ring:true,overlay:{...base.overlay,inner:outline(c)},diameterMm:d,uncertaintyMm:u};
  }finally{rgba.delete();if(small!==rgba)small.delete();}
}
