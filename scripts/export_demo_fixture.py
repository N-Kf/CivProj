"""Export only freshly generated fictional seed data for the browser-only preview."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from tempfile import TemporaryDirectory

root = Path(__file__).resolve().parents[1]
with TemporaryDirectory(prefix='civproj-fictional-demo-') as temp:
    database = str(Path(temp) / 'demo.sqlite3')
    subprocess.run([sys.executable, '-m', 'app.seed', '--demo'], cwd=root / 'backend',
                   env={**os.environ, 'CIVPROJ_DB': database}, check=True, stdout=subprocess.DEVNULL)
    con = sqlite3.connect(database)
    con.row_factory = sqlite3.Row
    fixture = {'users': [dict(row) for row in con.execute('SELECT id,name,email FROM users')]}
    for table in ('tenants', 'memberships', 'projects', 'project_access', 'budgets', 'entries', 'audit'):
        fixture[table] = [dict(row) for row in con.execute(f'SELECT * FROM {table}')]
    for row in fixture['audit']:
        row['detail'] = json.loads(row['detail'])
    con.close()
    output = root / 'frontend/src/demo-fixture.json'
    output.write_text(json.dumps(fixture, ensure_ascii=False, separators=(',', ':')) + '\n')
    print('Exported fictional demo only; passwords, sessions, and development data excluded.')
