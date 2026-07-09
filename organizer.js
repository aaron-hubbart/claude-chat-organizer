
// Org UUID is resolved from the active claude.ai session at load time
// (see resolveOrg). No org identifier is hardcoded in this file.
let ORG = null;
let BASE = null;
const PAGE = 50;

// Low-level call: sends an absolute claude.ai API path through the
// background service worker, which executes it inside a claude.ai tab.
function raw(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    function handler(e) {
      if (e.data?.type === 'ORGANIZER_RESPONSE' && e.data.id === id) {
        window.removeEventListener('message', handler);
        if (e.data.error) reject(new Error(e.data.error));
        else resolve({
          ok: e.data.ok,
          status: e.data.status,
          json: () => Promise.resolve(e.data.body),
          text: () => Promise.resolve(JSON.stringify(e.data.body))
        });
      }
    }
    window.addEventListener('message', handler);
    window.postMessage({ type: 'ORGANIZER_REQUEST', id, path, opts }, '*');
  });
}

// Org-scoped call: prepends the resolved org base path.
function api(path, opts = {}) {
  if (!BASE) return Promise.reject(new Error('Org not resolved. Call resolveOrg() first.'));
  return raw(BASE + path, opts);
}

// Resolve the current org UUID from the session bootstrap payload.
// Picks the first org the account belongs to. Cached for the tab lifetime.
async function resolveOrg() {
  if (ORG) return ORG;
  const r = await raw('https://claude.ai/api/bootstrap');
  if (r.status === 401 || r.status === 403) {
    const e = new Error('unauthenticated'); e.code = 401; throw e;
  }
  const d = await r.json();
  const orgs = d?.account?.memberships
    ? d.account.memberships.map(m => m.organization).filter(Boolean)
    : (d?.organizations || []);
  const org = orgs[0];
  if (!org?.uuid) throw new Error('No organization found on this account.');
  ORG = org.uuid;
  BASE = `https://claude.ai/api/organizations/${ORG}`;
  return ORG;
}

function items(d) { return Array.isArray(d) ? d : (d.data || d.projects || d.conversations || d.items || []); }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth()+1}/${d.getDate()}`; }
function suggest(title, projects) {
  if (!title || !projects.length) return '';
  const t = title.toLowerCase();
  let best = '', bestScore = 0;
  for (const p of projects) {
    const words = p.name.toLowerCase().split(/[\s\-_&/]+/).filter(w => w.length > 2);
    const score = words.reduce((acc, w) => acc + (t.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = p.uuid; }
  }
  return best;
}
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Dark mode init
if (localStorage.getItem('dark')==='1') document.body.classList.add('dark');

let state = {
  loaded: false, executing: false, showLog: false, filterMode: 'all',
  projects: [], chats: [], assignments: {}, originals: {},
  pendingPrefixes: new Set(), pendingDeletes: new Set(), collapsed: new Set(),
  log: [], status: { msg: 'Click Load to start.', type: 'idle' },
};

function setState(patch) { Object.assign(state, patch); render(); }
function addLog(msg, type = 'info') {
  state.log.push({ msg, type });
  const wrap = document.querySelector('.log-wrap');
  if (wrap) { wrap.innerHTML += `<div class="log-line ${type}">${esc(msg)}</div>`; wrap.scrollTop = wrap.scrollHeight; }
}

function groupedChats() {
  const map = new Map(); const unassigned = [];
  for (const c of state.chats) {
    if (state.pendingDeletes.has(c.uuid)) continue;
    const pid = state.assignments[c.uuid];
    if (pid && !pid.startsWith('__new__:')) {
      if (!map.has(pid)) { const p = state.projects.find(p=>p.uuid===pid); map.set(pid,{name:p?p.name:pid,uuid:pid,chats:[]}); }
      map.get(pid).chats.push(c);
    } else if (pid && pid.startsWith('__new__:')) {
      const name = pid.replace('__new__:','');
      if (!map.has(pid)) map.set(pid,{name:`${name} (new)`,uuid:pid,chats:[]});
      map.get(pid).chats.push(c);
    } else { unassigned.push(c); }
  }
  return { groups:[...map.values()].sort((a,b)=>a.name.localeCompare(b.name)), unassigned };
}

function visibleChats(list) {
  if (state.filterMode==='all') return list;
  if (state.filterMode==='unassigned') return list.filter(c=>!state.assignments[c.uuid]);
  if (state.filterMode==='changed') return list.filter(c=>state.assignments[c.uuid]!==state.originals[c.uuid]);
  return list;
}

function allProjectOptions(sel) {
  return [...state.projects].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${p.uuid}"${p.uuid===sel?' selected':''}>${esc(p.name)}</option>`).join('')+
    [...new Set(Object.values(state.assignments).filter(v=>v&&v.startsWith('__new__:')))].map(v=>`<option value="${v}"${v===sel?' selected':''}>${esc(v.replace('__new__:',''))} (new)</option>`).join('');
}

function renderChatRow(c, num) {
  const pid=state.assignments[c.uuid]||''; const toDelete=state.pendingDeletes.has(c.uuid);
  const hasPfx=pid&&state.pendingPrefixes.has(pid);
  const pfxName=pid?.startsWith('__new__:')?pid.replace('__new__:',''):(state.projects.find(p=>p.uuid===pid)?.name||'');
  const pfx=hasPfx?`[${pfxName}] `:'';
  const displayName=pfx&&!(c.name||'').startsWith(pfx)?pfx+c.name:c.name;
  return `<div class="chat-row${toDelete?' deleted':''}" data-uuid="${c.uuid}">
    <span class="row-num">${num}</span>
    <span class="row-title${toDelete?' deleted':''}" title="${esc(c.name)}">${esc(displayName)||'Untitled'}</span>
    <span class="row-date">${fmtDate(c.updated_at)}</span>
    <select class="row-select" data-uuid="${c.uuid}"${toDelete?' disabled':''}>
      <option value=""${!pid?' selected':''}>— skip —</option>
      ${allProjectOptions(pid)}
      <option value="__new__:">+ new project…</option>
    </select>
    <button class="row-del${toDelete?' active':''}" data-uuid="${c.uuid}">${toDelete?'undo':'✕'}</button>
  </div>`;
}

function renderGroup(group, isUnassigned) {
  const pid=group.uuid; const isOpen=!state.collapsed.has(pid);
  const isPfx=state.pendingPrefixes.has(pid);
  const visible=visibleChats(group.chats);
  if (state.filterMode!=='all'&&visible.length===0) return '';
  const rows=(state.filterMode==='all'?group.chats:visible).map((c,i)=>renderChatRow(c,i+1)).join('');
  return `<div class="group">
    <div class="group-header${isOpen?' open':''}${isUnassigned?' unassigned':''}" data-pid="${pid}">
      <span class="chevron${isOpen?' open':''}">&#9658;</span>
      <span class="group-name${isUnassigned?' unassigned':''}">${esc(group.name)}</span>
      <span class="group-count">${group.chats.length} chat${group.chats.length!==1?'s':''}</span>
      ${!isUnassigned?`<button class="prefix-btn${isPfx?' active':''}" data-pfx="${pid}">${isPfx?'[x] prefix':'[ ] prefix'}</button>`:''}
    </div>
    ${isOpen?`<div class="group-body${isUnassigned?' unassigned':''}">${rows}</div>`:''}
  </div>`;
}

function render() {
  const changedCount=state.chats.filter(c=>state.assignments[c.uuid]!==state.originals[c.uuid]&&!state.pendingDeletes.has(c.uuid)).length;
  const assignedCount=Object.values(state.assignments).filter(Boolean).length;
  const {groups,unassigned}=groupedChats();
  document.getElementById('app').innerHTML=`
    <div id="header">
      <div>
        <div style="font-size:15px;font-weight:500">Chat organizer</div>
        <div class="sub">Assign chats to projects, apply prefixes, delete — then execute.</div>
      </div>
      <button id="dark-btn" style="font-size:11px;padding:3px 10px;border:1px solid #d0d0cc;border-radius:5px;background:transparent;cursor:pointer;color:inherit" title="Toggle dark mode">${document.body.classList.contains('dark')?'☀ Light':'☾ Dark'}</button>
    </div>
    <div class="status ${state.status.type}">${esc(state.status.msg)}</div>
    ${!state.loaded
      ?`<button class="btn-primary" id="load-btn">Load projects and chats</button>`
      :`<div class="toolbar">
          <select class="filter" id="filter-sel">
            <option value="all"${state.filterMode==='all'?' selected':''}>All chats</option>
            <option value="unassigned"${state.filterMode==='unassigned'?' selected':''}>Unassigned only</option>
            <option value="changed"${state.filterMode==='changed'?' selected':''}>Changed from original</option>
          </select>
          <span class="pending-count">${changedCount} change${changedCount!==1?'s':''} pending${state.pendingDeletes.size>0?` · ${state.pendingDeletes.size} marked for deletion`:''}</span>
          <button class="btn" id="collapse-all-btn">Collapse all</button>
          <button class="btn" id="expand-all-btn">Expand all</button>
        </div>
        <div class="actions">
          <button class="btn-primary" id="exec-btn"${state.executing?' disabled':''}>
            ${state.executing?'Running…':`Execute${state.pendingDeletes.size>0?` (incl. ${state.pendingDeletes.size} deletion${state.pendingDeletes.size!==1?'s':''})`:''}` }
          </button>
          <button class="btn" id="log-btn">${state.showLog?'Hide log':'Show log'}</button>
          <button class="btn" id="reload-btn">Reload</button>
        </div>
        ${unassigned.length>0?renderGroup({name:'Unassigned',uuid:'__unassigned__',chats:unassigned},true):''}
        ${groups.map(g=>renderGroup(g,false)).join('')}
        <div class="summary">${assignedCount} of ${state.chats.length} chats assigned · ${state.pendingPrefixes.size} prefix group${state.pendingPrefixes.size!==1?'s':''} queued</div>
        ${state.showLog?`<div class="log-wrap">${state.log.map(l=>`<div class="log-line ${l.type}">${esc(l.msg)}</div>`).join('')}</div>`:''}
      `}
  `;
  bindEvents();
}

function bindEvents() {
  document.getElementById('load-btn')?.addEventListener('click', load);
  document.getElementById('collapse-all-btn')?.addEventListener('click',()=>{
    const {groups,unassigned}=groupedChats();
    const allPids=new Set([...groups.map(g=>g.uuid)]);
    state.collapsed=allPids; render();
  });
  document.getElementById('expand-all-btn')?.addEventListener('click',()=>{
    state.collapsed=new Set(); render();
  });
  document.getElementById('exec-btn')?.addEventListener('click', execute);
  document.getElementById('reload-btn')?.addEventListener('click', load);
  document.getElementById('log-btn')?.addEventListener('click', ()=>setState({showLog:!state.showLog}));
  document.getElementById('filter-sel')?.addEventListener('change', e=>setState({filterMode:e.target.value}));
  document.getElementById('dark-btn')?.addEventListener('click',()=>{
    const on=document.body.classList.toggle('dark');
    localStorage.setItem('dark',on?'1':'0');
    render();
  });
  document.querySelectorAll('.group-header').forEach(el=>{
    el.addEventListener('click', e=>{
      if (e.target.closest('.prefix-btn')) return;
      const next=new Set(state.collapsed);
      next.has(el.dataset.pid)?next.delete(el.dataset.pid):next.add(el.dataset.pid);
      state.collapsed=next; render();
    });
  });
  document.querySelectorAll('.prefix-btn').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      const next=new Set(state.pendingPrefixes);
      next.has(btn.dataset.pfx)?next.delete(btn.dataset.pfx):next.add(btn.dataset.pfx);
      state.pendingPrefixes=next; render();
    });
  });
  document.querySelectorAll('.row-select').forEach(sel=>{
    sel.addEventListener('change', e=>{
      const uuid=sel.dataset.uuid;
      if (e.target.value==='__new__:') {
        const name=prompt('New project name:');
        state.assignments[uuid]=(name&&name.trim())?`__new__:${name.trim()}`:(state.originals[uuid]||'');
      } else { state.assignments[uuid]=e.target.value; }
      render();
    });
  });
  document.querySelectorAll('.row-del').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const next=new Set(state.pendingDeletes);
      next.has(btn.dataset.uuid)?next.delete(btn.dataset.uuid):next.add(btn.dataset.uuid);
      state.pendingDeletes=next; render();
    });
  });
}

async function load() {
  state.log=[]; state.pendingDeletes=new Set(); state.pendingPrefixes=new Set(); state.loaded=false;
  setState({status:{msg:'Resolving account…',type:'loading'}});
  try {
    try {
      await resolveOrg();
    } catch (e) {
      if (e.code === 401) { setState({status:{msg:'Not logged in to claude.ai. Open claude.ai in a tab and try again.',type:'err'}}); return; }
      setState({status:{msg:`Error: ${e.message}`,type:'err'}}); return;
    }
    setState({status:{msg:'Fetching projects…',type:'loading'}});
    const pr=await api(`/projects_v2?limit=30&offset=0&filter=is_creator&order_by=updated_at&searchQuery=&is_archived=false`);
    if (pr.status===401||pr.status===403) { setState({status:{msg:'Not logged in to claude.ai. Open claude.ai in a tab and try again.',type:'err'}}); return; }
    const pd=await pr.json(); const projs=items(pd);
    if (!projs.length) { setState({status:{msg:'No projects found.',type:'err'}}); return; }
    state.projects=projs;
    setState({status:{msg:`${projs.length} projects loaded. Fetching chats…`,type:'loading'}});
    let all=[];
    for (let i=0;i<60;i++) {
      const r=await api(`/chat_conversations?limit=${PAGE}&offset=${i*PAGE}`);
      if (!r.ok) { addLog(`Page ${i+1}: HTTP ${r.status}`,'err'); break; }
      const d=await r.json(); const page=items(d);
      if (!page.length) break;
      const tagged=page.map(c=>({...c,project_uuid:c.project_uuid||c.project?.uuid||null}));
      all=all.concat(tagged);
      addLog(`Page ${i+1}: ${page.length} chats (${tagged.filter(c=>c.project_uuid).length} assigned)`);
      if (page.length<PAGE) break;
    }
    const seen=new Set();
    const merged=all.filter(c=>{if(seen.has(c.uuid))return false;seen.add(c.uuid);return true;});
    state.chats=merged;
    const asgn={},orig={};
    for (const c of merged) { const val=c.project_uuid||suggest(c.name,projs); asgn[c.uuid]=val; orig[c.uuid]=val; }
    state.assignments=asgn; state.originals=orig;
    // Collapse all groups except Unassigned by default
    const allPids=new Set(Object.values(asgn).filter(v=>v&&v!=='__unassigned__'));
    state.collapsed=allPids;
    const assignedCount=merged.filter(c=>c.project_uuid).length;
    setState({loaded:true,status:{msg:`${projs.length} projects · ${merged.length} chats (${assignedCount} assigned, ${merged.length-assignedCount} unassigned)`,type:'ok'}});
  } catch(e) { setState({status:{msg:`Error: ${e.message}`,type:'err'}}); }
}

async function execute() {
  state.executing=true; state.showLog=true; render();
  addLog('=== Execution started ===');
  if (state.pendingDeletes.size>0) {
    addLog(`--- Deleting ${state.pendingDeletes.size} chat(s) ---`);
    for (const uuid of state.pendingDeletes) {
      const c=state.chats.find(c=>c.uuid===uuid);
      addLog(`  Deleting: ${c?.name||uuid}`);
      try {
        const r=await api(`/chat_conversations/${uuid}`,{method:'DELETE'});
        if (r.ok||r.status===204) addLog('    OK','ok');
        else { const t=await r.text(); addLog(`    FAILED ${r.status}: ${t.slice(0,120)}`,'err'); }
      } catch(e) { addLog(`    ERROR: ${e.message}`,'err'); }
    }
  }
  const grouped2={},newProjs={};
  for (const [uuid,pid] of Object.entries(state.assignments)) {
    if (!pid||state.pendingDeletes.has(uuid)) continue;
    const chat=state.chats.find(c=>c.uuid===uuid);
    if (chat?.project_uuid===pid) continue;
    if (pid.startsWith('__new__:')) { const name=pid.replace('__new__:',''); (newProjs[name]=newProjs[name]||[]).push(uuid); }
    else { (grouped2[pid]=grouped2[pid]||[]).push(uuid); }
  }
  for (const [name,uuids] of Object.entries(newProjs)) {
    addLog(`Creating project: ${name}`);
    try {
      const r=await api('/projects',{method:'POST',body:JSON.stringify({name,description:'',is_private:true})});
      const d=await r.json();
      if (r.ok&&d.uuid) { addLog(`  Created: ${d.uuid}`,'ok'); grouped2[d.uuid]=uuids; state._newPidMap=state._newPidMap||{}; state._newPidMap[`__new__:${name}`]=d.uuid; state.projects.push(d); }
      else addLog(`  FAILED: ${JSON.stringify(d)}`,'err');
    } catch(e) { addLog(`  ERROR: ${e.message}`,'err'); }
  }
  for (const [pid,uuids] of Object.entries(grouped2)) {
    const pName=state.projects.find(p=>p.uuid===pid)?.name||pid;
    const CHUNK=50;
    const chunks=[];
    for (let i=0;i<uuids.length;i+=CHUNK) chunks.push(uuids.slice(i,i+CHUNK));
    addLog(`Moving ${uuids.length} chat(s) → ${pName}${chunks.length>1?' ('+chunks.length+' batches)':''}`);
    for (let ci=0;ci<chunks.length;ci++) {
      const chunk=chunks[ci];
      if (chunks.length>1) addLog(`  Batch ${ci+1}/${chunks.length}: ${chunk.length} chats`);
      try {
        const r=await api('/chat_conversations/move_many',{method:'POST',body:JSON.stringify({conversation_uuids:chunk,project_uuid:pid})});
        if (r.ok) addLog((chunks.length>1?`  Batch ${ci+1} OK`:'  OK'),'ok');
        else { const t=await r.text(); addLog(`  FAILED ${r.status}: ${t.slice(0,120)}`,'err'); }
      } catch(e) { addLog(`  ERROR: ${e.message}`,'err'); }
    }
  }
  if (state.pendingPrefixes.size>0) {
    addLog('--- Applying prefixes ---');
    for (const pid of state.pendingPrefixes) {
      // For newly-created projects, pid may be a __new__: key that was remapped to a real UUID
      const resolvedPid=state._newPidMap?.[pid]||pid;
      const p=state.projects.find(p=>p.uuid===resolvedPid)||{uuid:resolvedPid,name:pid.replace('__new__:','')};
      if (!resolvedPid) continue;
      const prefix=`[${p.name}] `;
      for (const c of state.chats.filter(c=>(state.assignments[c.uuid]===pid||state.assignments[c.uuid]===resolvedPid)&&!state.pendingDeletes.has(c.uuid))) {
        const currentName=c.name||''; if (currentName.startsWith(prefix)) continue;
        addLog(`  ${currentName} → ${prefix+currentName}`);
        try {
          const r=await api(`/chat_conversations/${c.uuid}`,{method:'PUT',body:JSON.stringify({name:prefix+currentName})});
          if (r.ok) addLog('    OK','ok');
          else { const t=await r.text(); addLog(`    FAILED ${r.status}: ${t.slice(0,80)}`,'err'); }
        } catch(e) { addLog(`    ERROR: ${e.message}`,'err'); }
      }
    }
  }
  addLog('=== Complete ===');
  state.executing=false;
  setState({status:{msg:'Done. Reloading…',type:'ok'}});
  setTimeout(()=>load(), 1200);
}

render();
