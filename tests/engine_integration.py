"""Run against a compiled local engine: python tests/engine_integration.py /path/to/binary.
Run --no-browser; does not test native window rendering or public site networking.
"""
from pathlib import Path
import sys, subprocess, tempfile, urllib.request, json, time, socket
binary=Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix='rda-run-') as root:
 root=Path(root);data=root/'프로필 폴더';cwd=root/'빈 폴더';cwd.mkdir();data.mkdir()
 occupied=socket.socket();occupied.bind(('127.0.0.1',0));occupied.listen();port=occupied.getsockname()[1]
 p=subprocess.Popen([str(binary),'--no-browser','--port',str(port),'--data-dir',str(data)],cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 try:
  def ready():
   for _ in range(70):
    if (data/'address.txt').exists():return (data/'address.txt').read_text().rstrip('/')
    if p.poll() is not None:raise RuntimeError(p.communicate()[0])
    time.sleep(.1)
   raise TimeoutError('engine readiness')
  address=ready();get=lambda path:urllib.request.urlopen(address+path,timeout=3)
  config=json.load(get('/api/config'));assert config['mode']=='single-exe'
  assert int(address.rsplit(':',1)[1])!=port
  assert '연구의 소식'.encode() in get('/').read()
  assert len(get('/assets/NanumGothic-Bold.ttf').read())>1000000
  assert len(get('/vendor/pdf.worker.mjs').read())>100000
  assert len(get('/vendor/ocr/worker.min.js').read())>100000
  assert len(get('/vendor/ocr/lang/kor.traineddata.gz').read())>1000000
  assert len(get('/vendor/ocr/lang/eng.traineddata.gz').read())>1000000
  assert len(get('/vendor/ocr/core/tesseract-core-lstm.wasm.js').read())>1000000
  req=lambda path,body:urllib.request.Request(address+path,data=json.dumps(body,ensure_ascii=False).encode(),headers={'Content-Type':'application/json','X-RDA-Token':config['token']})
  project={
   'schema':'rdascraper-project','version':64,'savedAt':int(time.time()*1000),
   'start':'2026-09-01','end':'2026-09-30','duration':14,
   'mode':'8','ocrMode':'auto','sources':['naver'],'queries':'합성 검증',
   'demo':False,'reset':False,
   'press':{'title':'합성 문서 저장 검증','text':'한글 자동 저장 합성 검증 본문',
            'keywords':['합성','검증'],'activeKeywords':['합성','검증'],
            'queries':['합성 검증'],'warnings':[]},'results':[]
  }
  assert json.load(urllib.request.urlopen(req('/api/project',project)))['ok']
  second=subprocess.run([str(binary),'--no-browser','--data-dir',str(data)],cwd=cwd,capture_output=True,timeout=6)
  assert second.returncode==0 and p.poll() is None
  assert json.load(urllib.request.urlopen(req('/api/shutdown',{})))['ok'];p.wait(timeout=5)
  assert p.returncode==0 and not (data/'address.txt').exists()
  p=subprocess.Popen([str(binary),'--no-browser','--port','0','--data-dir',str(data)],cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
  address=ready();config=json.load(get('/api/config'))
  saved=json.load(urllib.request.urlopen(urllib.request.Request(address+'/api/project',headers={'X-RDA-Token':config['token']})))
  assert saved['project']['version']==64
  assert saved['project']['press']['title']==project['press']['title']
  assert saved['project']['press']['text']==project['press']['text']
  assert saved['project']['queries']==project['queries']
  assert saved['project']['results']==[]
  urllib.request.urlopen(req('/api/shutdown',{})).read();p.wait(timeout=5)
  print('PASS: empty working folder; embedded assets; Unicode data folder; occupied-port fallback; duplicate launch; strict schema 64 disk save; shutdown; restart restores Korean document title and text')
  print('Scope: compiled Linux engine, local loopback only; no native Windows rendering or public news networking test.')
 finally:
  occupied.close()
  if p.poll() is None:p.terminate();p.wait(timeout=5)
