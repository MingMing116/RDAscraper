"""Local process regression: python tests/startup_integration.py NEW_BINARY OLD_BINARY.

Uses isolated temporary profiles and synthetic documents. No public network
requests. Run on Windows to test actual Windows processes; Linux results do not
certify Windows GUI or native mutex behavior.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import tempfile
import time
import urllib.request

new_binary, old_binary = [Path(p).resolve() for p in sys.argv[1:3]]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
processes = []
results = []

def launch(binary, folder):
    p = subprocess.Popen([str(binary), '--no-browser', '--port', '0', '--data-dir', str(folder)],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    processes.append(p)
    return p

def config(folder, process, expected_version=None):
    for _ in range(100):
        if process.poll() is not None:
            raise AssertionError('Server exited during startup')
        try:
            address = (folder / 'address.txt').read_text().strip().rstrip('/')
            with opener.open(address + '/api/config', timeout=.3) as response:
                value = json.load(response)
            if value['app'] == 'RDAscraper' and (expected_version is None or value['version'] == expected_version):
                return address, value
        except (OSError, ValueError):
            pass
        time.sleep(.05)
    raise AssertionError('Local startup timed out')

def request(address, cfg, endpoint, value=None):
    req = urllib.request.Request(address + endpoint,
        data=None if value is None else json.dumps(value, ensure_ascii=False).encode(),
        headers={'Content-Type': 'application/json', 'X-RDA-Token': cfg['token']})
    with opener.open(req, timeout=3) as response:
        return json.load(response)

def stop(address, cfg, process):
    assert request(address, cfg, '/api/shutdown', {})['ok']
    assert process.wait(timeout=5) == 0

record = {'platform': sys.platform, 'nativeWindows': sys.platform == 'win32',
    'scope': 'Real local processes with synthetic saved work; no browser GUI or public news test',
    'newBinarySHA256': hashlib.sha256(new_binary.read_bytes()).hexdigest(),
    'oldBinarySHA256': hashlib.sha256(old_binary.read_bytes()).hexdigest(), 'results': results}
try:
    with tempfile.TemporaryDirectory(prefix='rda-startup-') as root:
        folder = Path(root) / '한글 작업 폴더'; folder.mkdir()
        old = launch(old_binary, folder)
        address, cfg = config(folder, old)
        old_version = cfg['version']
        assert old_version != '65.0.0', 'Supply an older binary for upgrade regression'
        project = {'schema': 'rdascraper-project', 'version': 64, 'savedAt': int(time.time()*1000),
            'start': '2026-09-01', 'end': '2026-09-30', 'duration': 14,
            'mode': '8', 'ocrMode': 'auto', 'sources': ['naver'], 'queries': '합성 검증',
            'demo': False, 'reset': False,
            'press': {'title': '합성 재실행 검증', 'text': '업데이트 뒤에도 보관해야 하는 합성 작업',
                'keywords': ['합성', '검증'], 'activeKeywords': ['합성', '검증'],
                'queries': ['합성 검증'], 'warnings': []}, 'results': []}
        assert request(address, cfg, '/api/project', project)['ok']
        saved_before = (folder / 'last-project.json').read_bytes()
        duplicate = launch(new_binary, folder)
        assert duplicate.wait(timeout=5) == 0 and old.poll() is None
        assert config(folder, old)[1]['version'] == old_version
        assert (folder / 'last-project.json').read_bytes() == saved_before
        results.append({'name': 'Healthy older process accepted without false timeout or saved-work changes', 'status': 'PASS'})

        stop(address, cfg, old)
        new = launch(new_binary, folder)
        address, cfg = config(folder, new, '65.0.0')
        assert request(address, cfg, '/api/project')['project']['press'] == project['press']
        assert (folder / 'last-project.json').read_bytes() == saved_before
        results.append({'name': 'New process starts after old app shutdown and restores saved Korean work', 'status': 'PASS'})

        new.kill(); new.wait(timeout=5)
        assert (folder / 'address.txt').exists()
        restarted = launch(new_binary, folder)
        address, cfg = config(folder, restarted, '65.0.0')
        assert (folder / 'last-project.json').read_bytes() == saved_before
        results.append({'name': 'Abrupt termination with stale address recovers without deleting saved work', 'status': 'PASS'})
        stop(address, cfg, restarted)
        assert not (folder / 'address.txt').exists()

        contenders = [launch(new_binary, folder) for _ in range(6)]
        for _ in range(100):
            alive = [p for p in contenders if p.poll() is None]
            if len(alive) == 1:
                break
            time.sleep(.05)
        assert len(alive) == 1, 'Concurrent launch must leave one engine'
        owner = alive[0]
        address, cfg = config(folder, owner, '65.0.0')
        assert all(p.returncode == 0 for p in contenders if p is not owner)
        assert request(address, cfg, '/api/project')['project']['press'] == project['press']
        results.append({'name': 'Six simultaneous real processes leave exactly one healthy writer', 'status': 'PASS'})
        stop(address, cfg, owner)
        assert not (folder / 'address.txt').exists()
        assert (folder / 'last-project.json').read_bytes() == saved_before
        results.append({'name': 'Normal shutdown removes connection address and preserves saved project bytes', 'status': 'PASS'})
    record['status'] = 'PASS'
finally:
    for p in processes:
        if p.poll() is None:
            p.kill(); p.wait(timeout=5)
    target = Path(__file__).parent / 'artifacts/startup'
    target.mkdir(parents=True, exist_ok=True)
    (target / 'validation.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(record, ensure_ascii=False, indent=2))
