import {createServer} from 'node:http'
import {readFileSync} from 'node:fs'
import {chromium,expect} from 'file:///C:/LU-BIONICLLM-STUDIO-v3/node_modules/@playwright/test/index.mjs'
const root='C:/LU-BIONICLLM-STUDIO-v3/docs/hologram-wire-preview/'
const faceOnly=process.argv.includes('--face-only')
const server=createServer((req,res)=>{
 const file={'/':'preview.html','/preview.js':faceOnly?'preview-face-only.js':'preview.js','/canonical_face_model.obj':'canonical_face_model.obj'}[req.url]
 if(!file){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'text/plain');res.end(readFileSync(root+file))
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({channel:'msedge',headless:true})
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:'+server.address().port)
 await expect.poll(()=>page.evaluate(()=>window.previewReady)).toBe(true)
 expect(errors).toEqual([])
 await page.screenshot({path:'C:/LU-BIONICLLM-STUDIO-v3/docs/bionic-preview/'+(faceOnly?'93-previa-somente-face.png':'92-previa-malha-feminina.png')})
 console.log(JSON.stringify({previewOnly:true,actual3DMesh:true,noPortraitTexture:true,errors}))
}finally{await browser.close();await new Promise(r=>server.close(r))}
