import {createServer} from 'node:http'
import {readFileSync,mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,expect} from 'file:///C:/LU-BIONICLLM-STUDIO-v3/node_modules/@playwright/test/index.mjs'
const root=new URL('./',import.meta.url)
const frames=mkdtempSync(join(tmpdir(),'bionic-wire-motion-'))
const server=createServer((req,res)=>{
 const file={'/':'preview.html','/preview.js':'preview-front-motion.js','/canonical_face_model.obj':'canonical_face_model.obj'}[req.url]
 if(!file){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'text/plain');res.end(readFileSync(new URL(file,root)))
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({channel:'msedge',headless:true})
try{
 const page=await browser.newPage({viewport:{width:720,height:840},deviceScaleFactor:1})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port)
 await expect.poll(()=>page.evaluate(()=>window.previewReady)).toBe(true)
 let maxYaw=-Infinity,minYaw=Infinity
 for(let i=0;i<120;i++){
  const yaw=await page.evaluate(seconds=>window.renderFrontPreview(seconds),i/20)
  maxYaw=Math.max(maxYaw,yaw);minYaw=Math.min(minYaw,yaw)
  await page.screenshot({path:join(frames,String(i).padStart(3,'0')+'.png')})
 }
 expect(errors).toEqual([]);expect(maxYaw).toBeCloseTo(.13);expect(minYaw).toBeCloseTo(-.13)
 console.log(JSON.stringify({frames,maxYaw,minYaw,framesCount:120,fps:20,previewOnly:true,errors}))
}finally{await browser.close();await new Promise(r=>server.close(r))}
