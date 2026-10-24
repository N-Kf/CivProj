import {useCallback, useEffect, useState} from 'react';
import type {FormEvent, ReactNode} from 'react';
import {ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3, Building2, Check, CheckCheck, ChevronDown, CircleDollarSign, ClipboardCheck, Clock3, FileClock, FileSpreadsheet, FolderKanban, Globe2, HardHat, LayoutDashboard, LogOut, Menu, Plus, Printer, Search, ShieldCheck, TrendingUp, Users, Wallet, X} from 'lucide-react';
import {api, ApiError} from './api';
import {localeCode, translator} from './i18n';
import {categories} from './types';
import type {Audit, Entry, Locale, Member, Project, Role, User} from './types';

type Page = 'overview'|'projects'|'costs'|'approvals'|'reports'|'audit'|'team';
type Modal = 'project'|'entry'|'budget'|'member'|null;
const navigation = [{id:'overview',icon:LayoutDashboard},{id:'projects',icon:FolderKanban},{id:'costs',icon:Wallet},{id:'approvals',icon:ClipboardCheck},{id:'reports',icon:BarChart3},{id:'audit',icon:FileClock},{id:'team',icon:Users}] as const;
const roles: Role[] = ['ceo','cfo','cto','manager','accountant','customer'];
const browserDemo = import.meta.env.VITE_BROWSER_DEMO === 'true';
const colors = ['#328b78','#6c9b7b','#9fba7a','#d2ad68','#8fa9b8','#897fa9','#ab967b'];

export default function App() {
  const [locale,setLocale] = useState<Locale>(() => {const saved = localStorage.getItem('civ-locale'); return saved === 'ar' || saved === 'fa' || saved === 'en' ? saved : browserDemo ? 'fa' : 'en';});
  const t = translator(locale);
  const [user,setUser] = useState<User|null>(null);
  const [booting,setBooting] = useState(true);
  const [tenantId,setTenantId] = useState('');
  const [projectId,setProjectId] = useState('');
  const [projects,setProjects] = useState<Project[]>([]);
  const [entries,setEntries] = useState<Entry[]>([]);
  const [events,setEvents] = useState<Audit[]>([]);
  const [members,setMembers] = useState<Member[]>([]);
  const [scope,setScope] = useState('');
  const [projectsReady,setProjectsReady] = useState(false);
  const [page,setPage] = useState<Page>('overview');
  const [revision,setRevision] = useState(0);
  const [error,setError] = useState('');
  const [toast,setToast] = useState('');
  const [modal,setModal] = useState<Modal>(null);
  const [detail,setDetail] = useState<Entry|null>(null);
  const [review,setReview] = useState<{entry:Entry;decision:'approved'|'rejected'}|null>(null);
  const [search,setSearch] = useState('');
  const [filter,setFilter] = useState('all');
  const [mobile,setMobile] = useState(false);
  const tenant = user?.tenants.find(item => item.id === tenantId);
  const role = tenant?.role;
  const project = projects.find(item => item.id === projectId);
  const internal = role !== 'customer';
  const canEdit = !!role && ['ceo','cfo','manager','accountant'].includes(role);
  const canBudget = !!role && ['ceo','cfo','manager'].includes(role);
  const canApprove = role === 'ceo' || role === 'cfo';
  const base = `/tenants/${tenantId}/projects/${projectId}`;
  const currency = project?.currency || 'AED';
  const money = (value: string|number, compact=false, code=currency) => new Intl.NumberFormat(localeCode(locale), {style:'currency', currency:code, notation:compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 2 : code==='IRR'?0:2}).format(Number(value));
  const dateText = (value: string) => new Intl.DateTimeFormat(localeCode(locale), {year:'numeric',month:'short',day:'numeric'}).format(new Date(value.length===10 ? `${value}T12:00:00` : value));
  const fail = useCallback((err: unknown) => {
    if (err instanceof DOMException && err.name==='AbortError') return;
    if (err instanceof ApiError && err.status===401) {setUser(null);setTenantId('');}
    setError(err instanceof Error ? err.message : 'Unable to complete the request.');
  },[]);
  const loadUser = useCallback(async () => {
    const data = await api<User>('/me');
    setUser(data);setTenantId(data.tenants[0]?.id || '');setError('');
  },[]);
  useEffect(() => {loadUser().catch(err => {if (!(err instanceof ApiError && err.status===401)) fail(err);}).finally(() => setBooting(false));},[loadUser,fail]);
  useEffect(() => {document.documentElement.lang=locale;document.documentElement.dir=locale==='en'?'ltr':'rtl';localStorage.setItem('civ-locale',locale);},[locale]);
  useEffect(() => {if (!toast) return; const id=setTimeout(() => setToast(''),4000);return () => clearTimeout(id);},[toast]);
  useEffect(() => {
    if (!tenantId) return;
    const controller = new AbortController(); setProjectsReady(false);
    api<Project[]>(`/tenants/${tenantId}/projects`,undefined,controller.signal).then(data => {setProjects(data);setProjectId(old => data.some(p=>p.id===old)?old:data[0]?.id||'');setProjectsReady(true);}).catch(fail);
    return () => controller.abort();
  },[tenantId,revision,fail]);
  useEffect(() => {
    if (!tenantId || !projectId || !role) {setScope('');return;}
    const controller = new AbortController();setScope('');
    const root=`/tenants/${tenantId}/projects/${projectId}`;
    Promise.all(internal ? [api<Entry[]>(`${root}/entries`,undefined,controller.signal),api<Audit[]>(`${root}/audit`,undefined,controller.signal)] : [Promise.resolve([] as Entry[]),Promise.resolve([] as Audit[])]).then(([records,logs])=> {setEntries(records);setEvents(logs);setScope(`${tenantId}/${projectId}`);}).catch(fail);
    return () => controller.abort();
  },[tenantId,projectId,role,internal,revision,fail]);
  useEffect(() => {
    if (!tenantId || !canApprove) {setMembers([]);return;}
    const controller = new AbortController();
    api<Member[]>(`/tenants/${tenantId}/members`,undefined,controller.signal).then(setMembers).catch(fail);
    return () => controller.abort();
  },[tenantId,canApprove,revision,fail]);
  const refreshed = () => {setModal(null);setReview(null);setRevision(n=>n+1);setToast(t('saved'));setError('');};
  function navigate(next: Page) {setPage(next);setMobile(false);setSearch('');setFilter('all');}
  const pending = entries.filter(entry=>entry.status==='pending');
  const filtered = entries.filter(entry=>(filter==='all'||entry.status===filter||entry.kind===filter)&&[entry.reference,entry.description,entry.vendor].some(value=>value.toLowerCase().includes(search.toLowerCase())));
  const localePicker = <label className="locale-picker"><Globe2 size={16}/><select aria-label="Language / اللغة / زبان" value={locale} onChange={e=>setLocale(e.target.value as Locale)}><option value="en">English</option><option value="ar">العربية</option><option value="fa">فارسی</option></select></label>;

  if (booting) return <div className="loading-screen"><Building2 size={36}/><p>{t('loading')}</p></div>;
  if (!user) return <Auth t={t} localePicker={localePicker} onLogin={loadUser} initialError={error}/>;

  const recordTable = (records: Entry[]) => <div className="table-wrap"><table><thead><tr><th>{t('reference')}</th><th>{t('description')}</th><th>{t('type')}</th><th>{t('date')}</th><th>{t('amount')}</th><th>{t('status')}</th></tr></thead><tbody>{records.map(entry=><tr key={entry.id} onClick={()=>setDetail(entry)}><td><button className="record-ref" onClick={e=>{e.stopPropagation();setDetail(entry);}}>{entry.reference}</button></td><td><strong>{entry.description}</strong><span className="cell-sub">{entry.vendor}</span></td><td><span className={`type-label ${entry.kind}`}>{t(entry.kind)}</span></td><td className="nowrap">{dateText(entry.date)}</td><td className="money nowrap">{money(entry.amount)}</td><td><span className={`badge ${entry.status}`}><i/>{t(entry.status)}</span></td></tr>)}</tbody></table>{!records.length&&<div className="empty-inline">{t('noRecords')}</div>}</div>;

  const categoryTable = <div className="table-wrap"><table className="category-table"><thead><tr><th>{t('category')}</th><th>{t('budget')}</th><th>{t('actual')}</th><th>{t('exposure')}</th><th>{t('variance')}</th></tr></thead><tbody>{project?.categories.map((row,index)=><tr key={row.category}><td><span className="category-dot" style={{background:colors[index]}}/>{t(row.category)}</td><td className="money">{money(row.budget)}</td><td className="money">{money(row.actual)}</td><td className="money">{money(row.forecast)}</td><td className={`money ${Number(row.variance)<0?'negative':''}`}>{money(row.variance)}</td></tr>)}</tbody></table></div>;

  return <div className="app-shell">
    {mobile&&<div className="sidebar-scrim" onClick={()=>setMobile(false)}/>}
    <aside className={`sidebar ${mobile?'is-open':''}`}>
      <a className="brand" href="#" onClick={e=>{e.preventDefault();navigate('overview');}}><span className="brand-icon"><Building2 size={25} strokeWidth={1.8}/></span><span>Civ<span className="brand-light">Proj</span><small>{t('tagline')}</small></span></a>
      <div className="workspace-switch"><span className="org-monogram">{tenant?.name.slice(0,1)}</span><div><small>{t('workspace')}</small><select aria-label={t('organization')} value={tenantId} onChange={e=>{setTenantId(e.target.value);setProjectId('');setProjects([]);setEntries([]);setEvents([]);setError('');setPage('overview');}}>{user.tenants.map(org=><option key={org.id} value={org.id}>{org.name}</option>)}</select></div><ChevronDown size={14}/></div>
      <div className="nav-caption">{t('workspace')}</div>
      <nav>{navigation.filter(item=>internal||['overview','projects','reports'].includes(item.id)).filter(item=>item.id!=='team'||canApprove).map(item=><button className={`nav-item ${page===item.id?'active':''}`} key={item.id} onClick={()=>navigate(item.id)}><item.icon size={19}/><span>{t(item.id)}</span>{item.id==='approvals'&&pending.length>0&&<b>{pending.length}</b>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="trust-note"><ShieldCheck size={18}/><span>{t('welcome')}<small>Python + React</small></span></div><div className="profile"><span className="avatar">{user.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</span><div><strong>{user.name}</strong><small>{role&&t(role)}</small></div><button className="icon-button" aria-label={t('logout')} title={t('logout')} onClick={()=>api('/auth/logout',{}).then(()=>{setUser(null);setTenantId('');setProjectId('');setProjects([]);setEntries([]);setEvents([]);setMembers([]);setScope('');setProjectsReady(false);}).catch(fail)}><LogOut size={17}/></button></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-only" aria-label="Menu" onClick={()=>setMobile(true)}><Menu size={22}/></button><span>{t('workspace')}</span><span className="breadcrumb-slash">/</span><strong>{t(page)}</strong></div><div className="topbar-right">{localePicker}<span className="topbar-divider"/><span className="top-date">{dateText(new Date().toISOString())}</span></div></header>
      <main>
        {browserDemo&&<section className="browser-demo-controls"><p>{t('browserDemoNotice')}</p><div><label>{t('switchRole')}<select aria-label={t('switchRole')} value={role||'cfo'} onChange={async e=>{const next=e.target.value;try{await api('/auth/login',{email:`${next}@civproj.demo`,password:'Demo2026!'});await loadUser();setPage('overview');setProjectId('');setProjectsReady(false);setRevision(n=>n+1);}catch(err){fail(err);}}}>{roles.map(value=><option value={value} key={value}>{t(value)}</option>)}</select></label><button className="button secondary" onClick={()=>location.reload()}>{t('resetDemo')}</button></div></section>}

        {user.email.endsWith('@civproj.demo')&&<div className="demo-banner"><span><span className="demo-dot"/>{t('demo')}</span>{t('demoHint')}</div>}
        <div className="page-heading"><div><div className="eyebrow">{t('welcome')}</div><h1>{t(page)}</h1><p>{t(`${page}Sub`)}</p></div><div className="heading-actions">{project&&<a className="button secondary" href={`/api${base}/report.csv`}><ArrowDownToLine size={16}/>{t('export')}</a>}{page==='projects'&&canBudget?<button className="button primary" onClick={()=>setModal('project')}><Plus size={17}/>{t('newProject')}</button>:canEdit&&project&&['overview','costs','approvals'].includes(page)&&<button className="button primary" onClick={()=>setModal('entry')}><Plus size={17}/>{t('newEntry')}</button>}</div></div>
        {error&&<div className="error-banner" role="alert"><div><strong>{t('error')}</strong><span>{t(error)}</span></div><button className="text-button" onClick={()=>{setError('');setRevision(n=>n+1);}}>{t('retry')}</button><button className="icon-button" aria-label={t('close')} onClick={()=>setError('')}><X size={18}/></button></div>}
        {page==='team'?<section className="panel"><div className="panel-heading"><div><h2>{t('team')}</h2><p>{t('memberHint')}</p></div>{role==='ceo'&&!browserDemo&&<button className="button primary" onClick={()=>setModal('member')}><Plus size={16}/>{t('addMember')}</button>}</div><div className="table-wrap"><table><thead><tr><th>{t('name')}</th><th>{t('email')}</th><th>{t('role')}</th></tr></thead><tbody>{members.map(member=><tr key={member.id}><td><strong>{member.name}</strong></td><td>{member.email}</td><td><span className="badge neutral">{t(member.role)}</span></td></tr>)}</tbody></table></div></section>
        :!projectsReady?<div className="page-loading">{t('loading')}</div>:!projects.length?<div className="empty-state panel"><FolderKanban size={42}/><h2>{t('noProjects')}</h2><p>{t('noProjectsSub')}</p>{canBudget&&<button className="button primary" onClick={()=>setModal('project')}><Plus size={16}/>{t('newProject')}</button>}</div>
        :page==='projects'?<div className="project-grid">{projects.map(p=><button key={p.id} className="project-card panel" onClick={()=>{setProjectId(p.id);navigate('overview');}}><div className="project-card-top"><span className="project-avatar"><Building2 size={24}/></span><ArrowUpRight size={20}/></div><h2>{p.name}</h2><p>{p.client} · {p.location}</p><div className="project-card-total"><span>{t('budget')}</span><strong>{money(p.budget,false,p.currency)}</strong></div><div className="progress-track"><span style={{width:`${Math.min(100,Number(p.actual)/Math.max(1,Number(p.budget))*100)}%`}}/></div><div className="project-card-footer"><span>{t('actual')}: {money(p.actual,true,p.currency)}</span><span className="badge neutral">{p.currency}</span></div></button>)}</div>
        :project&&<>
          <section className="project-strip"><span className="project-avatar"><Building2 size={23}/></span><div className="project-selector"><label htmlFor="project-select">{t('currentProject')}</label><select id="project-select" value={projectId} onChange={e=>{setProjectId(e.target.value);setError('');}}>{projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></div><div className="project-meta"><span>{project.location}</span><span className="meta-dot"/>{project.client}</div><span className="currency-tag">{project.currency}</span></section>
          {scope!==`${tenantId}/${projectId}`?<div className="page-loading">{t('loading')}</div>:<>
          {(page==='overview'||page==='reports')&&<>
            <div className="stat-grid">{[{key:'budget',icon:Wallet,hint:'budgetHint'},{key:'actual',icon:CircleDollarSign,hint:'actualHint'},{key:'paid',icon:ArrowDownLeft,hint:'paidHint'},{key:'forecast',icon:TrendingUp,hint:'forecastHint'}].map((stat,index)=><section className={`stat-card ${index===3?'stat-featured':''}`} key={stat.key}><div className="stat-label"><span>{t(stat.key)}</span><stat.icon size={19}/></div><strong className="stat-value" title={money(project[stat.key as 'budget'|'actual'|'paid'|'forecast'])}>{money(project[stat.key as 'budget'|'actual'|'paid'|'forecast'],true)}</strong><div className="stat-hint">{index===3?<span className={`mini-tag ${Number(project.variance)<0?'is-negative':''}`}><span/>{t(Number(project.budget)===0?'noBudget':Number(project.variance)<0?'overBudget':'onBudget')}</span>:t(stat.hint)}</div></section>)}</div>
            {page==='overview'&&<>
              <div className="charts-grid"><section className="panel monthly-panel"><div className="panel-heading"><div><h2>{t('monthlyActivity')}</h2><p>{t('monthlySub')}</p></div><div className="chart-key"><span><i/>{t('invoiced')}</span><span><i/>{t('payments')}</span></div></div><MonthlyChart project={project} locale={locale} money={money} empty={t('noActivity')}/></section><section className="panel allocation-panel"><div className="panel-heading"><div><h2>{t('budgetAllocation')}</h2><p>{t('allocationSub')}</p></div>{canBudget&&<button className="icon-button" aria-label={t('budgetEdit')} title={t('budgetEdit')} onClick={()=>setModal('budget')}><Plus size={20}/></button>}</div><div className="allocation-list">{project.categories.map((row,index)=><div className="allocation-row" key={row.category}><div><span><i style={{background:colors[index]}}/>{t(row.category).split(' · ')[1]}</span><strong title={money(row.actual)}>{money(row.actual,true)}</strong></div><div className="allocation-track"><span style={{background:colors[index],width:`${Math.min(100,Number(row.actual)/Math.max(1,Number(row.budget))*100)}%`}}/></div></div>)}</div><div className="allocation-foot">{t('actual')} / {t('budget')}</div></section></div>
              <section className="control-banner"><div className="control-icon"><ShieldCheck size={24}/></div><div><small>{t('financialHealth')}</small><strong>{money(project.variance)} <span>{t('variance').toLowerCase()}</span></strong></div><div className="control-divider"/><div className="control-copy"><span>{t('forecastHint')}</span><small>{t('financialNote')}</small></div>{internal&&pending.length>0&&<button className="text-button" onClick={()=>navigate('approvals')}><span className="pending-number">{pending.length}</span>{t('awaitingReview')}<ArrowRight size={16}/></button>}</section>
              {internal&&<section className="panel recent-panel"><div className="panel-heading"><div><h2>{t('recentActivity')}</h2><p>{t('costsSub')}</p></div><button className="text-button" onClick={()=>navigate('costs')}>{t('viewAll')}<ArrowRight size={15}/></button></div>{recordTable(entries.slice(0,5))}</section>}
            </>}
            {page==='reports'&&<><section className="panel report-panel"><div className="panel-heading"><div className="report-title"><span className="report-icon"><FileSpreadsheet size={24}/></span><div><h2>{t('summaryReport')}</h2><p>{project.name} · {t('today')} {dateText(new Date().toISOString())}</p></div></div><div className="heading-actions"><button className="button secondary" onClick={()=>window.print()}><Printer size={16}/>{t('print')}</button><a className="button primary" href={`/api${base}/report.csv`}><ArrowDownToLine size={16}/>{t('download')}</a></div></div><p className="report-intro">{t('summarySub')}</p>{categoryTable}<div className="report-totals">{(['committed','remaining_commitment','payable','retention','variance'] as const).map(key=><div key={key}><span>{t(key==='remaining_commitment'?'remaining':key)}</span><strong>{money(project[key])}</strong></div>)}</div><div className="report-footnote"><p>{t('reportScope')}</p><p>{t('reportNote')}</p></div></section></>}
          </>}
          {page==='costs'&&<section className="panel"><div className="register-toolbar"><div className="filter-tabs">{['all','commitment','invoice','payment'].map(value=><button key={value} className={filter===value?'selected':''} onClick={()=>setFilter(value)}>{t(value)}</button>)}</div><label className="search-box"><Search size={17}/><input aria-label={t('search')} placeholder={t('search')} value={search} onChange={e=>setSearch(e.target.value)}/></label></div>{recordTable(filtered)}<div className="table-footer">{filtered.length} / {entries.length} · {t('financialNote')}</div></section>}
          {page==='approvals'&&<>{!pending.length?<div className="empty-state panel"><CheckCheck size={42}/><h2>{t('noPending')}</h2><p>{t('noPendingSub')}</p></div>:<><div className="notice"><ShieldCheck size={20}/>{t('decisionHint')}</div><div className="approval-list">{pending.map(entry=><section className="panel approval-card" key={entry.id}><div className="approval-top"><span className="type-icon"><FileSpreadsheet size={22}/></span><div><button className="record-ref" onClick={()=>setDetail(entry)}>{entry.reference} <span>· {t(entry.kind)}</span></button><h3>{entry.description}</h3><p>{entry.vendor} · {t(entry.category)}</p></div><strong className="approval-amount">{money(entry.amount)}</strong></div><div className="approval-bottom"><span><Clock3 size={14}/>{dateText(entry.date)}<span>·</span>{t('submittedBy')} {entry.creator_name}</span><div>{canApprove&&entry.created_by!==user.id?<><button className="button secondary danger" onClick={()=>setReview({entry,decision:'rejected'})}>{t('reject')}</button><button className="button primary" onClick={()=>setReview({entry,decision:'approved'})}><Check size={15}/>{t('approve')}</button></>:<span className="muted">{canApprove?t('ownSubmission'):t('viewOnly')}</span>}</div></div></section>)}</div></>}</>}
          {page==='audit'&&<section className="panel"><div className="panel-heading"><div><h2>{t('audit')}</h2><p>{t('auditHint')}</p></div><ShieldCheck className="muted" size={23}/></div><div className="audit-list">{events.map(event=><details className="audit-event" key={event.id}><summary><span className="audit-event-icon">{event.action.includes('approved')?<Check size={16}/>:<FileClock size={16}/>}</span><span><strong>{t(event.action)}</strong><small>{event.actor_name} · {event.detail.reference?String(event.detail.reference):`#${event.id}`}</small></span><time>{dateText(event.created_at)} {new Date(event.created_at).toLocaleTimeString(localeCode(locale),{hour:'2-digit',minute:'2-digit'})}</time><ChevronDown size={16}/></summary><dl className="audit-detail"><div><dt>{t('recordId')}</dt><dd className="mono">{event.entity_id}</dd></div>{Object.entries(event.detail).map(([key,value])=><div key={key}><dt>{t(key)}</dt><dd>{typeof value==='object'?JSON.stringify(value):String(value??'—')}</dd></div>)}</dl></details>)}{!events.length&&<div className="empty-inline">{t('noAudit')}</div>}</div></section>}
          </>}
        </>}
        <footer className="main-footer"><span>CivProj <span className="footer-dot">·</span> {t('tagline')}</span><span><ShieldCheck size={13}/>{t('financialNote')}</span></footer>
      </main>
    </div>
    {toast&&<div className="toast" role="status"><CheckCheck size={18}/>{toast}</div>}
    {modal==='project'&&<ModalShell title={t('newProject')} onClose={()=>setModal(null)} t={t}><DataForm t={t} submitLabel={t('create')} onSubmit={async values=>{await api(`/tenants/${tenantId}/projects`,values);refreshed();}}><Field label={t('projectName')} name="name" minLength={2} maxLength={160} required/><Field label={t('client')} name="client" maxLength={160} required/><div className="form-row"><Field label={t('location')} name="location" maxLength={160}/><label>{t('currency')}<select name="currency" defaultValue="AED">{['AED','SAR','USD','EUR','IRR'].map(code=><option key={code}>{code}</option>)}</select></label></div></DataForm></ModalShell>}
    {modal==='entry'&&project&&<ModalShell title={t('newEntry')} onClose={()=>setModal(null)} t={t}><EntryForm t={t} entries={entries} onSubmit={async values=>{await api(`${base}/entries`,values);refreshed();}}/></ModalShell>}
    {modal==='budget'&&project&&<ModalShell title={t('budgetEdit')} onClose={()=>setModal(null)} t={t}><DataForm t={t} onSubmit={async values=>{await api(`${base}/budgets`,values);refreshed();}}><label>{t('category')}<select name="category">{categories.map(key=><option value={key} key={key}>{t(key)} · {money(project.categories.find(row=>row.category===key)?.budget||0)}</option>)}</select></label><Field label={`${t('budgetAmount')} (${currency})`} name="amount" type="number" min="0" max="1000000000000" step={currency==='IRR'?'1':'0.01'} required/><label>{t('note')}<textarea name="note" minLength={3} maxLength={500} required placeholder={t('budgetNote')}/></label></DataForm></ModalShell>}
    {modal==='member'&&<ModalShell title={t('addMember')} onClose={()=>setModal(null)} t={t}><MemberForm t={t} projects={projects} onSubmit={async values=>{await api(`/tenants/${tenantId}/members`,values);refreshed();}}/></ModalShell>}
    {review&&<ModalShell title={t('decision')} onClose={()=>setReview(null)} t={t}><div className="review-summary"><span>{review.entry.reference}</span><h3>{review.entry.description}</h3><strong>{money(review.entry.amount)}</strong></div><p className="form-hint">{t('decisionHint')}</p><DataForm t={t} submitLabel={t(review.decision==='approved'?'approve':'reject')} onSubmit={async values=>{await api(`${base}/entries/${review.entry.id}/decision`,{...values,decision:review.decision});refreshed();}}><label>{t('decisionNote')}<textarea name="note" minLength={3} maxLength={500} required/></label></DataForm></ModalShell>}
    {detail&&<ModalShell title={t('details')} onClose={()=>setDetail(null)} t={t}><div className="record-detail-title"><span className={`badge ${detail.status}`}><i/>{t(detail.status)}</span><h3>{detail.description}</h3><strong>{money(detail.amount)}</strong></div><dl className="detail-list">{(['reference','vendor','kind','category','date','quantity','unit','unit_price','net','tax','retention','related_id','created_by','id'] as const).map(key=><div key={key}><dt>{t(({kind:'type',unit_price:'unitPrice',related_id:'linkedRecord',created_by:'submittedBy',id:'recordId',tax:'taxAmount',retention:'retained'} as Record<string,string>)[key]||key)}</dt><dd>{key==='unit_price'?new Intl.NumberFormat(localeCode(locale),{style:'currency',currency,minimumFractionDigits:currency==='IRR'?0:2,maximumFractionDigits:4}).format(Number(detail.unit_price)):['net','tax','retention'].includes(key)?money(detail[key]||0):key==='kind'||key==='category'||key==='unit'?t(String(detail[key])):key==='created_by'?detail.creator_name:key==='related_id'?entries.find(e=>e.id===detail.related_id)?.reference||'—':key==='date'?dateText(detail.date):detail[key]||'—'}</dd></div>)}</dl><p className="form-hint">{t('detailHint')}</p></ModalShell>}
  </div>;
}

function Auth({t,localePicker,onLogin,initialError}:{t:(key:string)=>string;localePicker:ReactNode;onLogin:()=>Promise<void>;initialError:string}) {
  const [register,setRegister]=useState(false);
  const [demoRole,setDemoRole]=useState('cfo');
  const [demoError,setDemoError]=useState('');
  const [demoBusy,setDemoBusy]=useState(false);
  return <div className="auth-shell"><section className="auth-art"><a className="brand" href="#"><span className="brand-icon"><Building2 size={27}/></span><span>Civ<span className="brand-light">Proj</span></span></a><div className="architectural-grid"><div className="building building-one"/><div className="building building-two"/><div className="building building-three"/><span className="architecture-line line-one"/><span className="architecture-line line-two"/></div><div className="auth-art-copy"><span className="auth-eyebrow"><HardHat size={18}/> {t('welcome')}</span><h1>{t('tagline')}</h1><p>{t('loginSub')}</p><div className="auth-art-rule"/><span>01 — {t('costs')}<br/>02 — {t('approvals')}<br/>03 — {t('reports')}</span></div></section><section className="auth-main"><div className="auth-language">{localePicker}</div><div className="auth-form"><span className="auth-mark"><Building2 size={25}/></span><h2>{t(register?'registerTitle':'loginTitle')}</h2><p>{t(register?'registerSub':'loginSub')}</p>{initialError&&<div className="form-error" role="alert">{t(initialError)}</div>}<DataForm key={String(register)} t={t} submitLabel={t(register?'register':'login')} onSubmit={async values=>{await api(register?'/auth/register':'/auth/login',values);await onLogin();}}>{register&&<><Field label={t('name')} name="name" autoComplete="name" minLength={2} maxLength={120} required/><Field label={t('organization')} name="organization" autoComplete="organization" minLength={2} maxLength={120} required/></>}<Field label={t('email')} name="email" type="email" autoComplete="email" required/><Field label={t('password')} name="password" type="password" autoComplete={register?'new-password':'current-password'} minLength={register?12:1} maxLength={128} placeholder={register?t('passwordHint'):undefined} required/></DataForm>{!browserDemo&&<div className="auth-toggle">{t(register?'hasAccount':'noAccount')} <button className="text-button" onClick={()=>{setRegister(v=>!v);setDemoError('');}}>{t(register?'login':'register')}</button></div>}{import.meta.env.VITE_ENABLE_DEMO !== 'false' && <div className="demo-login"><label>{t('demoAccount')}<select value={demoRole} onChange={e=>setDemoRole(e.target.value)}>{roles.map(role=><option key={role} value={role}>{t(role)}</option>)}</select></label><button className="button secondary" disabled={demoBusy} onClick={async()=>{setDemoBusy(true);setDemoError('');try{await api('/auth/login',{email:`${demoRole}@civproj.demo`,password:'Demo2026!'});await onLogin();}catch(error){setDemoError(error instanceof Error?error.message:t('unknownError'));}finally{setDemoBusy(false);}}}>{t(demoBusy?'loading':'demoLogin')}<ArrowRight size={16}/></button><small>{t('demoPassword')}</small>{demoError&&<p className="form-error" role="alert">{t(demoError)}</p>}</div>}</div><span className="auth-bottom">CivProj · {t('tagline')}</span></section></div>;
}

function Field({label,...props}:{label:string}&React.InputHTMLAttributes<HTMLInputElement>) {return <label>{label}<input {...props}/></label>;}

function ModalShell({title,children,onClose,t}:{title:string;children:ReactNode;onClose:()=>void;t:(key:string)=>string}) {
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';const dialog=document.getElementById('dialog-panel');const controls=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')||[]);controls()[0]?.focus();const listener=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();if(event.key==='Tab'){const items=controls();const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};document.addEventListener('keydown',listener);return()=>{document.body.style.overflow=previousOverflow;document.removeEventListener('keydown',listener);previous?.focus();};},[onClose]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="modal" id="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label={t('close')} onClick={onClose}><X size={20}/></button></header><div className="modal-body">{children}</div></section></div>;
}

function DataForm({children,t,onSubmit,submitLabel}:{children:ReactNode;t:(key:string)=>string;onSubmit:(values:Record<string,unknown>)=>Promise<void>;submitLabel?:string}) {
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));setBusy(true);setError('');try{await onSubmit(values);}catch(err){setError(err instanceof Error?err.message:t('unknownError'));}finally{setBusy(false);}}
  return <form onSubmit={submit} className="data-form"><fieldset disabled={busy}>{children}</fieldset>{error&&<div className="form-error" role="alert">{t(error)}</div>}<button className="button primary form-submit" disabled={busy} type="submit">{busy?t('saving'):submitLabel||t('save')}<ArrowRight size={16}/></button></form>;
}

function EntryForm({t,entries,onSubmit}:{t:(key:string)=>string;entries:Entry[];onSubmit:(values:Record<string,unknown>)=>Promise<void>}) {
  const [kind,setKind]=useState('invoice');const [related,setRelated]=useState('');
  const parent=entries.find(entry=>entry.id===related);
  const parents=entries.filter(entry=>entry.status==='approved'&&entry.kind===(kind==='payment'?'invoice':'commitment'));
  return <><p className="form-hint">{t(`${kind}Hint`)}</p><DataForm t={t} submitLabel={t('submit')} onSubmit={values=>onSubmit({...values,kind,related_id:related||null,...(parent?{category:parent.category,vendor:parent.vendor}:{}),tax_rate:kind==='invoice'?values.tax_rate:'0',retention_rate:kind==='invoice'?values.retention_rate:'0'})}>
    <div className="form-row"><label>{t('type')}<select name="kind" value={kind} onChange={e=>{setKind(e.target.value);setRelated('');}}>{['commitment','invoice','payment'].map(value=><option value={value} key={value}>{t(value)}</option>)}</select></label><Field label={t('reference')} name="reference" maxLength={100} required/></div>
    {kind!=='commitment'&&<label>{t('linkedRecord')}<select name="related_id" value={related} onChange={e=>setRelated(e.target.value)} required={kind==='payment'}><option value="">{kind==='payment'?t('required'):t('noLink')}</option>{parents.map(entry=><option value={entry.id} key={entry.id}>{entry.reference} · {entry.vendor} · {entry.amount}</option>)}</select></label>}
    <Field label={t('description')} name="description" minLength={3} maxLength={500} required/>
    {parent?<div className="linked-summary">{parent.vendor} · {t(parent.category)}</div>:<div className="form-row"><Field label={t('vendor')} name="vendor" maxLength={160} required/><label>{t('category')}<select name="category">{categories.map(category=><option value={category} key={category}>{t(category)}</option>)}</select></label></div>}
    <div className="form-row three"><Field label={t('quantity')} name="quantity" type="number" min="0.0001" max="1000000000" step="0.0001" defaultValue="1" required/><label>{t('unit')}<select name="unit" aria-label={t('unit')} defaultValue="each">{['each','ls','m','m2','m3','kg','t','hr','day'].map(unit=><option value={unit} key={unit}>{t(unit)}</option>)}</select></label><Field label={t('unitPrice')} name="unit_price" type="number" min="0.0001" max="1000000000000" step="0.0001" required/></div>
    {kind==='invoice'&&<><div className="form-row"><Field label={t('tax')} name="tax_rate" type="number" min="0" max="100" step="0.0001" defaultValue="5" required/><Field label={t('retentionRate')} name="retention_rate" type="number" min="0" max="100" step="0.0001" defaultValue="0" required/></div><p className="form-hint small">{t('taxHint')}</p></>}
    <Field label={t('date')} name="date" type="date" defaultValue={new Intl.DateTimeFormat('en-CA').format(new Date())} required/>
  </DataForm></>;
}

function MemberForm({t,projects,onSubmit}:{t:(key:string)=>string;projects:Project[];onSubmit:(values:Record<string,unknown>)=>Promise<void>}) {
  const [role,setRole]=useState('manager');const [selected,setSelected]=useState<string[]>([]);
  return <><p className="form-hint">{t('memberHint')}</p><DataForm t={t} onSubmit={values=>onSubmit({...values,role,project_ids:role==='customer'?selected:[]})}><Field label={t('email')} name="email" type="email" required/><label>{t('role')}<select name="role" aria-label={t('role')} value={role} onChange={e=>setRole(e.target.value)}>{roles.map(value=><option key={value} value={value}>{t(value)}</option>)}</select></label>{role==='customer'&&<div className="checkbox-list"><strong>{t('customerProjects')}</strong>{projects.map(project=><label key={project.id}><input type="checkbox" checked={selected.includes(project.id)} onChange={e=>setSelected(previous=>e.target.checked?[...previous,project.id]:previous.filter(id=>id!==project.id))}/>{project.name}</label>)}</div>}</DataForm></>;
}

function MonthlyChart({project,locale,money,empty}:{project:Project;locale:Locale;money:(value:string|number,compact?:boolean)=>string;empty:string}) {
  if (!project.trend.length) return <div className="empty-chart">{empty}</div>;
  const data=project.trend.slice(-6);const max=Math.max(1,...data.flatMap(row=>[Number(row.invoice),Number(row.payment)]));
  return <div className="monthly-chart"><div className="chart-y">{[1,.75,.5,.25,0].map(ratio=><span key={ratio}>{money(max*ratio,true)}</span>)}</div><div className="chart-plot"><div className="chart-gridlines">{[0,1,2,3,4].map(i=><i key={i}/>)}</div><div className="chart-bars">{data.map(row=><div className="chart-month" key={row.month}><div className="bar-pair"><div className="chart-bar invoice-bar" style={{height:`${Number(row.invoice)/max*100}%`}} title={`${row.month} · ${money(row.invoice)}`}><span>{money(row.invoice,true)}</span></div><div className="chart-bar payment-bar" style={{height:`${Number(row.payment)/max*100}%`}} title={`${row.month} · ${money(row.payment)}`}><span>{money(row.payment,true)}</span></div></div><span className="month-label">{new Intl.DateTimeFormat(localeCode(locale),{month:'short',year:'2-digit'}).format(new Date(`${row.month}-15T12:00:00`))}</span></div>)}</div></div></div>;
}
