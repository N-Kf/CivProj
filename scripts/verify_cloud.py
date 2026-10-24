"""Smoke-test a built cloud image, including persistence, using disposable data.

Usage: python scripts/verify_cloud.py [image-tag]
Requires Docker. Never points at the application's development database.
"""
import http.client
import json
import re
import secrets
import subprocess
import sys
import time
from uuid import uuid4

image = sys.argv[1] if len(sys.argv) > 1 else 'civproj:cloud'
suffix = uuid4().hex[:12]
container = f'civproj-test-{suffix}'
volume = f'civproj-test-data-{suffix}'
public_url = 'https://cloud-test.example'
cookie = ''


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


def request(path, body=None, origin=public_url):
    con = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    headers = {'Origin': origin, 'Content-Type': 'application/json'}
    if cookie:
        headers['Cookie'] = cookie
    con.request('GET' if body is None else 'POST', path,
                None if body is None else json.dumps(body), headers)
    response = con.getresponse()
    status, response_headers, content = response.status, dict(response.getheaders()), response.read()
    con.close()
    return status, {k.lower(): v for k, v in response_headers.items()}, content


def ready():
    for _ in range(100):
        try:
            if request('/api/health')[0] == 200:
                return
        except (OSError, http.client.HTTPException):
            pass
        time.sleep(.1)
    raise RuntimeError('Cloud container failed its health check')


try:
    docker('volume', 'create', volume)
    docker('run', '-d', '--name', container, '-p', '127.0.0.1::10000',
           '-v', f'{volume}:/var/data', '-e', f'RENDER_EXTERNAL_URL={public_url}', image)
    port = int(docker('port', container, '10000/tcp').split(':')[-1])
    ready()
    status, headers, html = request('/')
    assert status == 200 and 'text/html' in headers['content-type']
    assert "frame-ancestors 'none'" in headers['content-security-policy']
    asset = re.search(r'src="(/assets/[^\"]+\.js)"', html.decode()).group(1)
    assert request(asset)[0] == 200
    assert request('/api/does-not-exist')[0] == 404
    assert request('/api/auth/register', {}, 'https://untrusted.example')[0] == 403
    status, headers, _ = request('/api/auth/register', {
        'name': 'Cloud test owner', 'organization': 'Disposable cloud test',
        'email': f'owner-{suffix}@example.test', 'password': secrets.token_urlsafe(24),
    })
    assert status == 201
    assert all(flag in headers['set-cookie'].lower() for flag in ('secure', 'httponly', 'samesite=lax'))
    # Transport is local HTTP for this container check; manually forward the
    # cookie to test server-side persistence. HTTPS is verified after hosting.
    cookie = headers['set-cookie'].split(';')[0]
    status, _, body = request('/api/me')
    assert status == 200
    tenant = json.loads(body)['tenants'][0]['id']
    status, _, _ = request(f'/api/tenants/{tenant}/projects', {
        'name': 'Restart persistence test', 'client': 'Test customer', 'currency': 'AED',
    })
    assert status == 201
    uid = docker('exec', container, 'python', '-c',
                 "print(next(line for line in open('/proc/1/status') if line.startswith('Uid:')).strip())")
    assert set(uid.split()[1:]) == {'10001'}, uid
    docker('restart', container)
    port = int(docker('port', container, '10000/tcp').split(':')[-1])
    ready()
    status, _, body = request(f'/api/tenants/{tenant}/projects')
    assert status == 200 and json.loads(body)[0]['name'] == 'Restart persistence test'
    print('PASS: built UI/assets, API, trusted origin, secure cookie flags, non-root process, and database/session persistence after restart.')
except Exception:
    subprocess.run(['docker', 'logs', '--tail', '50', container])
    raise
finally:
    subprocess.run(['docker', 'rm', '-f', container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['docker', 'volume', 'rm', volume], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
