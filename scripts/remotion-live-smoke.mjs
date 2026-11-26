import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
const root=path.resolve(process.argv[2]||'C:/RemotionApp');
const video=process.argv[4]==='video';
const bridge=path.resolve('src-tauri/resources/remotion/bridge.mjs');
const child=spawn(process.execPath,[bridge,root],{stdio:['pipe','pipe','inherit']});
const pending=new Map();let seq=0;
readline.createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line),p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);});
function call(name,args={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error(`timeout: ${name}`)),20000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,name,args})+'\n');});}
async function wait(job,preview=false){for(let i=0;i<240;i++){if(job.status!=='running'||(preview&&job.url))return job;await new Promise(r=>setTimeout(r,1000));job=await call('remotion_job_status',{jobId:job.id});if(i%20===0)console.log(JSON.stringify({kind:job.kind,status:job.status,progress:job.progress,tail:job.log.slice(-300)}));}await call('remotion_cancel',{jobId:job.id});throw Error('Operation did not finish in four minutes.');}
function sourceHash(){const hash=crypto.createHash('sha256');function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(item.isFile())hash.update(path.relative(root,file)).update(fs.readFileSync(file));}}walk(path.join(root,'src'));return hash.digest('hex');}
const before=sourceHash();
try{
 const status=await call('remotion_status');console.log(JSON.stringify(status));
 const listed=await wait(await call('remotion_compositions'));console.log(JSON.stringify({compositions:listed}));if(listed.status!=='completed')throw Error(listed.log);
 const preview=await wait(await call('remotion_preview'),true);if(!preview.url)throw Error(preview.log);
 const response=await fetch(preview.url);const html=await response.text();if(!response.ok||!html.toLowerCase().includes('remotion'))throw Error('Preview page was not Remotion.');
 const render=await wait(await call('remotion_render',{composition:process.argv[3]||'MyComp',filename:`bionic-smoke-${Date.now()}.${video?'mp4':'png'}`,still:!video,frame:0}));
 if(render.status!=='completed')throw Error(render.log);
 const result={status,compositionsLog:listed.log,preview:{url:preview.url,http:response.status,owned:preview.owned},render,sourceUnchanged:before===sourceHash()};
 fs.writeFileSync(`docs/remotion-live-${video?'video-':''}smoke-2026-11-24.json`,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({output:render.output,bytes:fs.statSync(render.output).size,sourceUnchanged:result.sourceUnchanged,preview:preview.url}));
}finally{await call('shutdown').catch(()=>{});child.stdin.end();}
