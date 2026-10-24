/** Fictional, in-memory UI demonstration. This is not a hosted Python backend.
 * Reloading discards every change. No credentials or financial data are sent
 * to a server. Production builds do not enable this transport.
 */
import fixture from './demo-fixture.json';
import {ApiError} from './api';
import {categories} from './types';
import type {Audit, Category, Entry, Member, Project, Role, Totals, User} from './types';

type RawEntry = Omit<Entry,'amount'|'net'|'tax'|'retention'|'creator_name'> & {tenant_id:string;amount:number;net:number;tax:number;retention:number};
type RawProject = Pick<Project,'id'|'name'|'client'|'location'|'currency'> & {tenant_id:string;created_at:string};
type Data = {
  users:Omit<User,'tenants'>[];
  tenants:{id:string;name:string}[];
  memberships:{tenant_id:string;user_id:string;role:Role}[];
  project_access:{tenant_id:string;project_id:string;user_id:string}[];
  projects:RawProject[];
  budgets:{tenant_id:string;project_id:string;category:Category;amount:number}[];
  entries:RawEntry[];
  audit:(Omit<Audit,'actor_name'> & {tenant_id:string;project_id:string|null;actor_id:string})[];
};
const state:Data=structuredClone(fixture) as unknown as Data;
let activeUser:string|null=state.users.find(user=>user.email==='cfo@civproj.demo')!.id;
const precision:Record<string,number>={AED:2,SAR:2,USD:2,EUR:2,IRR:0};
const editors:Role[]=['ceo','cfo','manager','accountant'];
const budgetEditors:Role[]=['ceo','cfo','manager'];
const internal:Role[]=['ceo','cfo','cto','manager','accountant'];
const approvers:Role[]=['ceo','cfo'];
const timestamp=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
function fail(status:number,message:string):never {throw new ApiError(status,message);}
function user(){return state.users.find(row=>row.id===activeUser)||fail(401,'Sign in required');}
function access(tenant:string,roles?:Role[]) {
  const person=user();
  const membership=state.memberships.find(row=>row.tenant_id===tenant&&row.user_id===person.id);
  if(!membership||(roles&&!roles.includes(membership.role))) fail(403,'Access denied');
  return {...person,role:membership.role};
}
function project(tenant:string,key:string){return state.projects.find(row=>row.tenant_id===tenant&&row.id===key)||fail(404,'Project not found');}
function allowedProject(tenant:string,key:string){
  const person=access(tenant);
  const p=project(tenant,key);
  if(person.role==='customer'&&!state.project_access.some(row=>row.tenant_id===tenant&&row.project_id===key&&row.user_id===person.id))fail(404,'Project not found');
  return p;
}
function decimal(value:unknown,places=4):bigint {
  const text=String(value??'0');
  if(!/^\d+(\.\d+)?$/.test(text))fail(422,'A nonnegative decimal value is required');
  const [whole,fraction='']=text.split('.');
  if(fraction.length>places)fail(422,'Too many decimal places');
  return BigInt(whole)*10n**BigInt(places)+BigInt((fraction+'0'.repeat(places)).slice(0,places)||'0');
}
const rounded=(value:bigint,denominator:bigint)=>(value+denominator/2n)/denominator;
function minor(value:unknown,currency:string){return rounded(decimal(value)*10n**BigInt(precision[currency]),10000n);}
function textMoney(value:bigint|number,currency:string){
  const amount=BigInt(value),digits=precision[currency],scale=10n**BigInt(digits),abs=amount<0n?-amount:amount;
  return `${amount<0n?'-':''}${abs/scale}${digits?'.'+String(abs%scale).padStart(digits,'0'):''}`;
}
const sum=(rows:RawEntry[],kind?:string)=>rows.filter(row=>!kind||row.kind===kind).reduce((total,row)=>total+BigInt(row.amount),0n);
function publicEntry(row:RawEntry,currency:string):Entry {
  return {...row,amount:textMoney(row.amount,currency),net:textMoney(row.net,currency),tax:textMoney(row.tax,currency),retention:textMoney(row.retention,currency),creator_name:state.users.find(user=>user.id===row.created_by)?.name||''};
}
function log(tenant:string,actor:string,action:string,entity:string,detail:Record<string,unknown>,projectId:string|null=null){
  state.audit.push({id:Math.max(0,...state.audit.map(row=>row.id))+1,tenant_id:tenant,project_id:projectId,actor_id:actor,action,entity_id:entity,detail,created_at:timestamp()});
}
function summary(p:RawProject):Project {
  const entries=state.entries.filter(row=>row.tenant_id===p.tenant_id&&row.project_id===p.id);
  const approved=entries.filter(row=>row.status==='approved');
  const totals:Record<keyof Totals,bigint>={budget:0n,committed:0n,actual:0n,paid:0n,retention:0n,remaining_commitment:0n,forecast:0n,variance:0n,payable:0n};
  const allocation=categories.map(category=>{
    const rows=approved.filter(row=>row.category===category);
    const budget=BigInt(state.budgets.find(row=>row.tenant_id===p.tenant_id&&row.project_id===p.id&&row.category===category)?.amount||0);
    const actual=sum(rows,'invoice'),paid=sum(rows,'payment');
    const retention=rows.filter(row=>row.kind==='invoice').reduce((total,row)=>total+BigInt(row.retention),0n);
    const remaining=rows.filter(row=>row.kind==='commitment').reduce((total,row)=>{
      const balance=BigInt(row.amount)-sum(approved.filter(invoice=>invoice.related_id===row.id),'invoice');
      return total+(balance>0n?balance:0n);
    },0n);
    const values={budget,committed:sum(rows,'commitment'),actual,paid,retention,remaining_commitment:remaining,forecast:actual+remaining,variance:budget-actual-remaining,payable:actual-retention-paid};
    for(const key of Object.keys(totals) as (keyof Totals)[])totals[key]+=values[key];
    return {category,...Object.fromEntries(Object.entries(values).map(([key,value])=>[key,textMoney(value,p.currency)]))} as Totals&{category:Category};
  });
  const months=[...new Set(approved.map(row=>row.date.slice(0,7)))].sort();
  return {...p,...(Object.fromEntries(Object.entries(totals).map(([key,value])=>[key,textMoney(value,p.currency)])) as Totals),categories:allocation,trend:months.map(month=>({month,invoice:textMoney(sum(approved.filter(row=>row.date.startsWith(month)),'invoice'),p.currency),payment:textMoney(sum(approved.filter(row=>row.date.startsWith(month)),'payment'),p.currency)})),pending_count:entries.filter(row=>row.status==='pending').length,entry_count:entries.length} as Project;
}

export async function demoApi<T>(path:string,body?:unknown):Promise<T> {
  const data=(body||{}) as Record<string,unknown>;
  const out=(value:unknown)=>structuredClone(value) as T;
  if(path==='/auth/login'){
    const match=state.users.find(row=>row.email===String(data.email).trim().toLowerCase());
    if(!match||data.password!=='Demo2026!')fail(401,'Invalid email or password');
    activeUser=match.id;return out({id:match.id});
  }
  if(path==='/auth/logout'){activeUser=null;return out({ok:true});}
  if(path==='/me'){
    const person=user();
    return out({...person,tenants:state.memberships.filter(row=>row.user_id===person.id).map(row=>({...state.tenants.find(tenant=>tenant.id===row.tenant_id),role:row.role}))});
  }
  const parts=path.split('/').filter(Boolean);
  if(parts[0]!=='tenants')fail(422,'This preview uses fictional sample accounts only.');
  const tenant=parts[1],person=access(tenant);
  if(parts[2]==='members'&&body===undefined){
    access(tenant,approvers);
    return out(state.memberships.filter(row=>row.tenant_id===tenant).map(row=>({...state.users.find(user=>user.id===row.user_id),role:row.role})) as Member[]);
  }
  if(parts[2]!=='projects')fail(422,'This action is unavailable in the browser demonstration.');
  if(parts.length===3){
    if(body===undefined)return out(state.projects.filter(row=>row.tenant_id===tenant&&(person.role!=='customer'||state.project_access.some(grant=>grant.tenant_id===tenant&&grant.project_id===row.id&&grant.user_id===person.id))).map(summary));
    access(tenant,budgetEditors);
    const currency=String(data.currency||'AED');
    if(!(currency in precision))fail(422,'Unsupported currency');
    if(!String(data.name||'').trim()||!String(data.client||'').trim())fail(422,'Project name and customer are required');
    const p:RawProject={id:id(),tenant_id:tenant,name:String(data.name).trim(),client:String(data.client).trim(),location:String(data.location||''),currency,created_at:timestamp()};
    state.projects.push(p);log(tenant,person.id,'project.created',p.id,data,p.id);
    return out(summary(p));
  }
  const p=allowedProject(tenant,parts[3]);
  const records=state.entries.filter(row=>row.tenant_id===tenant&&row.project_id===p.id);
  if(parts[4]==='budgets'&&body!==undefined){
    access(tenant,budgetEditors);
    const category=String(data.category) as Category;
    if(!categories.includes(category)||String(data.note||'').trim().length<3)fail(422,'A cost code and meaningful reason are required');
    const amount=minor(data.amount,p.currency);
    if(amount>100000000000000n)fail(422,'Amount is outside the supported range');
    const previous=state.budgets.find(row=>row.tenant_id===tenant&&row.project_id===p.id&&row.category===category);
    log(tenant,person.id,'budget.revised',p.id,{category,previous:textMoney(previous?.amount||0,p.currency),amount:textMoney(amount,p.currency),note:String(data.note)},p.id);
    if(previous)previous.amount=Number(amount);else state.budgets.push({tenant_id:tenant,project_id:p.id,category,amount:Number(amount)});
    return out(summary(p));
  }
  if(parts[4]==='audit'){
    access(tenant,internal);
    return out(state.audit.filter(row=>row.tenant_id===tenant&&row.project_id===p.id).slice(-500).reverse().map(row=>({...row,actor_name:state.users.find(user=>user.id===row.actor_id)?.name||''})));
  }
  if(parts[4]!=='entries')fail(404,'Record not found');
  if(body===undefined){access(tenant,internal);return out(records.slice().reverse().map(row=>publicEntry(row,p.currency)));}
  if(parts[6]==='decision'){
    access(tenant,approvers);
    const entry=records.find(row=>row.id===parts[5])||fail(404,'Record not found');
    if(entry.status!=='pending')fail(409,'This record has already been decided');
    if(entry.created_by===person.id)fail(403,'A different authorized person must approve or reject this record');
    if(!['approved','rejected'].includes(String(data.decision))||String(data.note||'').trim().length<3)fail(422,'A decision and meaningful note are required');
    entry.status=data.decision as 'approved'|'rejected';entry.decided_by=person.id;entry.decided_at=timestamp();
    log(tenant,person.id,`${entry.kind}.${entry.status}`,entry.id,{reference:entry.reference,amount:textMoney(entry.amount,p.currency),note:String(data.note),previous_status:'pending',status:entry.status},p.id);
    return out({status:entry.status});
  }
  access(tenant,editors);
  const kind=String(data.kind) as Entry['kind'],category=String(data.category) as Category;
  if(!['commitment','invoice','payment'].includes(kind)||!categories.includes(category))fail(422,'Select a valid type and cost code');
  const reference=String(data.reference||'').trim(),vendor=String(data.vendor||'').trim(),description=String(data.description||'').trim();
  if(!reference||!vendor||description.length<3)fail(422,'Reference, supplier, and description are required');
  if(records.some(row=>row.kind===kind&&row.vendor.toLowerCase()===vendor.toLowerCase()&&row.reference.toLowerCase()===reference.toLowerCase()))fail(409,'This supplier reference already exists for this record type and project');
  const quantity=decimal(data.quantity),price=decimal(data.unit_price),taxRate=decimal(data.tax_rate),retentionRate=decimal(data.retention_rate);
  if(quantity<=0n||quantity>10000000000000n||price<=0n||price>10000000000000000n||taxRate>1000000n||retentionRate>1000000n)fail(422,'Amount is outside the supported range');
  if(kind!=='invoice'&&(taxRate||retentionRate))fail(422,'Tax and retention apply to invoices only; commitments and payments use their total face value');
  const net=rounded(quantity*price*10n**BigInt(precision[p.currency]),100000000n),tax=rounded(net*taxRate,1000000n),amount=net+tax,retention=rounded(amount*retentionRate,1000000n);
  if(amount<=0n||amount>1000000000000000n)fail(422,'Amount is outside the supported range');
  const related=data.related_id?String(data.related_id):null;
  if(kind==='payment'&&!related)fail(422,'A payment must reference an approved invoice');
  if(kind==='commitment'&&related)fail(422,'Commitments cannot reference another record');
  if(related){
    const parent=records.find(row=>row.id===related),expected=kind==='payment'?'invoice':'commitment';
    if(!parent||parent.status!=='approved'||parent.kind!==expected)fail(422,`An approved ${expected} in this project is required`);
    if(parent.category!==category||parent.vendor!==vendor)fail(422,'Linked records must have the same vendor and cost category');
    const reserved=sum(records.filter(row=>row.related_id===related&&row.status!=='rejected'));
    const limit=BigInt(parent.amount)-(kind==='payment'?BigInt(parent.retention):0n);
    if(reserved+amount>limit)fail(422,'Amount exceeds the unallocated balance of the linked record (including pending records)');
  }
  const accountingDate=String(data.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(accountingDate)||Number.isNaN(Date.parse(accountingDate)))fail(422,'A valid accounting date is required');
  const entry:RawEntry={id:id(),tenant_id:tenant,project_id:p.id,kind,category,reference,vendor,description,quantity:String(data.quantity),unit:String(data.unit||'each'),unit_price:String(data.unit_price),tax_rate:String(data.tax_rate||'0'),retention_rate:String(data.retention_rate||'0'),net:Number(net),tax:Number(tax),amount:Number(amount),retention:Number(retention),date:accountingDate,status:'pending',related_id:related,created_by:person.id,created_at:timestamp(),decided_by:null,decided_at:null};
  state.entries.push(entry);
  const result=publicEntry(entry,p.currency);
  log(tenant,person.id,`${kind}.submitted`,entry.id,result as unknown as Record<string,unknown>,p.id);
  return out(result);
}

function downloadReport(tenant:string,projectId:string){
  const p=allowedProject(tenant,projectId),report=summary(p),person=access(tenant);
  const rows:unknown[][]=[['CivProj · fictional browser demonstration',p.name,p.currency,timestamp()],['Category','Budget','Committed','Actual','Paid','Retention','Remaining commitment','Exposure','Variance','Payable']];
  const keys:(keyof Totals)[]=['budget','committed','actual','paid','retention','remaining_commitment','forecast','variance','payable'];
  for(const row of report.categories)rows.push([row.category,...keys.map(key=>row[key])]);
  rows.push(['TOTAL',...keys.map(key=>report[key])]);
  if(person.role!=='customer'){
    rows.push([],['Reference','Type','Status','Supplier','Description','Quantity','Unit','Unit price','Gross','Date']);
    for(const row of state.entries.filter(row=>row.tenant_id===tenant&&row.project_id===p.id))rows.push([row.reference,row.kind,row.status,row.vendor,row.description,row.quantity,row.unit,row.unit_price,textMoney(row.amount,p.currency),row.date]);
  }
  const csv=rows.map(row=>row.map(value=>{let text=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='civproj-demo-report.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.addEventListener('click',event=>{
  const anchor=(event.target as Element)?.closest?.('a');
  const match=anchor?.getAttribute('href')?.match(/^\/api\/tenants\/([^/]+)\/projects\/([^/]+)\/report\.csv$/);
  if(match){event.preventDefault();downloadReport(match[1],match[2]);}
});
