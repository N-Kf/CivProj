import csv
import hashlib
import hmac
import io
import json
import os
import secrets
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from .db import connect, initialize

CATEGORIES = ('site','structure','materials','labor','equipment','subcontract','overhead')
CURRENCIES = {'USD': 2, 'AED': 2, 'IRR': 0, 'EUR': 2, 'SAR': 2}
ROLES = Literal['ceo', 'cfo', 'cto', 'manager', 'accountant', 'customer']
EDITORS = ('ceo', 'cfo', 'manager', 'accountant')
APPROVERS = ('ceo', 'cfo')


def uid():
    return str(uuid4())


def now():
    return datetime.now(timezone.utc).isoformat()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
    return f'{salt}:{digest}'


def check_password(password, stored):
    return hmac.compare_digest(password_hash(password, stored.split(':')[0]), stored)


def audit(con, tenant, actor, action, entity, detail, project=None):
    con.execute('INSERT INTO audit(tenant_id,project_id,actor_id,action,entity_id,detail,created_at) VALUES(?,?,?,?,?,?,?)',
                (tenant, project, actor, action, entity, json.dumps(detail, ensure_ascii=False), now()))


def money_minor(value, currency):
    return int((Decimal(value) * (10 ** CURRENCIES[currency])).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def money_string(value, currency):
    return f'{Decimal(value) / (10 ** CURRENCIES[currency]):.{CURRENCIES[currency]}f}'


def current_user(con, request):
    token = request.cookies.get('civ_session', '')
    user = con.execute('SELECT u.id,u.name,u.email FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?',
                       (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()
    if not user:
        raise HTTPException(401, 'Sign in required')
    return dict(user)


def access(con, request, tenant, roles=None):
    user = current_user(con, request)
    member = con.execute('SELECT role FROM memberships WHERE tenant_id=? AND user_id=?', (tenant, user['id'])).fetchone()
    if not member or (roles and member['role'] not in roles):
        raise HTTPException(403, 'Access denied')
    return {**user, 'role': member['role']}


def project_row(con, tenant, project):
    row = con.execute('SELECT * FROM projects WHERE tenant_id=? AND id=?', (tenant, project)).fetchone()
    if not row:
        raise HTTPException(404, 'Project not found')
    return dict(row)


def create_session(con, user_id, response):
    token = secrets.token_urlsafe(32)
    con.execute('DELETE FROM sessions WHERE expires_at<=?', (int(time.time()),))
    con.execute('INSERT INTO sessions VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), user_id, int(time.time()) + 43200))
    response.set_cookie('civ_session', token, httponly=True, samesite='lax', secure=os.getenv('CIVPROJ_SECURE_COOKIE') == '1', max_age=43200, path='/api')


class Login(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class Register(Login):
    name: str = Field(min_length=2, max_length=120)
    organization: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=12, max_length=128)

    @field_validator('name','organization')
    @classmethod
    def not_blank(cls,value):
        if len(value.strip()) < 2:
            raise ValueError('At least two nonblank characters are required')
        return value.strip()


class ProjectInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    client: str = Field(min_length=1, max_length=160)
    currency: Literal['USD', 'AED', 'IRR', 'EUR', 'SAR'] = 'AED'
    location: str = Field(default='', max_length=160)

    @field_validator('name','client')
    @classmethod
    def not_blank(cls,value):
        if not value.strip():
            raise ValueError('A nonblank value is required')
        return value.strip()


class BudgetInput(BaseModel):
    category: Literal['site','structure','materials','labor','equipment','subcontract','overhead']
    amount: Decimal = Field(ge=0, le=Decimal('1000000000000'), max_digits=18, decimal_places=2)
    note: str = Field(min_length=3, max_length=500)

    @field_validator('note')
    @classmethod
    def note_content(cls,value):
        if len(value.strip()) < 3:
            raise ValueError('A meaningful note is required')
        return value.strip()


class EntryInput(BaseModel):
    kind: Literal['commitment','invoice','payment']
    category: Literal['site','structure','materials','labor','equipment','subcontract','overhead']
    description: str = Field(min_length=3, max_length=500)
    vendor: str = Field(min_length=1, max_length=160)
    reference: str = Field(min_length=1, max_length=100)
    quantity: Decimal = Field(gt=0, le=Decimal('1000000000'), max_digits=15, decimal_places=4)
    unit: Literal['each','ls','m','m2','m3','kg','t','hr','day'] = 'each'
    unit_price: Decimal = Field(gt=0, le=Decimal('1000000000000'), max_digits=18, decimal_places=4)
    tax_rate: Decimal = Field(default=Decimal(0), ge=0, le=100, max_digits=7, decimal_places=4)
    retention_rate: Decimal = Field(default=Decimal(0), ge=0, le=100, max_digits=7, decimal_places=4)
    date: date
    related_id: str | None = None

    @field_validator('description','vendor','reference')
    @classmethod
    def not_blank(cls,value):
        if not value.strip():
            raise ValueError('A nonblank value is required')
        return value.strip()

    @field_validator('quantity','unit_price','tax_rate','retention_rate')
    @classmethod
    def finite(cls, value):
        if not value.is_finite():
            raise ValueError('A finite number is required')
        return value


class Decision(BaseModel):
    decision: Literal['approved','rejected']
    note: str = Field(min_length=3, max_length=500)

    @field_validator('note')
    @classmethod
    def note_content(cls,value):
        if len(value.strip()) < 3:
            raise ValueError('A meaningful note is required')
        return value.strip()


class MemberInput(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    role: ROLES
    project_ids: list[str] = Field(default_factory=list, max_length=100)


@asynccontextmanager
async def lifespan(app):
    initialize()
    yield


app = FastAPI(title='CivProj API', version='0.1.0', lifespan=lifespan)
origins = os.getenv('CIVPROJ_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000').split(',')
public_url = (os.getenv('CIVPROJ_PUBLIC_URL') or os.getenv('RENDER_EXTERNAL_URL') or '').rstrip('/')
if public_url:
    origins.append(public_url)
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=['GET','POST'], allow_headers=['Content-Type'])


@app.middleware('http')
async def origin_guard(request: Request, call_next):
    if request.method not in ('GET','HEAD','OPTIONS') and request.headers.get('origin') and request.headers['origin'] not in origins:
        return Response('Origin not allowed', status_code=403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    if os.getenv('CIVPROJ_STATIC_DIR'):
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
        response.headers['Referrer-Policy'] = 'same-origin'
    if request.url.path.startswith('/api'):
        response.headers['Cache-Control'] = 'no-store'
    return response


@app.get('/api/health')
def health():
    with connect() as con:
        con.execute('SELECT 1').fetchone()
    return {'status': 'ok'}


@app.post('/api/auth/register', status_code=201)
def register(data: Register, response: Response):
    with connect(write=True) as con:
        email = data.email.strip().lower()
        if '@' not in email or con.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone():
            raise HTTPException(400, 'Invalid or unavailable email')
        user, tenant = uid(), uid()
        con.execute('INSERT INTO users VALUES(?,?,?,?)', (user, data.name.strip(), email, password_hash(data.password)))
        con.execute('INSERT INTO tenants VALUES(?,?)', (tenant, data.organization.strip()))
        con.execute('INSERT INTO memberships VALUES(?,?,?)', (tenant, user, 'ceo'))
        audit(con, tenant, user, 'organization.created', tenant, {'name': data.organization})
        create_session(con, user, response)
    return {'id': user}


@app.post('/api/auth/login')
def login(data: Login, response: Response):
    with connect(write=True) as con:
        user = con.execute('SELECT * FROM users WHERE email=?', (data.email.strip().lower(),)).fetchone()
        # A fixed dummy calculation also covers unknown accounts.
        valid = check_password(data.password, user['password'] if user else password_hash('dummy-password', '0' * 32))
        if not user or not valid:
            raise HTTPException(401, 'Invalid email or password')
        create_session(con, user['id'], response)
    return {'id': user['id']}


@app.post('/api/auth/logout')
def logout(request: Request, response: Response):
    with connect(write=True) as con:
        con.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(request.cookies.get('civ_session', '').encode()).hexdigest(),))
    response.delete_cookie('civ_session', path='/api')
    return {'ok': True}


@app.get('/api/me')
def me(request: Request):
    with connect() as con:
        user = current_user(con, request)
        tenants = [dict(r) for r in con.execute('SELECT t.id,t.name,m.role FROM tenants t JOIN memberships m ON t.id=m.tenant_id WHERE m.user_id=? ORDER BY t.name', (user['id'],))]
    return {**user, 'tenants': tenants}


def summary(con, p):
    currency = p['currency']
    entries = [dict(r) for r in con.execute('SELECT * FROM entries WHERE tenant_id=? AND project_id=?', (p['tenant_id'], p['id']))]
    approved = [r for r in entries if r['status'] == 'approved']
    categories = []
    totals = dict(budget=0, committed=0, actual=0, paid=0, retention=0, remaining_commitment=0, forecast=0, variance=0, payable=0)
    for category in CATEGORIES:
        budget = con.execute('SELECT amount FROM budgets WHERE tenant_id=? AND project_id=? AND category=?', (p['tenant_id'], p['id'], category)).fetchone()
        rows = [r for r in approved if r['category'] == category]
        committed = sum(r['amount'] for r in rows if r['kind'] == 'commitment')
        actual = sum(r['amount'] for r in rows if r['kind'] == 'invoice')
        paid = sum(r['amount'] for r in rows if r['kind'] == 'payment')
        retention = sum(r['retention'] for r in rows if r['kind'] == 'invoice')
        remaining = sum(max(0, r['amount'] - sum(i['amount'] for i in approved if i['kind'] == 'invoice' and i['related_id'] == r['id'])) for r in rows if r['kind'] == 'commitment')
        values = dict(budget=budget['amount'] if budget else 0, committed=committed, actual=actual, paid=paid, retention=retention, remaining_commitment=remaining, forecast=actual+remaining, payable=actual-retention-paid)
        values['variance'] = values['budget'] - values['forecast']
        for key, value in values.items():
            totals[key] += value
        categories.append({'category': category, **{k: money_string(v, currency) for k,v in values.items()}})
    # Reporting dates come from approved financial records, never a generated trend.
    months = sorted(set(r['date'][:7] for r in approved))
    trend = [{'month': month, **{kind: money_string(sum(r['amount'] for r in approved if r['kind']==kind and r['date'][:7]==month), currency) for kind in ('invoice','payment')}} for month in months]
    return {**p, **{k: money_string(v, currency) for k,v in totals.items()}, 'categories': categories, 'trend': trend, 'pending_count': sum(r['status']=='pending' for r in entries), 'entry_count': len(entries)}


@app.get('/api/tenants/{tenant}/projects')
def projects(tenant: str, request: Request):
    with connect() as con:
        user = access(con, request, tenant)
        rows = con.execute('SELECT * FROM projects WHERE tenant_id=? ORDER BY created_at,id', (tenant,)).fetchall()
        if user['role'] == 'customer':
            allowed = {r[0] for r in con.execute('SELECT project_id FROM project_access WHERE tenant_id=? AND user_id=?', (tenant,user['id']))}
            rows = [r for r in rows if r['id'] in allowed]
        return [summary(con, dict(p)) for p in rows]


@app.post('/api/tenants/{tenant}/projects', status_code=201)
def create_project(tenant: str, data: ProjectInput, request: Request):
    with connect(write=True) as con:
        user = access(con, request, tenant, ('ceo','cfo','manager'))
        project = uid()
        con.execute('INSERT INTO projects VALUES(?,?,?,?,?,?,?)', (project, tenant, data.name.strip(), data.client.strip(), data.currency, data.location.strip(), now()))
        audit(con, tenant, user['id'], 'project.created', project, data.model_dump(), project)
        return summary(con, project_row(con, tenant, project))


@app.post('/api/tenants/{tenant}/projects/{project}/budgets')
def set_budget(tenant: str, project: str, data: BudgetInput, request: Request):
    with connect(write=True) as con:
        user = access(con, request, tenant, ('ceo','cfo','manager'))
        p = project_row(con, tenant, project)
        previous = con.execute('SELECT amount FROM budgets WHERE tenant_id=? AND project_id=? AND category=?', (tenant, project, data.category)).fetchone()
        amount = money_minor(data.amount, p['currency'])
        con.execute('INSERT INTO budgets VALUES(?,?,?,?) ON CONFLICT(tenant_id,project_id,category) DO UPDATE SET amount=excluded.amount', (tenant, project, data.category, amount))
        audit(con, tenant, user['id'], 'budget.revised', project, {'category': data.category, 'previous': money_string(previous['amount'] if previous else 0,p['currency']), 'amount': money_string(amount,p['currency']), 'note': data.note}, project)
        return summary(con, p)


def public_entry(row, currency):
    return {**dict(row), **{key: money_string(row[key], currency) for key in ('net','tax','amount','retention')}}


@app.get('/api/tenants/{tenant}/projects/{project}/entries')
def entries(tenant: str, project: str, request: Request):
    with connect() as con:
        access(con, request, tenant, ('ceo','cfo','cto','manager','accountant'))
        p = project_row(con, tenant, project)
        return [public_entry(r, p['currency']) for r in con.execute('SELECT e.*,u.name AS creator_name FROM entries e JOIN users u ON u.id=e.created_by WHERE e.tenant_id=? AND e.project_id=? ORDER BY e.created_at DESC,e.id', (tenant, project))]


def validate_relation(con, tenant, project, data, amount):
    if data.kind == 'payment' and not data.related_id:
        raise HTTPException(422, 'A payment must reference an approved invoice')
    if data.kind == 'commitment' and data.related_id:
        raise HTTPException(422, 'Commitments cannot reference another record')
    if not data.related_id:
        return
    parent = con.execute('SELECT * FROM entries WHERE tenant_id=? AND project_id=? AND id=?', (tenant, project, data.related_id)).fetchone()
    expected = 'invoice' if data.kind == 'payment' else 'commitment'
    if not parent or parent['kind'] != expected or parent['status'] != 'approved':
        raise HTTPException(422, f'An approved {expected} in this project is required')
    if data.category != parent['category'] or data.vendor.strip() != parent['vendor']:
        raise HTTPException(422, 'Linked records must have the same vendor and cost category')
    used = con.execute("SELECT COALESCE(SUM(amount),0) FROM entries WHERE tenant_id=? AND related_id=? AND status IN ('pending','approved')", (tenant, data.related_id)).fetchone()[0]
    limit = parent['amount'] - (parent['retention'] if data.kind == 'payment' else 0)
    if used + amount > limit:
        raise HTTPException(422, 'Amount exceeds the unallocated balance of the linked record (including pending records)')


@app.post('/api/tenants/{tenant}/projects/{project}/entries', status_code=201)
def create_entry(tenant: str, project: str, data: EntryInput, request: Request):
    with connect(write=True) as con:
        user = access(con, request, tenant, EDITORS)
        p = project_row(con, tenant, project)
        currency = p['currency']
        if con.execute('SELECT 1 FROM entries WHERE tenant_id=? AND project_id=? AND kind=? AND vendor=? COLLATE NOCASE AND reference=? COLLATE NOCASE', (tenant,project,data.kind,data.vendor.strip(),data.reference.strip())).fetchone():
            raise HTTPException(409, 'This supplier reference already exists for this record type and project')
        if data.kind != 'invoice' and (data.tax_rate or data.retention_rate):
            raise HTTPException(422, 'Tax and retention apply to invoices only; commitments and payments use their total face value')
        net = money_minor(data.quantity * data.unit_price, currency)
        tax = int((Decimal(net) * data.tax_rate / 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        amount = net + tax
        retention = int((Decimal(amount) * data.retention_rate / 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        if amount <= 0 or amount > 10**15:
            raise HTTPException(422, 'Amount is outside the supported range')
        validate_relation(con, tenant, project, data, amount)
        entry = dict(id=uid(), tenant_id=tenant, project_id=project, kind=data.kind, category=data.category, description=data.description.strip(), vendor=data.vendor.strip(), reference=data.reference.strip(), quantity=str(data.quantity), unit=data.unit, unit_price=str(data.unit_price), tax_rate=str(data.tax_rate), retention_rate=str(data.retention_rate), net=net, tax=tax, amount=amount, retention=retention, date=data.date.isoformat(), status='pending', related_id=data.related_id, created_by=user['id'], created_at=now(), decided_by=None, decided_at=None)
        con.execute(f"INSERT INTO entries({','.join(entry)}) VALUES({','.join('?' for _ in entry)})", tuple(entry.values()))
        result = public_entry(entry, currency)
        audit(con, tenant, user['id'], f'{data.kind}.submitted', entry['id'], result, project)
        return result


@app.post('/api/tenants/{tenant}/projects/{project}/entries/{entry}/decision')
def decide(tenant: str, project: str, entry: str, data: Decision, request: Request):
    with connect(write=True) as con:
        user = access(con, request, tenant, APPROVERS)
        p = project_row(con, tenant, project)
        row = con.execute('SELECT * FROM entries WHERE tenant_id=? AND project_id=? AND id=?', (tenant, project, entry)).fetchone()
        if not row:
            raise HTTPException(404, 'Record not found')
        if row['status'] != 'pending':
            raise HTTPException(409, 'This record has already been decided')
        if row['created_by'] == user['id']:
            raise HTTPException(403, 'A different authorized person must approve or reject this record')
        con.execute('UPDATE entries SET status=?,decided_by=?,decided_at=? WHERE id=? AND tenant_id=?', (data.decision, user['id'], now(), entry, tenant))
        audit(con, tenant, user['id'], f"{row['kind']}.{data.decision}", entry, {'reference': row['reference'], 'amount': money_string(row['amount'],p['currency']), 'note': data.note, 'previous_status': 'pending', 'status': data.decision}, project)
        return {'status': data.decision}


@app.get('/api/tenants/{tenant}/projects/{project}/audit')
def audit_log(tenant: str, project: str, request: Request):
    with connect() as con:
        access(con, request, tenant, ('ceo','cfo','cto','manager','accountant'))
        project_row(con, tenant, project)
        return [{**dict(r), 'detail': json.loads(r['detail'])} for r in con.execute('SELECT a.*,u.name AS actor_name FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.tenant_id=? AND a.project_id=? ORDER BY a.id DESC LIMIT 500', (tenant, project))]


@app.get('/api/tenants/{tenant}/projects/{project}/report.csv')
def report(tenant: str, project: str, request: Request):
    with connect() as con:
        user = access(con, request, tenant)
        if user['role'] == 'customer' and not con.execute('SELECT 1 FROM project_access WHERE tenant_id=? AND project_id=? AND user_id=?', (tenant,project,user['id'])).fetchone():
            raise HTTPException(404, 'Project not found')
        p = summary(con, project_row(con, tenant, project))
        output = io.StringIO()
        writer = csv.writer(output)
        # Text from users must not become spreadsheet formulas.
        def safe(value):
            value = str(value)
            return "'" + value if value.lstrip().startswith(('=','+','-','@','\t','\r')) else value
        writer.writerow(['CivProj cost report', safe(p['name']), p['currency'], now()])
        writer.writerow(['Category','Budget','Committed','Actual invoiced','Paid','Retained','Remaining commitment','Forecast','Variance','Payable'])
        for r in p['categories']:
            writer.writerow([r['category'], *[r[k] for k in ('budget','committed','actual','paid','retention','remaining_commitment','forecast','variance','payable')]])
        writer.writerow(['TOTAL', *[p[k] for k in ('budget','committed','actual','paid','retention','remaining_commitment','forecast','variance','payable')]])
        if user['role'] != 'customer':
            writer.writerow([])
            writer.writerow(['Reference','Type','Status','Date','Category','Vendor','Description','Quantity','Unit','Unit price','Net','Tax','Retention','Gross','Related record','Record ID'])
            for row in con.execute('SELECT * FROM entries WHERE tenant_id=? AND project_id=? ORDER BY date,id', (tenant, project)):
                r = public_entry(row,p['currency'])
                writer.writerow([safe(r[k] or '') for k in ('reference','kind','status','date','category','vendor','description','quantity','unit','unit_price','net','tax','retention','amount','related_id','id')])
        return Response('\ufeff'+output.getvalue(), media_type='text/csv; charset=utf-8', headers={'Content-Disposition':'attachment; filename="civproj-cost-report.csv"'})


@app.get('/api/tenants/{tenant}/members')
def members(tenant: str, request: Request):
    with connect() as con:
        access(con, request, tenant, ('ceo','cfo'))
        return [dict(r) for r in con.execute('SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? ORDER BY u.name', (tenant,))]


@app.post('/api/tenants/{tenant}/members', status_code=201)
def add_member(tenant: str, data: MemberInput, request: Request):
    with connect(write=True) as con:
        user = access(con, request, tenant, ('ceo',))
        member = con.execute('SELECT id FROM users WHERE email=?', (data.email.strip().lower(),)).fetchone()
        if not member:
            raise HTTPException(422, 'This person must first create an account')
        if con.execute('SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=?', (tenant,member['id'])).fetchone():
            raise HTTPException(409, 'This person is already a member')
        if data.role == 'customer' and not data.project_ids:
            raise HTTPException(422, 'Select at least one project for a customer')
        for project in set(data.project_ids):
            project_row(con,tenant,project)
        con.execute('INSERT INTO memberships VALUES(?,?,?)', (tenant,member['id'],data.role))
        for project in set(data.project_ids):
            con.execute('INSERT INTO project_access VALUES(?,?,?)', (tenant,project,member['id']))
        audit(con, tenant,user['id'],'member.added',member['id'],{'email':data.email,'role':data.role,'project_ids':data.project_ids})
        return {'ok': True}


# Keep this mount after API routes so the same HTTPS service serves both the UI
# and API. Development still uses Vite when CIVPROJ_STATIC_DIR is unset.
if os.getenv('CIVPROJ_STATIC_DIR'):
    app.mount('/', StaticFiles(directory=os.environ['CIVPROJ_STATIC_DIR'], html=True), name='web')
