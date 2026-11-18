import {readFileSync,writeFileSync} from 'node:fs'
const root=new URL('./',import.meta.url)
let code=readFileSync(new URL('preview-face-only.js',root),'utf8')
const start=code.indexOf('window.renderWirePreview=')
if(start<0)throw new Error('Preview renderer not found')
code=code.slice(0,start)+`
canvas.width=720;canvas.height=840
window.renderFrontPreview=(seconds=0)=>{
 ctx.fillStyle='#03090c';ctx.fillRect(0,0,720,840)
 const glow=ctx.createRadialGradient(360,390,30,360,390,500)
 glow.addColorStop(0,'#09212b');glow.addColorStop(1,'#03090c')
 ctx.fillStyle=glow;ctx.fillRect(0,0,720,840)
 const yaw=Math.sin(seconds/6*Math.PI*2)*.13
 drawHead(360,405,29,yaw)
 ctx.textAlign='center';ctx.fillStyle='#9edee9';ctx.font='13px system-ui'
 ctx.fillText('BIONICLLM · PRÉVIA DE MOVIMENTO 3D',360,30)
 ctx.fillStyle='#6aafc0';ctx.font='12px system-ui'
 ctx.fillText('Rotação suave da malha · somente face',360,797)
 return yaw
}
window.renderFrontPreview(0)
window.previewReady=true
`
writeFileSync(new URL('preview-front-motion.js',root),code,'utf8')
