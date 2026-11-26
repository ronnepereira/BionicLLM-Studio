// BionicLLM's local bridge. Uses the existing project and its local CLI only.
// stdout is reserved for line-delimited JSON replies to the native host.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fs.realpathSync(process.argv[2]);
const base = path.dirname(fileURLToPath(import.meta.url));
const guides = JSON.parse(fs.readFileSync(path.join(base, 'guides.json'), 'utf8'));
const cli = path.join(root, 'node_modules/@remotion/cli/remotion-cli.js');
const jobs = new Map();
let preview;
let closing = false;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
const textExtensions = new Set(['.tsx', '.ts', '.jsx', '.js', '.css', '.scss', '.json', '.srt', '.vtt', '.txt', '.md', '.svg']);

function resolveFile(relative, write = false) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\0') || relative.includes(':')) throw Error('Use um caminho relativo ao projeto Remotion.');
  const target = path.resolve(root, relative);
  if (!inside(root, target) || relative.split(/[\\/]/).some(p => p === '..' || p.startsWith('.'))) throw Error('Caminho fora das pastas permitidas.');
  const rel = path.relative(root, target).replaceAll('\\', '/');
  if (!/^(src\/|public\/|package\.json$|remotion\.config\.[cm]?[jt]s$|tsconfig\.json$)/.test(rel) || !textExtensions.has(path.extname(target).toLowerCase())) throw Error('Leia src/public ou os arquivos de configuração. Edite somente arquivos de texto em src/public.');
  if (write && !/^(src|public)\//.test(rel)) throw Error('O plugin não altera dependências nem configurações do projeto.');
  let current = target;
  while (!fs.existsSync(current)) current = path.dirname(current);
  if (!inside(root, fs.realpathSync(current))) throw Error('Links para fora do projeto não são permitidos.');
  return target;
}
function files() {
  const results = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (results.length >= 400 || entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (!inside(root, fs.realpathSync(full))) continue;
      if (entry.isDirectory()) walk(full);
      else results.push({ path: path.relative(root, full).replaceAll('\\', '/'), bytes: fs.statSync(full).size });
    }
  }
  walk(path.join(root, 'src')); walk(path.join(root, 'public'));
  return { root, files: results, limit: 400 };
}
function status() {
  const version = name => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  const versions = Object.fromEntries(['remotion', '@remotion/cli', '@remotion/renderer'].map(name => [name, version(name)]));
  if (new Set(Object.values(versions)).size !== 1) throw Error('Os pacotes Remotion instalados têm versões diferentes. Confira o projeto antes de executar.');
  if (!fs.existsSync(cli)) throw Error('CLI do Remotion não encontrada neste projeto.');
  return { root, version: versions.remotion, versions, node: process.version, guideVersion: guides.version, preview: preview ? publicJob(preview) : null, outputDirectory: path.join(root, 'out') };
}
function publicJob(job) {
  return { id: job.id, kind: job.kind, status: job.status, url: job.url, output: job.output, exitCode: job.exitCode, log: job.log, progress: job.progress, owned: job.owned };
}
function stopChild(job) {
  if (!job.child || !['running', 'starting'].includes(job.status)) return;
  job.status = 'cancelled';
  // Kill only this bridge's child tree, never the user's existing Studio.
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(job.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(-job.child.pid, 'SIGTERM'); } catch { job.child.kill('SIGTERM'); } }
}
function startJob(kind, args, output) {
  if (closing) throw Error('Plugin desligando.');
  if (kind !== 'preview' && [...jobs.values()].some(j => j.kind !== 'preview' && ['running', 'starting'].includes(j.status))) throw Error('Já existe uma operação Remotion em andamento. Aguarde ou cancele antes de iniciar outra.');
  status();
  const child = spawn(process.execPath, [cli, ...args], { cwd: root, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const job = { id: crypto.randomUUID(), kind, child, status: 'running', log: '', output, progress: 0, owned: true };
  jobs.set(job.id, job);
  for (const [id, old] of jobs) if (jobs.size > 40 && !['running', 'starting'].includes(old.status)) jobs.delete(id);
  const consume = bytes => {
    const text = bytes.toString().replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    job.log = (job.log + text).slice(-22000);
    const url = job.log.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/)?.[0];
    if (kind === 'preview' && url) job.url = url;
    const frames = [...job.log.matchAll(/(?:Rendered|Encoded)\s+(\d+)\/(\d+)/g)].at(-1);
    if (frames) job.progress = Math.min(99, Math.round(Number(frames[1]) / Number(frames[2]) * 100));
  };
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  child.on('error', error => { job.status = 'failed'; job.log += '\n' + error.message; });
  child.on('close', code => {
    job.exitCode = code;
    if (job.status === 'cancelled' || job.status === 'failed') return;
    job.status = code === 0 ? 'completed' : 'failed';
    if (kind === 'render' && code === 0 && (!fs.existsSync(output) || fs.statSync(output).size === 0)) {
      job.status = 'failed'; job.log += '\nO comando terminou sem gerar o arquivo de saída.';
    }
    if (kind === 'preview' && job.url && code === 0) job.owned = false; // CLI reused an existing Studio.
    if (job.status === 'completed') job.progress = 100;
  });
  return job;
}
function outputPath(value, extension) {
  const relative = value || `bionic-${Date.now()}${extension}`;
  if (typeof relative !== 'string' || !/^[\w -]+\.(mp4|webm|png|jpeg)$/.test(relative)) throw Error('Use apenas um nome de arquivo em out/, por exemplo video.mp4.');
  const dir = path.join(root, 'out'); fs.mkdirSync(dir, { recursive: true });
  if (!inside(root, fs.realpathSync(dir))) throw Error('A pasta out aponta para fora do projeto.');
  const target = path.join(dir, relative);
  if (fs.existsSync(target)) throw Error('Este arquivo já existe. Escolha outro nome para preservar a exportação anterior.');
  return target;
}
async function dispatch(name, args = {}) {
  switch (name) {
    case 'remotion_status': return status();
    case 'remotion_files': return files();
    case 'remotion_read': {
      const target = resolveFile(args.path);
      if (fs.statSync(target).size > 1024 * 1024) throw Error('Arquivo muito grande para leitura textual (limite 1 MB).');
      const bytes = fs.readFileSync(target);
      return { path: args.path, sha256: hash(bytes), content: bytes.toString('utf8') };
    }
    case 'remotion_write': {
      const target = resolveFile(args.path, true);
      if (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 1024 * 1024 || args.content.includes('\0')) throw Error('Informe conteúdo textual de até 1 MB.');
      let backup;
      if (fs.existsSync(target)) {
        const bytes = fs.readFileSync(target);
        if (args.expectedSha256 !== hash(bytes)) throw Error('Leia o arquivo com remotion_read e envie o sha256 retornado em expectedSha256. O arquivo pode ter sido alterado pelo usuário.');
        const backupDir = path.join(root, '.bionic-remotion-backups'); fs.mkdirSync(backupDir, { recursive: true });
        if (!inside(root, fs.realpathSync(backupDir))) throw Error('A pasta de backup aponta para fora do projeto.');
        backup = path.join(backupDir, `${Date.now()}-${crypto.randomUUID()}-${path.basename(target)}`);
        fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = target + `.bionic-${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(temporary, args.content, { flag: 'wx' });
      try { fs.renameSync(temporary, target); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      return { saved: true, path: target, sha256: hash(fs.readFileSync(target)), backup };
    }
    case 'remotion_guide': {
      const resource = args.resource || 'SKILL.md';
      if (typeof resource !== 'string' || !Object.hasOwn(guides.files, resource)) throw Error('Referência não encontrada. Use um caminho listado no índice ou nos links relativos.');
      return { version: guides.version, resource, content: guides.files[resource], available: resource === 'SKILL.md' ? Object.keys(guides.files).filter(p => p.endsWith('REFERENCE.md')) : undefined, note: 'Referência do plugin; confira a versão instalada. Scripts de exemplo não são executados automaticamente.' };
    }
    case 'remotion_import_asset': {
      if (typeof args.source !== 'string' || !path.isAbsolute(args.source)) throw Error('Informe o caminho absoluto do arquivo de mídia fornecido pelo usuário.');
      const source = fs.realpathSync(args.source), stat = fs.statSync(source);
      const filename = args.filename || path.basename(source);
      if (typeof filename !== 'string' || filename.startsWith('.') || filename.includes(':') || /[\\/\0]/.test(filename)) throw Error('Use um nome de arquivo sem pastas.');
      const allowed = new Set(['.png','.jpg','.jpeg','.webp','.gif','.svg','.mp4','.mov','.webm','.mp3','.wav','.ogg','.m4a','.srt','.vtt','.woff','.woff2','.ttf']);
      if (!allowed.has(path.extname(source).toLowerCase()) || path.extname(source).toLowerCase() !== path.extname(filename).toLowerCase() || !stat.isFile() || stat.size > 1024 * 1024 * 1024) throw Error('Aceita mídia, legendas ou fontes de até 1 GB, preservando a extensão.');
      const dir = path.join(root, 'public'); fs.mkdirSync(dir, { recursive: true });
      if (!inside(root, fs.realpathSync(dir))) throw Error('A pasta public aponta para fora do projeto.');
      const target = path.join(dir, filename);
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      return { imported: true, path: target, staticFile: filename, bytes: stat.size };
    }
    case 'remotion_compositions': return publicJob(startJob('compositions', ['compositions', '--log=info']));
    case 'remotion_preview': {
      if (preview && preview.status === 'running') return publicJob(preview);
      preview = startJob('preview', ['studio', '--no-open', '--log=info']);
      return publicJob(preview);
    }
    case 'remotion_render': {
      if (typeof args.composition !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(args.composition)) throw Error('Informe o ID exato da composição, consultado com remotion_compositions.');
      const still = args.still === true;
      const output = outputPath(args.filename, still ? '.png' : '.mp4');
      if (still !== /\.(png|jpeg)$/.test(output)) throw Error('Use png/jpeg para uma imagem ou mp4/webm para um vídeo.');
      const cliArgs = [still ? 'still' : 'render', args.composition, output, '--log=info'];
      if (output.endsWith('.webm')) cliArgs.push('--codec=vp9');
      if (still && args.frame !== undefined) {
        if (!Number.isInteger(args.frame) || args.frame < 0) throw Error('frame deve ser um inteiro positivo ou zero.');
        cliArgs.push(`--frame=${args.frame}`);
      }
      if (args.props !== undefined) {
        const props = typeof args.props === 'string' ? JSON.parse(args.props) : args.props;
        if (!props || Array.isArray(props) || typeof props !== 'object') throw Error('props deve ser um objeto JSON.');
        cliArgs.push(`--props=${JSON.stringify(props)}`);
      }
      return publicJob(startJob('render', cliArgs, output));
    }
    case 'remotion_job_status': {
      const job = jobs.get(args.jobId); if (!job) throw Error('Operação não encontrada nesta sessão.'); return publicJob(job);
    }
    case 'remotion_cancel': {
      const job = jobs.get(args.jobId); if (!job) throw Error('Operação não encontrada nesta sessão.');
      stopChild(job); return publicJob(job);
    }
    case 'shutdown': await shutdown(); return { stopped: true };
    default: throw Error('Ferramenta Remotion desconhecida.');
  }
}
async function shutdown() {
  if (closing) return;
  closing = true;
  for (const job of jobs.values()) stopChild(job);
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', async line => {
  let request;
  try {
    if (line.length > 3 * 1024 * 1024) throw Error('Solicitação muito grande.');
    request = JSON.parse(line);
    const result = await dispatch(request.name, request.args);
    process.stdout.write(JSON.stringify({ id: request.id, result }) + '\n');
    if (request.name === 'shutdown') { input.close(); setTimeout(() => process.exit(0), 300); }
  } catch (error) { process.stdout.write(JSON.stringify({ id: request?.id, error: String(error.message || error) }) + '\n'); }
});
input.on('close', () => { void shutdown().then(() => { setTimeout(() => process.exit(0), 300); }); });
process.on('SIGTERM', () => { void shutdown().then(() => { setTimeout(() => process.exit(0), 300); }); });
