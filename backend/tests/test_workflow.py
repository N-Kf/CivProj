import csv
import io
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.db import connect
from app.main import app


@pytest.fixture
def workspace(tmp_path,monkeypatch):
    monkeypatch.setenv('CIVPROJ_DB',str(tmp_path/'test.sqlite3'))
    with TestClient(app) as owner, TestClient(app) as cfo, TestClient(app) as manager, TestClient(app) as customer, TestClient(app) as outsider:
        clients={'ceo':owner,'cfo':cfo,'manager':manager,'customer':customer,'outsider':outsider}
        for role,client in clients.items():
            response=client.post('/api/auth/register',json={'name':role,'organization':f'{role} organization','email':f'{role}@test.example','password':'a-secure-password'})
            assert response.status_code==201,response.text
        tenant=owner.get('/api/me').json()['tenants'][0]['id']
        root=f'/api/tenants/{tenant}'
        for role in ('cfo','manager'):
            assert owner.post(root+'/members',json={'email':f'{role}@test.example','role':role}).status_code==201
        p=owner.post(root+'/projects',json={'name':'Test project','client':'Customer','currency':'AED'}).json()
        other=owner.post(root+'/projects',json={'name':'Private project','client':'Other client','currency':'AED'}).json()
        assert owner.post(root+'/members',json={'email':'customer@test.example','role':'customer','project_ids':[p['id']]}).status_code==201
        yield {**clients,'tenant':tenant,'root':root,'base':f"{root}/projects/{p['id']}",'project':p,'other':other}


def submit(w,kind='invoice',**changes):
    data={'kind':kind,'category':'materials','description':'Reinforcing steel','vendor':'Steel Co','reference':'REF-001','quantity':'3','unit_price':'0.10','date':'2026-10-20','tax_rate':'5' if kind=='invoice' else '0','retention_rate':'10' if kind=='invoice' else '0',**changes}
    return w['manager'].post(w['base']+'/entries',json=data)


def approve(w,entry):
    response=w['cfo'].post(f"{w['base']}/entries/{entry['id']}/decision",json={'decision':'approved','note':'Verified supporting documents'})
    assert response.status_code==200,response.text


def totals(w):
    return next(p for p in w['ceo'].get(w['root']+'/projects').json() if p['id']==w['project']['id'])


def test_exact_decimal_rounding_and_approved_only_reporting(workspace):
    w=workspace
    entry=submit(w).json()
    assert (entry['net'],entry['tax'],entry['amount'],entry['retention'])==('0.30','0.02','0.32','0.03')
    assert totals(w)['actual']=='0.00'
    approve(w,entry)
    assert totals(w)['actual']=='0.32'
    assert totals(w)['payable']=='0.29'


def test_complete_financial_chain_does_not_double_count(workspace):
    w=workspace
    assert w['ceo'].post(w['base']+'/budgets',json={'category':'materials','amount':'1000','note':'Initial allocation'}).status_code==200
    commitment=submit(w,'commitment',quantity='1',unit_price='500').json();approve(w,commitment)
    invoice=submit(w,reference='INV-001',quantity='1',unit_price='200',related_id=commitment['id']).json();approve(w,invoice)
    payment=submit(w,'payment',reference='PAY-001',quantity='1',unit_price='189',related_id=invoice['id']).json();approve(w,payment)
    p=totals(w)
    assert {key:p[key] for key in ('budget','committed','actual','paid','retention','remaining_commitment','forecast','variance','payable')}=={'budget':'1000.00','committed':'500.00','actual':'210.00','paid':'189.00','retention':'21.00','remaining_commitment':'290.00','forecast':'500.00','variance':'500.00','payable':'0.00'}


def test_payment_limits_include_pending_and_retention(workspace):
    w=workspace
    invoice=submit(w,quantity='1',unit_price='100').json();approve(w,invoice)
    assert submit(w,'payment',reference='PAY-1',quantity='1',unit_price='94.50',related_id=invoice['id']).status_code==201
    assert submit(w,'payment',reference='PAY-2',quantity='1',unit_price='.01',related_id=invoice['id']).status_code==422


def test_concurrent_payments_cannot_overspend(workspace):
    w=workspace
    invoice=submit(w,quantity='1',unit_price='100').json();approve(w,invoice)
    def pay(n):
        return submit(w,'payment',reference=f'PAY-{n}',quantity='1',unit_price='60',related_id=invoice['id']).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(pay,[1,2]))==[201,422]


def test_tenant_isolation_and_unauthenticated_access(workspace):
    w=workspace
    with TestClient(app) as anonymous:
        assert anonymous.get(w['root']+'/projects').status_code==401
    for suffix in ('/entries','/audit','/report.csv'):
        assert w['outsider'].get(w['base']+suffix).status_code==403
    assert w['outsider'].get(w['root']+'/projects').status_code==403
    assert w['outsider'].post(w['base']+'/budgets',json={'category':'site','amount':'1','note':'attempt'}).status_code==403
    assert w['outsider'].post(w['root']+'/projects',json={'name':'Intruder','client':'x'}).status_code==403


def test_approval_permissions_self_approval_and_repeat_decision(workspace):
    w=workspace
    entry=submit(w).json()
    path=f"{w['base']}/entries/{entry['id']}/decision"
    decision={'decision':'approved','note':'Reviewed'}
    assert w['manager'].post(path,json=decision).status_code==403
    own=w['cfo'].post(w['base']+'/entries',json={'kind':'commitment','category':'site','description':'Site works','vendor':'Earth Co','reference':'SELF','quantity':'1','unit_price':'100','date':'2026-10-20'}).json()
    assert w['cfo'].post(f"{w['base']}/entries/{own['id']}/decision",json=decision).status_code==403
    approve(w,entry)
    assert w['cfo'].post(path,json=decision).status_code==409


def test_customers_only_see_assigned_summaries(workspace):
    w=workspace
    rows=w['customer'].get(w['root']+'/projects').json()
    assert [r['id'] for r in rows]==[w['project']['id']]
    assert w['customer'].get(w['base']+'/report.csv').status_code==200
    private=f"{w['root']}/projects/{w['other']['id']}"
    assert w['customer'].get(private+'/report.csv').status_code==404
    for resource in ('/entries','/audit'):
        assert w['customer'].get(w['base']+resource).status_code==403
    assert w['customer'].get(w['root']+'/members').status_code==403
    assert w['customer'].post(w['root']+'/projects',json={'name':'Unauthorized','client':'x'}).status_code==403


def test_no_cross_project_or_cross_tenant_link(workspace):
    w=workspace
    invoice=submit(w,quantity='1',unit_price='100').json();approve(w,invoice)
    body={'kind':'payment','category':'materials','description':'Invalid payment','vendor':'Steel Co','reference':'BAD-LINK','quantity':'1','unit_price':'1','date':'2026-10-20','related_id':invoice['id']}
    path=f"{w['root']}/projects/{w['other']['id']}/entries"
    assert w['manager'].post(path,json=body).status_code==422
    other_tenant=w['outsider'].get('/api/me').json()['tenants'][0]['id']
    other_project=w['outsider'].post(f'/api/tenants/{other_tenant}/projects',json={'name':'Other tenant project','client':'x'}).json()['id']
    assert w['outsider'].post(f'/api/tenants/{other_tenant}/projects/{other_project}/entries',json=body).status_code==422


def test_link_kind_supplier_category_and_capacity(workspace):
    w=workspace
    commitment=submit(w,'commitment',quantity='1',unit_price='100').json()
    assert submit(w,reference='PENDING-PARENT',related_id=commitment['id']).status_code==422
    approve(w,commitment)
    assert submit(w,reference='TOO-BIG',quantity='1',unit_price='100',related_id=commitment['id']).status_code==422
    assert submit(w,reference='WRONG-SUPPLIER',vendor='Other Co',related_id=commitment['id']).status_code==422
    assert submit(w,reference='WRONG-CATEGORY',category='labor',related_id=commitment['id']).status_code==422
    assert submit(w,'payment',related_id=commitment['id']).status_code==422
    assert submit(w,'payment',reference='UNLINKED').status_code==422


def test_rejection_releases_reserved_balance(workspace):
    w=workspace
    invoice=submit(w,quantity='1',unit_price='100').json();approve(w,invoice)
    payment=submit(w,'payment',reference='PAY-1',quantity='1',unit_price='94.5',related_id=invoice['id']).json()
    assert w['cfo'].post(f"{w['base']}/entries/{payment['id']}/decision",json={'decision':'rejected','note':'Incorrect account details'}).status_code==200
    assert submit(w,'payment',reference='PAY-2',quantity='1',unit_price='94.5',related_id=invoice['id']).status_code==201
    assert totals(w)['paid']=='0.00'


def test_duplicate_invoice_reference_and_validation(workspace):
    w=workspace
    assert submit(w).status_code==201
    assert submit(w,reference='ref-001',vendor='steel co').status_code==409
    for fields in ({'quantity':'-1'},{'unit_price':'NaN'},{'tax_rate':'101'},{'date':'not-a-date'},{'quantity':'0.00001'},{'vendor':'   '},{'unit':'invalid'}):
        assert submit(w,**fields).status_code==422
    assert submit(w,'commitment',tax_rate='5').status_code==422


def test_audit_records_budget_before_after_and_decisions(workspace):
    w=workspace
    for amount in ('500','750'):
        assert w['ceo'].post(w['base']+'/budgets',json={'category':'site','amount':amount,'note':'Approved revised allocation'}).status_code==200
    entry=submit(w).json();approve(w,entry)
    events=w['ceo'].get(w['base']+'/audit').json()
    budget=next(event for event in events if event['action']=='budget.revised')
    assert budget['detail']['previous']=='500.00'
    assert budget['detail']['amount']=='750.00'
    approval=next(event for event in events if event['action']=='invoice.approved')
    assert approval['detail']['note']=='Verified supporting documents'
    with connect(write=True) as con:
        with pytest.raises(sqlite3.IntegrityError):
            con.execute('DELETE FROM audit')


def test_csv_formula_safety_and_customer_redaction(workspace):
    w=workspace
    entry=submit(w,reference='=HYPERLINK("https://example.com")',description='+formula',vendor='@supplier').json();approve(w,entry)
    response=w['ceo'].get(w['base']+'/report.csv')
    rows=list(csv.reader(io.StringIO(response.text.lstrip('\ufeff'))))
    row=next(row for row in rows if row and row[0].startswith("'=HYPERLINK"))
    assert row[5]=="'@supplier" and row[6]=="'+formula"
    customer=w['customer'].get(w['base']+'/report.csv')
    assert 'HYPERLINK' not in customer.text and '@supplier' not in customer.text


def test_session_logout_and_origin_protection(workspace):
    w=workspace
    assert w['ceo'].post('/api/auth/logout',json={},headers={'Origin':'https://evil.example'}).status_code==403
    assert w['ceo'].get('/api/me').status_code==200
    assert w['ceo'].post('/api/auth/logout',json={}).status_code==200
    assert w['ceo'].get('/api/me').status_code==401
    assert w['ceo'].post('/api/auth/login',json={'email':'ceo@test.example','password':'wrong'}).status_code==401


def test_currency_irr_has_no_fractional_minor_unit(workspace):
    w=workspace
    p=w['ceo'].post(w['root']+'/projects',json={'name':'Iran project','client':'x','currency':'IRR'}).json()
    response=w['manager'].post(f"{w['root']}/projects/{p['id']}/entries",json={'kind':'invoice','category':'materials','description':'Rounding check','vendor':'Local Co','reference':'IRR-1','quantity':'3','unit_price':'1.5','tax_rate':'10','date':'2026-10-20'})
    assert response.status_code==201
    assert response.json()['net']=='5' and response.json()['tax']=='1' and response.json()['amount']=='6'
