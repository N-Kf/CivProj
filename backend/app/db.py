import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
 password TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships (
 tenant_id TEXT REFERENCES tenants(id), user_id TEXT REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN ('ceo','cfo','cto','manager','accountant','customer')),
 PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE IF NOT EXISTS project_access (
 tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 PRIMARY KEY(tenant_id,project_id,user_id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 name TEXT NOT NULL, client TEXT NOT NULL, currency TEXT NOT NULL,
 location TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS budgets (
 tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, category TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>=0),
 PRIMARY KEY(tenant_id,project_id,category),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS entries (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('commitment','invoice','payment')),
 category TEXT NOT NULL, description TEXT NOT NULL, vendor TEXT NOT NULL,
 reference TEXT NOT NULL, quantity TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'each', unit_price TEXT NOT NULL,
 tax_rate TEXT NOT NULL, retention_rate TEXT NOT NULL,
 net INTEGER NOT NULL CHECK(net>=0), tax INTEGER NOT NULL CHECK(tax>=0),
 amount INTEGER NOT NULL CHECK(amount>0), retention INTEGER NOT NULL CHECK(retention>=0),
 date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 related_id TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 decided_by TEXT REFERENCES users(id), decided_at TEXT,
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,related_id) REFERENCES entries(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS entries_project ON entries(tenant_id,project_id);
CREATE UNIQUE INDEX IF NOT EXISTS entries_reference ON entries(tenant_id,project_id,kind,vendor COLLATE NOCASE,reference COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL REFERENCES tenants(id),
 project_id TEXT, actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL, entity_id TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
 BEGIN SELECT RAISE(ABORT,'Audit records are append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
 BEGIN SELECT RAISE(ABORT,'Audit records are append-only'); END;
"""


def db_path():
    return Path(os.environ.get('CIVPROJ_DB', str(Path(__file__).resolve().parents[1] / 'data/civproj.sqlite3')))


@contextmanager
def connect(write=False):
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    try:
        if write:
            con.execute('BEGIN IMMEDIATE')
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def initialize():
    with connect() as con:
        con.executescript(SCHEMA)
        if 'unit' not in {row['name'] for row in con.execute('PRAGMA table_info(entries)')}:
            con.execute("ALTER TABLE entries ADD COLUMN unit TEXT NOT NULL DEFAULT 'each'")
