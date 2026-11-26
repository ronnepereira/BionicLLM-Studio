import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const bridge = path.resolve('src-tauri/resources/remotion/bridge.mjs');
let root, child, sequence = 0;
const pending = new Map();
function call(name, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`timeout ${name}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, name, args }) + '\n');
  });
}
async function wait(job) {
  while (job.status === 'running') { await new Promise(r => setTimeout(r, 40)); job = await call('remotion_job_status', { jobId: job.id }); }
  return job;
}
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bionic-remotion-'));
  for (const dir of ['src','public','node_modules/remotion','node_modules/@remotion/cli','node_modules/@remotion/renderer']) fs.mkdirSync(path.join(root, dir), { recursive:true });
  for (const name of ['remotion','@remotion/cli','@remotion/renderer']) fs.writeFileSync(path.join(root, 'node_modules', name, 'package.json'), JSON.stringify({ version:'4.0.546' }));
  fs.writeFileSync(path.join(root, 'src/Root.tsx'), 'original user content');
  fs.writeFileSync(path.join(root,'node_modules/@remotion/cli/remotion-cli.js'), `
    const fs = require('fs'), args = process.argv.slice(2);
    if(args[0] === 'studio') { console.log('Server ready - Local: http://localhost:31337'); setInterval(()=>{},1000); }
    else if(args[0] === 'compositions') { console.log('MyComp 30 fps 1280x720 60 frames'); }
    else if(args.some(a=>a.includes('slow'))) { console.log('Rendered 1/100'); setInterval(()=>{},1000); }
    else { fs.writeFileSync(args[2], 'test media'); console.log('Rendered 60/60'); }
  `);
  child = spawn(process.execPath, [bridge, root], { stdio:['pipe','pipe','inherit'] });
  readline.createInterface({ input:child.stdout }).on('line', line => {
    const message = JSON.parse(line), request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(message.id);
    if(message.error) request.reject(Error(message.error)); else request.resolve(message.result);
  });
});
after(async () => { if(child) { await call('shutdown'); child.stdin.end(); await new Promise(r=>child.once('exit',r)); } assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir())); assert.match(path.basename(root),/^bionic-remotion-/); fs.rmSync(root, { recursive:true, force:true }); });

test('reads the installed version, bundled references, source and sha256', async () => {
  assert.equal((await call('remotion_status')).version, '4.0.546');
  const guide = await call('remotion_guide'); assert.equal(guide.version,'4.0.528'); assert.match(guide.content,/remotion-create/);
  assert.match((await call('remotion_guide',{resource:'remotion-create/REFERENCE.md'})).content,/Scaffold/);
  assert.ok((await call('remotion_files')).files.some(f=>f.path==='src/Root.tsx'));
  assert.match((await call('remotion_read',{path:'src/Root.tsx'})).sha256,/^[a-f0-9]{64}$/);
});
test('refuses stale edits, preserves the user file, then backs up an authorized edit',async()=>{
  const before = await call('remotion_read',{path:'src/Root.tsx'});
  await assert.rejects(call('remotion_write',{path:'src/Root.tsx',content:'bad'}),/sha256/);
  assert.equal(fs.readFileSync(path.join(root,'src/Root.tsx'),'utf8'),before.content);
  const saved = await call('remotion_write',{path:'src/Root.tsx',content:'updated',expectedSha256:before.sha256});
  assert.equal(fs.readFileSync(saved.backup,'utf8'),before.content);
  await assert.rejects(call('remotion_write',{path:'src/Root.tsx',content:'stale',expectedSha256:before.sha256}),/alterado/);
});
test('blocks traversal, secret reads, dependency changes and unknown resources',async()=>{
  for(const name of ['../secret.txt','C:/secret.txt','.env','src/../../secret.ts','node_modules/test.js']) await assert.rejects(call('remotion_read',{path:name}));
  await assert.rejects(call('remotion_write',{path:'package.json',content:'{}'}));
  await assert.rejects(call('remotion_guide',{resource:'../../package.json'}));
});
test('compiles composition listing and verifies a real output file before reporting success',async()=>{
  const listed = await wait(await call('remotion_compositions')); assert.equal(listed.status,'completed'); assert.match(listed.log,/MyComp/);
  const rendered = await wait(await call('remotion_render',{composition:'MyComp',filename:'test.png',still:true}));
  assert.equal(rendered.status,'completed'); assert.ok(fs.statSync(rendered.output).size>0);
  await assert.rejects(call('remotion_render',{composition:'MyComp',filename:'test.png',still:true}),/já existe/);
  await assert.rejects(call('remotion_render',{composition:'MyComp',filename:'../escape.mp4'}));
});
test('copies user media without overwriting existing assets',async()=>{
  const source=path.join(root,'source.png');fs.writeFileSync(source,'image');
  assert.equal((await call('remotion_import_asset',{source})).staticFile,'source.png');
  await assert.rejects(call('remotion_import_asset',{source}));
  await assert.rejects(call('remotion_import_asset',{source,filename:'../../outside.png'}));
});
test('reuses the plugin preview and cancels only owned operations',async()=>{
  let job=await call('remotion_preview');
  for(let i=0;i<40&&!job.url;i++){await new Promise(r=>setTimeout(r,40));job=await call('remotion_job_status',{jobId:job.id});}
  assert.equal(job.url,'http://localhost:31337'); assert.equal((await call('remotion_preview')).id,job.id);
  assert.equal((await call('remotion_cancel',{jobId:job.id})).status,'cancelled');
  const slow=await call('remotion_render',{composition:'MyComp',filename:'slow.mp4',props:{slow:true}});
  await assert.rejects(call('remotion_compositions'),/em andamento/);
  assert.equal((await call('remotion_cancel',{jobId:slow.id})).status,'cancelled');
});
