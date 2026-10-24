"""Initialize the dedicated disk mount, then run the app as an unprivileged user."""
import os
import sys
from pathlib import Path

if os.getuid() == 0:
    data = Path('/var/data')
    data.mkdir(parents=True, exist_ok=True)
    os.chown(data, 10001, 10001)
    os.setgroups([])
    os.setgid(10001)
    os.setuid(10001)

os.execv(sys.executable, [
    sys.executable, '-m', 'uvicorn', 'app.main:app', '--app-dir', '/app/backend',
    '--host', '0.0.0.0', '--port', os.environ.get('PORT', '10000'),
    '--proxy-headers', '--forwarded-allow-ips', '*',
])
