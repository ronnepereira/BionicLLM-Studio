"""MCP stdio bridge for BionicLLM Studio's authenticated local task gateway."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import urllib.error

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
EXE = Path(os.environ.get('BIONICLLM_EXE', ROOT / 'src-tauri/target/release/BionicLLM Studio.exe'))
DATA = Path(os.environ.get('APPDATA', Path.home())) / 'BionicLLM Studio'
BASE = 'http://127.0.0.1:17863'
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def start():
    try:
        OPENER.open(BASE + '/health', timeout=1).close()
        return
    except (OSError, urllib.error.URLError):
        pass
    subprocess.Popen([str(EXE), '--agent-service'], cwd=EXE.parent,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    for _ in range(90):
        try:
            OPENER.open(BASE + '/health', timeout=1).close()
            return
        except (OSError, urllib.error.URLError):
            time.sleep(1)
    raise RuntimeError('BionicLLM Studio não iniciou a API local.')


def request(path, method='GET', body=None):
    start()
    token = (DATA / 'agent-token').read_text().strip()
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    for attempt in range(30):
        try:
            with OPENER.open(req, timeout=30) as result:
                return json.load(result)
        except urllib.error.HTTPError as error:
            if error.code == 401 and attempt < 29:
                time.sleep(1)  # the frontend is loading models/settings
                continue
            raise RuntimeError(error.read().decode(errors='replace')) from error


TOOLS = [
    {'name': 'bionic_task', 'description': 'Executa uma tarefa no agente BionicLLM e retorna seu ID.', 'inputSchema': {'type': 'object', 'properties': {'prompt': {'type': 'string'}, 'model': {'type': 'string'}, 'kind': {'type': 'string', 'enum': ['agent', 'chat']}}, 'required': ['prompt']}},
    {'name': 'bionic_status', 'description': 'Consulta andamento, conversa e resultado de uma tarefa.', 'inputSchema': {'type': 'object', 'properties': {'id': {'type': 'string'}}, 'required': ['id']}},
    {'name': 'bionic_cancel', 'description': 'Cancela uma tarefa.', 'inputSchema': {'type': 'object', 'properties': {'id': {'type': 'string'}}, 'required': ['id']}},
    {'name': 'bionic_models', 'description': 'Lista os modelos de texto disponíveis.', 'inputSchema': {'type': 'object', 'properties': {}}},
]

for line in sys.stdin:
    msg = {}
    try:
        msg = json.loads(line)
        if 'id' not in msg:
            continue
        method = msg.get('method')
        if method == 'initialize':
            result = {'protocolVersion': msg.get('params', {}).get('protocolVersion', '2024-11-05'), 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'bionicllm-studio', 'version': '4.0.0'}}
        elif method == 'ping':
            result = {}
        elif method == 'tools/list':
            result = {'tools': TOOLS}
        elif method == 'tools/call':
            params = msg['params']; args = params.get('arguments', {}); name = params['name']
            if name == 'bionic_task':
                value = request('/tasks', 'POST', args)
            elif name in ('bionic_status', 'bionic_cancel'):
                from urllib.parse import quote
                value = request('/tasks/' + quote(args['id'], safe=''), 'DELETE' if name == 'bionic_cancel' else 'GET')
            elif name == 'bionic_models':
                value = request('/v1/models')
            else:
                raise ValueError('Ferramenta desconhecida')
            result = {'content': [{'type': 'text', 'text': json.dumps(value, ensure_ascii=False)}]}
        else:
            print(json.dumps({'jsonrpc': '2.0', 'id': msg['id'], 'error': {'code': -32601, 'message': 'Método desconhecido'}}), flush=True)
            continue
        print(json.dumps({'jsonrpc': '2.0', 'id': msg['id'], 'result': result}, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({'jsonrpc': '2.0', 'id': msg.get('id') if isinstance(msg, dict) else None, 'error': {'code': -32000, 'message': str(error)}}, ensure_ascii=False), flush=True)
