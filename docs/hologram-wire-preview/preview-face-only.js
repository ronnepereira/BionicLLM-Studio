// Preview only. Canonical face mesh: Google MediaPipe, Apache-2.0.
// No photograph/portrait texture is used by this renderer.
const obj = await (await fetch('/canonical_face_model.obj')).text()
const raw = obj.split('\n').filter(s=>s.startsWith('v ')).map(s=>s.split(/\s+/).slice(1).map(Number))
const faces = obj.split('\n').filter(s=>s.startsWith('f ')).map(s=>s.split(/\s+/).slice(1).map(p=>Number(p.split('/')[0])-1))
const gaussian=(x,y,cx,cy,sx,sy)=>Math.exp(-(((x-cx)/sx)**2)-((y-cy)/sy)**2)
const sculpt=([x,y,z])=>{
 for(const side of [-1,1]){
  const eye=gaussian(x,y,side*3.15,2.6,2.1,1.3)
  x+=(x-side*3.15)*.22*eye
  y+=(y-2.6)*.30*eye
 }
 const jaw=Math.max(0,Math.min(1,(-y-1.5)/8))
 x*=.88-.18*jaw
 const nose=gaussian(x,y,0,-.8,1.4,2.5)
 x*=1-.10*nose
 z+=.18*nose+.26*gaussian(x,y,0,-4.4,2.7,.9)
 if(y>4){y=4+(y-4)*1.5;z-=Math.max(0,y-7)*.65}
 // Softer tapered lower face and fuller lip relief, not an ellipsoid mask.
 return [x,y,z]
}
const verts=raw.map(sculpt)
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d')
const outline=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10]
const eyes=[
 {upper:[33,246,161,160,159,158,157,173,133],lower:[133,155,154,153,145,144,163,7,33],brow:[70,63,105,66,107],cx:-3.07},
 {upper:[362,398,384,385,386,387,388,466,263],lower:[263,249,390,373,374,380,381,382,362],brow:[336,296,334,293,300],cx:3.07},
]
const lips=[61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146,61]
const inner=[78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95,78]

function smooth(points,closed=false){
 const out=[]
 for(let i=0;i<points.length-1;i++){
  const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],d=points[Math.min(points.length-1,i+2)]
  for(let n=0;n<6;n++){
   const t=n/6,t2=t*t,t3=t2*t
   out.push(b.map((v,j)=>.5*((2*v)+(-a[j]+c[j])*t+(2*a[j]-5*v+4*c[j]-d[j])*t2+(-a[j]+3*v-3*c[j]+d[j])*t3)))
  }
 }
 out.push(points.at(-1));if(closed)out.push(out[0]);return out
}
function drawHead(cx,cy,scale,yaw,mouth=0,blink=0){
 const pose=([x,y,z])=>{
  const lower=gaussian(x,y,0,-5,3.2,2.7)
  y-=mouth*.62*lower*Math.max(0,Math.min(1,(-y-3.9)/2))
  let rx=x*Math.cos(yaw)+z*Math.sin(yaw),rz=z*Math.cos(yaw)-x*Math.sin(yaw)
  const perspective=1/(1-rz/85)
  return [cx+rx*scale*perspective,cy-y*scale*perspective,rz]
 }
 const line=(points,alpha=.42,weight=.7)=>{
  ctx.beginPath();points.forEach((v,i)=>{const p=pose(v);if(i)ctx.lineTo(p[0],p[1]);else ctx.moveTo(p[0],p[1])})
  ctx.strokeStyle=`rgba(58,222,248,${alpha})`;ctx.lineWidth=weight;ctx.stroke()
 }
 const scalp=[]
 for(let r=0;r<=20;r++){
  const latitude=r/20*Math.PI
  const row=[]
  for(let j=0;j<=48;j++){
   const a=j/48*2*Math.PI
   row.push([7.1*Math.sin(latitude)*Math.sin(a),1.2+10.2*Math.cos(latitude),-1.3+7.3*Math.sin(latitude)*Math.cos(a)])
  }
  scalp.push(row)
 }
 // Back grid first. The anatomical facial surface occludes lines behind it.
 scalp.forEach(row=>line(row,.12,.6))
 for(let j=0;j<=48;j++)line(scalp.map(row=>row[j]),.12,.6)
 // Paint the facial relief as a dark occluding surface, then its real mesh.
 const triangles=faces.map(f=>({f,p:f.map(i=>pose(verts[i]))})).sort((a,b)=>a.p.reduce((s,v)=>s+v[2],0)-b.p.reduce((s,v)=>s+v[2],0))
 for(const {f,p} of triangles){
  const a=verts[f[0]],b=verts[f[1]],c=verts[f[2]]
  const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i])
  const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
  const length=Math.hypot(...normal)||1
  const light=Math.abs((normal[0]*-.45+normal[1]*.35+normal[2]*.82)/length)
  ctx.beginPath();p.forEach((v,i)=>i?ctx.lineTo(v[0],v[1]):ctx.moveTo(v[0],v[1]));ctx.closePath()
  ctx.fillStyle=`rgb(${Math.round(2+light*3)},${Math.round(10+light*13)},${Math.round(14+light*18)})`;ctx.fill()
 }
 const edges=new Set()
 for(const f of faces)for(let i=0;i<3;i++){const a=f[i],b=f[(i+1)%3];edges.add([Math.min(a,b),Math.max(a,b)].join(','))}
 for(const edge of edges){const [a,b]=edge.split(',').map(Number);line([verts[a],verts[b]],.55,.75)}
 // Additional inner subdivision makes the hologram lattice finer, retaining
 // the same sculpted nose, cheek, lip and jaw surfaces.
 for(const f of faces){
  const p=f.map(i=>verts[i]);const mid=p.map((a,i)=>a.map((v,j)=>(v+p[(i+1)%3][j])/2))
  line([...mid,mid[0]],.24,.5)
 }
 line(smooth(outline.map(i=>verts[i])),.76,1.05)
 for(const eye of eyes){
  const corners=[verts[eye.upper[0]],verts[eye.upper.at(-1)]]
  const eyeX=(corners[0][0]+corners[1][0])/2
  const eyeY=(corners[0][1]+corners[1][1])/2
  const upper=eye.upper.map(i=>{const p=[...verts[i]];p[1]-=blink*.5;return p})
  const lower=eye.lower.map(i=>{const p=[...verts[i]];p[1]+=blink*.2;return p})
  // Iris/cornea are independent rings in 3D, not a painted eyeball.
  if(blink<.85){
   for(const radius of [.15,.30,.43]){
    const ring=Array.from({length:41},(_,i)=>{const a=i/40*Math.PI*2;return [eyeX+Math.cos(a)*radius,eyeY+Math.sin(a)*radius*(1-blink),4.00+Math.sqrt(Math.max(0,.46**2-radius**2))]})
    line(ring,.75,.7)
   }
   for(let j=0;j<20;j++){const a=j/20*Math.PI*2;line([[eyeX+Math.cos(a)*.18,eyeY+Math.sin(a)*.18,4.35],[eyeX+Math.cos(a)*.43,eyeY+Math.sin(a)*.43,4.17]],.35,.5)}
  }
  line(smooth(upper),.95,1.15);line(smooth(lower),.8,.9)
  const brow=eye.brow.map(i=>{const p=[...verts[i]];p[1]+=.25;return p})
  line(smooth(brow),.8,1.2)
  line(smooth(brow.map(p=>[p[0],p[1]+.18,p[2]-.05])),.48,.7)
 }
 line(smooth(lips.map(i=>verts[i])),.85,1.0)
 line(smooth(inner.map(i=>verts[i])),.72,.8)
 // Nasal rims emphasize volume while the bridge remains meshed.
 line(smooth([98,97,2,326,327].map(i=>verts[i])),.73,.85)
 for(const [i,p]of verts.entries())if(i%4===0){const v=pose(p);ctx.fillStyle='rgba(115,247,255,.65)';ctx.beginPath();ctx.arc(v[0],v[1],1,0,Math.PI*2);ctx.fill()}
}

window.renderWirePreview=(angle=0)=>{
 ctx.fillStyle='#03090c';ctx.fillRect(0,0,canvas.width,canvas.height)
 const glow=ctx.createRadialGradient(640,420,50,640,420,700);glow.addColorStop(0,'#09212b');glow.addColorStop(1,'#03090c');ctx.fillStyle=glow;ctx.fillRect(0,0,1280,1000)
 ctx.fillStyle='#87d3e0';ctx.font='13px system-ui';ctx.textAlign='center'
 ctx.fillText('BIONICLLM  ·  PRÉVIA DE MALHA 3D',640,42)
 drawHead(315,480,31.5,angle)
 drawHead(945,480,31.5,.38+angle)
 ctx.fillStyle='#b8e5ec';ctx.font='16px system-ui'
 ctx.fillText('Frente',315,875);ctx.fillText('Vista em três quartos',945,875)
 ctx.fillStyle='#5c9cae';ctx.font='12px system-ui';ctx.fillText('Linhas e geometria reais · sem textura fotográfica · ainda não aplicado ao aplicativo',640,966)
}
window.renderWirePreview()
window.previewReady=true
