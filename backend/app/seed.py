"""Explicit, idempotent local demo fixture. Never runs during application startup."""
import argparse
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from .db import connect, initialize
from .main import audit, money_minor, now, password_hash, public_entry, uid


def seed():
    initialize()
    with connect(write=True) as con:
        if con.execute('SELECT 1 FROM tenants WHERE id=?', ('demo-atlas',)).fetchone():
            print('Demo workspace already exists; preserved without changes.')
            return
        roles = {'ceo':'Omar Al Mansouri','cfo':'Sarah Mitchell','cto':'Reza Farhadi','manager':'Amir Hassan','accountant':'Layla Ahmed','customer':'Noor Khalid'}
        # Refuse to overwrite accounts created by users.
        if con.execute("SELECT 1 FROM users WHERE email LIKE '%@civproj.demo'").fetchone():
            raise RuntimeError('Demo account email collision; use a separate CIVPROJ_DB path.')
        tenant = 'demo-atlas'
        con.execute('INSERT INTO tenants VALUES(?,?)',(tenant,'Atlas Construction'))
        users = {}
        for role, name in roles.items():
            users[role] = uid()
            con.execute('INSERT INTO users VALUES(?,?,?,?)',(users[role],name,f'{role}@civproj.demo',password_hash('Demo2026!')))
            con.execute('INSERT INTO memberships VALUES(?,?,?)',(tenant,users[role],role))
        audit(con,tenant,users['ceo'],'organization.created',tenant,{'name':'Atlas Construction','demo':True})
        projects = [
            ('Harbour Residences','Meridian Developments','Dubai, UAE',[850000,5200000,3800000,1900000,950000,4200000,1550000]),
            ('Al Creek Bridge','Dubai Infrastructure Authority','Dubai, UAE',[900000,8400000,2800000,2400000,1900000,3100000,1100000]),
            ('South Logistics Hub','Gulf Logistics Group','Abu Dhabi, UAE',[600000,3500000,1700000,1600000,800000,2600000,900000]),
        ]
        categories = ('site','structure','materials','labor','equipment','subcontract','overhead')
        for index, (name,client,location,budgets) in enumerate(projects):
            project = uid()
            con.execute('INSERT INTO projects VALUES(?,?,?,?,?,?,?)',(project,tenant,name,client,'AED',location,now()))
            audit(con,tenant,users['ceo'],'project.created',project,{'name':name,'currency':'AED'},project)
            if index == 0:
                con.execute('INSERT INTO project_access VALUES(?,?,?)',(tenant,project,users['customer']))
            for category,amount in zip(categories,budgets):
                con.execute('INSERT INTO budgets VALUES(?,?,?,?)',(tenant,project,category,money_minor(amount,'AED')))
                audit(con,tenant,users['cfo'],'budget.revised',project,{'category':category,'previous':'0.00','amount':f'{amount:.2f}','note':'Initial sample allocation'},project)

            def add(kind,category,description,vendor,reference,unit_price,month=10,related=None,tax='0',retention='0',approved=True,quantity='1'):
                net=money_minor(Decimal(quantity)*Decimal(str(unit_price)),'AED')
                tax_minor=int((Decimal(net)*Decimal(tax)/100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
                amount=net+tax_minor
                retained=int((Decimal(amount)*Decimal(retention)/100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
                entry=dict(id=uid(),tenant_id=tenant,project_id=project,kind=kind,category=category,description=description,vendor=vendor,reference=reference,quantity=quantity,unit='ls',unit_price=str(unit_price),tax_rate=tax,retention_rate=retention,net=net,tax=tax_minor,amount=amount,retention=retained,date=date(2026,month,12).isoformat(),status='pending',related_id=related,created_by=users['manager'],created_at=now(),decided_by=None,decided_at=None)
                con.execute(f"INSERT INTO entries({','.join(entry)}) VALUES({','.join('?' for _ in entry)})",tuple(entry.values()))
                audit(con,tenant,users['manager'],f'{kind}.submitted',entry['id'],public_entry(entry,'AED'),project)
                if approved:
                    con.execute("UPDATE entries SET status='approved',decided_by=?,decided_at=? WHERE id=?",(users['cfo'],now(),entry['id']))
                    audit(con,tenant,users['cfo'],f'{kind}.approved',entry['id'],{'reference':reference,'amount':f'{Decimal(amount)/100:.2f}','note':'Sample approval','previous_status':'pending','status':'approved'},project)
                return entry['id']

            multiplier=Decimal('1') if index==0 else Decimal('.7') if index==1 else Decimal('.4')
            structure=add('commitment','structure','Structural concrete works — main contract','Emirates Civil Works',f'PO-{index+1}001',Decimal('4950000')*multiplier,5)
            materials=add('commitment','materials','Reinforcement steel supply framework','Gulf Steel Trading',f'PO-{index+1}002',Decimal('3100000')*multiplier,5)
            add('commitment','subcontract','MEP installation package','Al Noor MEP',f'PO-{index+1}003',Decimal('3400000')*multiplier,6)
            for n,month in enumerate(range(5,11)):
                price=Decimal([280000,420000,560000,650000,710000,490000][n])*multiplier
                category='structure' if n%2==0 else 'materials'
                vendor='Emirates Civil Works' if n%2==0 else 'Gulf Steel Trading'
                parent=structure if n%2==0 else materials
                invoice=add('invoice',category,['Foundation concrete — zone A','Steel reinforcement — first delivery','Podium slab concrete works','Steel reinforcement — second delivery','Tower concrete — levels 1–4','Steel reinforcement — third delivery'][n],vendor,f'INV-{index+1}{month:03}',price,month,parent,'5','10')
                if month<10:
                    add('payment',category,f'Progress payment — certificate {n+1}',vendor,f'PAY-{index+1}{month:03}',price*Decimal('1.05')*Decimal('.9'),month,invoice)
            add('invoice','equipment','Tower crane rental — October','Skyline Equipment',f'INV-EQ-{index+1}',Decimal('85000')*multiplier,10,None,'5','0',False)
            add('invoice','labor','Site workforce — October certificate','BuildForce UAE',f'INV-LB-{index+1}',Decimal('142000')*multiplier,10,None,'5','0',False)
            add('commitment','overhead','Site facilities and temporary offices','Modular Gulf',f'PO-OH-{index+1}',Decimal('380000')*multiplier,10,None,approved=False)
    print('Demo created: Atlas Construction, 3 AED projects, 6 roles. Sign in as cfo@civproj.demo / Demo2026!')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo',required=True,action='store_true',help='Create publicly known local demonstration accounts')
    parser.parse_args()
    seed()
