/** The admin console page. Self-contained: no external scripts or styles. */
export const ADMIN_PAGE_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenDraft Admin Console</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#1b1f24;--mute:#6a737d;--line:#e3e6ea;--accent:#2f6fed;--ok:#1a7f37;--warn:#b7791f;--bad:#cf222e}
@media(prefers-color-scheme:dark){:root{--bg:#0f1318;--card:#171c23;--text:#e6e9ed;--mute:#8b949e;--line:#2a313a;--accent:#5b92ff;--ok:#3fb950;--warn:#d9a441;--bad:#f85149}}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,sans-serif}
header{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--card);position:sticky;top:0;z-index:2}
header h1{font-size:16px;margin:0;flex:1}header small{color:var(--mute)}
main{padding:16px 20px;max-width:1300px;margin:0 auto}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.card h3{margin:0 0 4px;font-size:12px;color:var(--mute);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.big{font-size:26px;font-weight:650}.sub{color:var(--mute);font-size:12px}
section{margin-top:20px}section>h2{font-size:14px;margin:0 0 8px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--mute);font-weight:600;background:var(--bg)}tr:last-child td{border-bottom:0}
.wrap{overflow-x:auto}.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;border:1px solid var(--line)}
.connected{color:var(--ok);border-color:var(--ok)}.active{color:var(--accent);border-color:var(--accent)}.idle{color:var(--mute)}
.bad{color:var(--bad)}.warn{color:var(--warn)}.empty{color:var(--mute);padding:12px}
button{font:inherit;padding:5px 12px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer}
button:disabled{opacity:.45;cursor:default}button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button.danger{color:var(--bad)}
input{font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--text);width:100%}
#login{max-width:340px;margin:12vh auto;display:grid;gap:10px}#err{color:var(--bad);min-height:1.2em}
svg.spark{width:100%;height:48px;display:block}.legend{display:flex;gap:14px;font-size:12px;color:var(--mute);margin-top:4px}
.g2{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}
.head b{font-size:20px}.bar{display:flex;height:20px;border-radius:5px;overflow:hidden;background:var(--line);margin:8px 0}
.bar i{display:block;height:100%}.leg{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--mute)}
.leg span b{color:var(--text);font-weight:600}.dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:baseline}
.link{text-decoration:none;color:inherit;display:block;cursor:pointer}.link:hover{border-color:var(--accent)}
.link h3:after{content:" \203A";color:var(--accent)}
.back{display:inline-block;margin:0 0 10px;color:var(--accent);text-decoration:none}.back:hover{text-decoration:underline}
.pager{display:flex;gap:10px;align-items:center;margin-top:10px}select{font:inherit;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--text)}
.tag{display:inline-block;padding:0 6px;border-radius:4px;font-size:11px;background:var(--bg);border:1px solid var(--line);color:var(--mute);margin-right:4px}
input[type=search]{max-width:260px;padding:5px 8px}.row{display:flex;gap:10px;align-items:center;margin-bottom:8px}
</style></head><body>
<div id="login" hidden>
  <h1>OpenDraft Admin</h1>
  <input id="email" type="email" placeholder="Admin email" autocomplete="username">
  <input id="password" type="password" placeholder="Password" autocomplete="current-password">
  <button class="primary" id="signin">Sign in</button><div id="err" role="alert"></div>
</div>
<div id="app" hidden>
<header><h1>OpenDraft Admin Console</h1><small id="stamp"></small><small id="who"></small><button id="signout">Sign out</button></header>
<main>
<div id="v-overview">
  <div class="grid" id="tiles"></div>
  <section><h2>Resource usage: used vs free</h2><div class="g2" id="usage"></div>
    <div class="wrap" id="comps" style="margin-top:12px"></div><div class="grid" id="internals" style="margin-top:12px"></div></section>
  <section><h2>Database</h2><div class="g2" id="dbcard"></div></section>
  <section><h2>Last hour</h2><div class="grid" id="charts"></div></section>
  <section><h2>Why people get signed out</h2><div class="wrap" id="auth"></div></section>
  <section><h2>Signed-in users</h2>
    <div class="row"><input id="filter" type="search" placeholder="Filter by name or email"><span class="sub" id="usersum"></span></div>
    <div class="wrap" id="users"></div></section>
  <section><h2>Recent auth events</h2><div class="wrap" id="events"></div></section>
</div>
<div id="v-users" hidden>
  <a class="back" href="#/">&larr; Overview</a>
  <h2 style="margin:0 0 10px;font-size:18px">Registered users</h2>
  <div class="grid" id="usumm"></div>
  <div class="row" style="margin-top:14px"><input id="uq" type="search" placeholder="Search name or email" aria-label="Search users">
    <select id="usort" aria-label="Sort users"><option value="created">Newest first</option><option value="active">Recently active</option><option value="name">Name A-Z</option><option value="email">Email A-Z</option></select>
    <span class="sub" id="ucount"></span></div>
  <div class="wrap" id="utable"></div><div class="pager" id="upager"></div>
</div>
<div id="v-collab" hidden>
  <a class="back" href="#/">&larr; Overview</a>
  <h2 style="margin:0 0 10px;font-size:18px">Collaboration sessions</h2>
  <div class="grid" id="csumm"></div>
  <section><h2>Sessions</h2><div class="wrap" id="csessions"></div></section>
  <section><h2>Live connections</h2><div class="wrap" id="conns"></div></section>
</div>
</main></div>
<script>
(function(){
var KEY='opendraft:admin',$=function(i){return document.getElementById(i)};
var auth=null,data=null,hist=null,timer=null,refreshing=null;
try{auth=JSON.parse(sessionStorage.getItem(KEY)||'null')}catch(e){}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function save(){try{auth?sessionStorage.setItem(KEY,JSON.stringify(auth)):sessionStorage.removeItem(KEY)}catch(e){}}
function ago(t){if(!t)return'—';var s=Math.max(0,Math.round((Date.now()-t)/1000));if(s<60)return s+'s ago';if(s<3600)return Math.round(s/60)+'m ago';if(s<86400)return Math.round(s/3600)+'h ago';return Math.round(s/86400)+'d ago'}
function dur(s){var d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return(d?d+'d ':'')+(h||d?h+'h ':'')+m+'m'}
function show(login){$('login').hidden=!login;$('app').hidden=login}
function post(url,body,tok){return fetch(url,{method:'POST',headers:Object.assign({'Content-Type':'application/json'},tok?{Authorization:'Bearer '+tok}:{}),body:JSON.stringify(body||{})})}
function renew(){
  if(refreshing)return refreshing;
  refreshing=post('/auth/refresh',{refreshToken:auth&&auth.refreshToken}).then(function(r){
    if(!r.ok)throw new Error('refresh refused');return r.json()}).then(function(j){
    auth.accessToken=j.accessToken;auth.refreshToken=j.refreshToken;save();return true})
    .catch(function(){return false}).then(function(ok){refreshing=null;return ok});
  return refreshing;
}
async function api(path,opts){
  opts=opts||{};
  for(var attempt=0;attempt<2;attempt++){
    var r=await fetch('/admin/api'+path,{method:opts.method||'GET',headers:{Authorization:'Bearer '+(auth&&auth.accessToken)}});
    if(r.status===401&&attempt===0&&auth&&auth.refreshToken){if(await renew())continue}
    if(r.status===401||r.status===403){signout(r.status===403?'This account is not an administrator.':'Session ended. Sign in again.');throw new Error('auth')}
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.json();
  }
}
function signout(msg){clearInterval(timer);if(auth&&auth.refreshToken)post('/auth/logout',{refreshToken:auth.refreshToken}).catch(function(){});auth=null;save();show(true);$('err').textContent=msg||''}
$('signout').onclick=function(){signout('')};
$('signin').onclick=async function(){
  $('err').textContent='';
  try{
    var r=await post('/auth/login',{email:$('email').value.trim(),password:$('password').value});
    var j=await r.json().catch(function(){return{}});
    if(!r.ok){$('err').textContent=j.error||('Sign-in failed ('+r.status+')');return}
    if(!j.accessToken){$('err').textContent=j.message||'Extra verification is required for this account; sign in to OpenDraft once from this browser first.';return}
    auth={accessToken:j.accessToken,refreshToken:j.refreshToken};save();$('password').value='';start();
  }catch(e){$('err').textContent='Could not reach the server.'}
};
$('password').addEventListener('keydown',function(e){if(e.key==='Enter')$('signin').click()});
$('filter').addEventListener('input',function(){renderUsers()});

function tile(t,v,s,cls,href){var inner='<h3>'+esc(t)+'</h3><div class="big '+(cls||'')+'">'+esc(v)+'</div><div class="sub">'+esc(s||'')+'</div>';return href?'<a class="card link" href="'+href+'">'+inner+'</a>':'<div class="card">'+inner+'</div>'}
function pctCls(p){return p>=90?'bad':p>=75?'warn':''}
function renderTiles(){
  var s=data.system,c=data.counts,h=data.http,a=data.actions24h;
  $('tiles').innerHTML=
   tile('Active users',c.activeUsers,c.signedInUsers+' signed in · '+c.signedInSessions+' devices')+
   tile('Collaboration sessions',c.liveCollabSessions,c.wsConnections+' people connected · '+c.openInvites+' open invites','','#/collab')+
   tile('Event-loop lag',s.loopLagMs+' ms','p99; above ~100 ms clients stall',s.loopLagMs>100?'bad':s.loopLagMs>40?'warn':'')+
   tile('HTTP since start',h.requests,h.errors5xx+' server errors · '+h.errors4xx+' client errors · avg '+h.avgLatencyMs+' ms')+
   tile('Registered users',c.registeredUsers,'+'+c.newUsers24h+' in 24 h · view all','','#/users')+
   tile('Uptime',dur(s.process.uptimeSec),s.hostname+' · node '+s.node);
  $('stamp').textContent='updated '+new Date(data.generatedAt).toLocaleTimeString();
}
var COLORS={collab:'#2f6fed',backend:'#8957e5',frontend:'#d9a441',postgres:'#1a7f37'};
function gb(mb){return mb>=1024?(Math.round(mb/102.4)/10)+' GB':Math.round(mb)+' MB'}
function stacked(title,usedPct,usedText,freeText,freeName,segs,loadNote){
  var other=Math.max(0,usedPct-segs.reduce(function(a,x){return a+x.pct},0)),freePct=Math.max(0,100-usedPct);
  var all=segs.concat([{label:(data.system.scope==='container'?'Other processes in container':'Other apps / system'),pct:other,color:'#8b949e',text:''}]);
  var bar=all.map(function(x){return x.pct>0?'<i style="width:'+x.pct+'%;background:'+x.color+'" title="'+esc(x.label)+' '+(Math.round(x.pct*10)/10)+'%"></i>':''}).join('');
  var leg=all.map(function(x){return'<span><span class="dot" style="background:'+x.color+'"></span>'+esc(x.label)+' <b>'+(Math.round(x.pct*10)/10)+'%</b>'+(x.text?' ('+esc(x.text)+')':'')+'</span>'}).join('')+
    '<span><span class="dot" style="background:var(--line);border:1px solid var(--mute)"></span>'+esc(freeName)+' <b>'+(Math.round(freePct*10)/10)+'%</b></span>';
  return'<div class="card"><h3>'+esc(title)+'</h3><div class="head"><b class="'+pctCls(usedPct)+'">Used '+(Math.round(usedPct*10)/10)+'%</b><span><b class="ok" style="font-size:20px;color:var(--ok)">'+esc(freeName)+' '+(Math.round(freePct*10)/10)+'%</b></span></div>'+
   '<div class="bar" role="img" aria-label="'+esc(title)+' used '+usedPct+' percent">'+bar+'</div><div class="sub">'+esc(usedText)+' · '+esc(freeText)+(loadNote?' · '+esc(loadNote):'')+'</div><div class="leg" style="margin-top:6px">'+leg+'</div></div>';
}
function renderUsage(){
  var s=data.system,comps=data.components||[];
  var ramSegs=comps.filter(function(c){return c.found}).map(function(c){return{label:c.label,pct:c.rssMb/s.memTotalMb*100,color:COLORS[c.key]||'#999',text:gb(c.rssMb)}});
  var cpuSegs=comps.filter(function(c){return c.found}).map(function(c){return{label:c.label,pct:c.cpuPct,color:COLORS[c.key]||'#999',text:''}});
  var ctr=s.scope==='container';
  var out=stacked(ctr?'Memory (container limit)':'Memory (RAM)',s.memPct,gb(s.memUsedMb)+' used of '+gb(s.memTotalMb)+(ctr?' limit (host has '+gb(s.hostMemMb)+')':''),gb(s.memTotalMb-s.memUsedMb)+' free','Free',ramSegs,'')+
          stacked(ctr?'CPU (container quota)':'CPU',s.cpuPct,s.cpuCount+(ctr?' CPU quota (host has '+s.hostCores+' cores)':' cores, whole machine'),(Math.round((100-s.cpuPct)*10)/10)+'% idle','Idle',cpuSegs,ctr?'':'load '+s.loadAvg.join(' / '));
  var i=data.collabInternals;
  if(i&&i.diskTotalGb){var dp=(1-i.diskFreeGb/i.diskTotalGb)*100;
    out+=stacked('Disk (collab data volume)',dp,(Math.round((i.diskTotalGb-i.diskFreeGb)*10)/10)+' GB used of '+i.diskTotalGb+' GB',i.diskFreeGb+' GB free','Free',[
      {label:'Documents + database',pct:((i.documentsMb+(i.databaseMb||0))/1024)/i.diskTotalGb*100,color:COLORS.collab,text:gb(i.documentsMb+(i.databaseMb||0))}],'')}
  $('usage').innerHTML=out;
}
function renderComps(){
  var rows=(data.components||[]).map(function(c){
   return'<tr><td><span class="dot" style="background:'+(COLORS[c.key]||'#999')+'"></span>'+esc(c.label)+'</td><td>'+(c.found?'<span class="pill connected">running</span>':'<span class="pill idle">not found</span>')+'</td><td>'+c.processes+'</td><td>'+(c.found?c.cpuPct+(data.system.scope==='container'?'% of container':'% of machine'):'—')+'</td><td>'+(c.found?gb(c.rssMb):'—')+'</td><td class="sub">'+esc(c.note)+'</td></tr>'});
  $('comps').innerHTML=table(['OpenDraft component','Status','Processes','CPU','RAM','Detail'],rows,'No component data.');
  var i=data.collabInternals;if(!i){$('internals').innerHTML='';return}
  $('internals').innerHTML=
   tile('Collab heap',i.heapUsedMb+' MB','of '+i.heapTotalMb+' MB allocated')+
   tile('Buffers (Yjs data)',i.arrayBuffersMb+' MB','external '+i.externalMb+' MB')+
   tile('Documents in memory',i.loadedDocuments,i.documentFiles+' saved on disk')+
   tile('Documents on disk',i.documentsMb+' MB',i.documentFiles+' files')+
   '';
}
function renderDb(){
  var d=data.database;if(!d){$('dbcard').innerHTML='';return}
  var i=data.collabInternals||{},label=d.type==='postgresql'?'PostgreSQL':'SQLite';
  var big=d.totalMb>=1024?(Math.round(d.totalMb/102.4)/10)+' GB':d.totalMb+' MB';
  var head='<div class="card"><h3>'+esc(label)+' · '+esc(d.name)+(d.host?' @ '+esc(d.host):'')+'</h3><div class="head"><b>'+esc(big)+' used</b>';
  if(d.type!=='postgresql'&&i.diskTotalGb){head+='<b style="font-size:20px;color:var(--ok)">Disk free '+i.diskFreeGb+' GB</b>'}
  head+='</div><div class="sub">'+(d.type==='postgresql'?'whole database incl. indexes (pg_database_size). Free space belongs to the database server\'s disk and is not visible from here.':'database file incl. WAL, on the collab data volume.')+'</div>';
  var max=Math.max.apply(null,[0.001].concat(d.tables.map(function(t){return t.sizeMb||0})));
  head+=(d.notes||[]).map(function(n){return'<div class="sub warn">'+esc(n)+'</div>'}).join('')+'</div>';
  var rows=d.tables.map(function(t){
   var w=t.sizeMb==null?0:Math.max(1,t.sizeMb/max*100);
   return'<tr><td>'+esc(t.name)+'</td><td>'+(t.rows==null?'—':t.rows.toLocaleString())+'</td><td>'+(t.sizeMb==null?'—':t.sizeMb+' MB')+'</td><td style="width:35%"><div class="bar" style="height:8px;margin:2px 0"><i style="width:'+w+'%;background:'+COLORS.collab+'"></i></div></td></tr>'});
  $('dbcard').innerHTML=head+'<div class="wrap">'+table(['Table','Rows','Size (incl. indexes)',''],rows,'No tables.')+'</div>';
}
function spark(title,keys,colors,unit,max){
  var W=300,H=48,s=hist.samples;if(s.length<2)return'<div class="card"><h3>'+esc(title)+'</h3><div class="sub">collecting…</div></div>';
  var m=max||Math.max.apply(null,[1].concat(s.map(function(x){return Math.max.apply(null,keys.map(function(k){return x[k]}))})));
  var paths=keys.map(function(k,i){
    var pts=s.map(function(x,j){return(j/(s.length-1)*W).toFixed(1)+','+(H-2-(x[k]/m)*(H-4)).toFixed(1)});
    return'<polyline fill="none" stroke="'+colors[i]+'" stroke-width="1.6" points="'+pts.join(' ')+'"/>'}).join('');
  var last=s[s.length-1];
  return'<div class="card"><h3>'+esc(title)+'</h3><svg class="spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="'+esc(title)+' over the last hour">'+paths+'</svg>'+
   '<div class="legend">'+keys.map(function(k,i){return'<span><span style="color:'+colors[i]+'">●</span> '+esc(k)+' '+last[k]+unit+'</span>'}).join('')+'<span>max '+Math.round(m*10)/10+unit+'</span></div></div>';
}
function renderCharts(){
  $('charts').innerHTML=spark('CPU',['cpu','procCpu'],['#2f6fed','#d9a441'],'%',100)+spark('RAM',['memPct'],['#8957e5'],'%',100)+
   spark('Server RSS',['rssMb'],['#1a7f37'],' MB')+spark('Event-loop lag',['loopLagMs'],['#cf222e'],' ms')+
   spark('WebSocket connections',['ws'],['#2f6fed'],'')+spark('Requests / s',['rps'],['#d9a441'],'');
}
var REASONS={already_used_or_revoked:'Token already used or revoked — a refresh whose reply was lost, two devices sharing one token, or an admin/logout revoke',unknown_token:'Token not in the database — database reset/restored or session pruned',expired:'Refresh token older than the refresh lifetime',malformed_token:'Not a valid token — corrupted client storage',rate_limited:'Refresh blocked by the rate limit (many users behind one IP)',user_missing:'Account no longer exists',diagnosis_failed:'Could not be determined'};
function table(head,rows,empty){if(!rows.length)return'<div class="card empty">'+esc(empty)+'</div>';
  return'<table><thead><tr>'+head.map(function(h){return'<th>'+esc(h)+'</th>'}).join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>'}
function renderAuth(){
  var a=data.actions24h,l=data.limits,n=function(k){return a[k]||0};
  var by={};data.refreshFailuresSinceStart.forEach(function(f){by[f.reason]=(by[f.reason]||0)+1});
  var rows=Object.keys(by).sort(function(x,y){return by[y]-by[x]}).map(function(r){return'<tr><td><b>'+esc(r)+'</b></td><td>'+by[r]+'</td><td>'+esc(REASONS[r]||'')+'</td></tr>'});
  $('auth').innerHTML='<div class="card" style="margin-bottom:10px">Last 24 h: <b>'+n('login')+'</b> logins · <b>'+n('google_login')+'</b> Google logins · <b>'+n('token_refresh')+'</b> refreshes · <b class="'+(n('token_refresh_failed')?'bad':'')+'">'+n('token_refresh_failed')+'</b> refused refreshes · <b class="'+(n('refresh_rate_limited')?'bad':'')+'">'+n('refresh_rate_limited')+'</b> rate-limited · <b>'+n('logout')+'</b> logouts · '+n('login_failed')+' failed logins.<br><span class="sub">Access token '+esc(l.accessTokenExpiry)+', refresh token '+esc(l.refreshTokenExpiry)+', refresh limit '+l.refreshRateLimitPer15Min+' per IP per 15 min. A refused refresh signs the user out.</span></div>'+
   table(['Refusal reason (since server start)','Count','Meaning'],rows,'No refused refreshes since the server started.');
}
function renderUsers(){
  var q=($('filter').value||'').toLowerCase(),list=data.users.filter(function(u){return!q||(u.name+' '+u.email).toLowerCase().indexOf(q)>=0});
  $('usersum').textContent=list.length+' of '+data.users.length;
  $('users').innerHTML=table(['User','Status','Last active','Devices','',''],list.map(function(u){
   var dev=u.sessions.map(function(s){return esc(s.device)+(s.platform?' ('+esc(s.platform)+')':'')+(s.ip?' · '+esc(s.ip):'')+' · '+ago(s.lastRefresh)}).join('<br>');
   return'<tr><td>'+esc(u.name)+'<div class="sub">'+esc(u.email)+'</div></td><td><span class="pill '+u.status+'">'+u.status+'</span></td><td>'+ago(u.lastActive)+'</td><td class="sub">'+dev+'</td><td></td><td><button class="danger" data-id="'+esc(u.userId)+'" data-email="'+esc(u.email)+'">Sign out</button></td></tr>'}),'No signed-in users.');
}
document.addEventListener('click',async function(e){
  var b=e.target.closest&&e.target.closest('button[data-id]');if(!b)return;
  if(!confirm('Sign '+b.dataset.email+' out of all devices?'))return;
  try{await api('/users/'+encodeURIComponent(b.dataset.id)+'/revoke-sessions',{method:'POST'});refresh();if(view==='users')fetchUsers()}catch(err){if(err.message!=='auth')alert('Failed: '+err.message)}
});
function renderConns(){
  $('conns').innerHTML=table(['Name','Role','Document','IP','Connected'],data.connections.map(function(c){
   return'<tr><td>'+esc(c.name)+(c.email?'<div class="sub">'+esc(c.email)+'</div>':'')+'</td><td>'+esc(c.role)+'</td><td class="sub">'+esc(c.document)+'</td><td>'+esc(c.ip)+'</td><td>'+ago(c.since)+'</td></tr>'}),'Nobody is in a live collaboration session.');
}
function renderEvents(){
  $('events').innerHTML=table(['When','Event','Detail','IP'],data.recentEvents.map(function(e){
   var d='';try{var j=JSON.parse(e.detail||'null');d=j?Object.keys(j).map(function(k){return k+': '+j[k]}).join(', '):''}catch(x){d=e.detail||''}
   var bad=e.action.indexOf('failed')>=0||e.action.indexOf('limited')>=0;
   return'<tr><td>'+ago(Date.parse(e.created_at))+'</td><td class="'+(bad?'bad':'')+'">'+esc(e.action)+'</td><td class="sub">'+esc(d)+'</td><td>'+esc(e.ip_address||'')+'</td></tr>'}),'No events yet.');
}
function fmtDate(t){return t?new Date(t).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'—'}
var uState={q:'',page:1,sort:'created'},uData=null,view='overview',uTimer=null;
function renderUsersPage(){
  var d=uData;if(!d)return;var sm=d.summary;
  $('usumm').innerHTML=tile('Registered',sm.total,'+'+sm.new24h+' in 24 h · +'+sm.new7d+' in 7 days')+tile('Email verified',sm.verified,(sm.total-sm.verified)+' not verified')+tile('Google sign-in',sm.google,'linked to a Google account')+tile('Two-factor on',sm.twoFactor,'new-device verification');
  var pages=Math.max(1,Math.ceil(d.matched/d.pageSize));
  $('ucount').textContent=d.matched+(uState.q?' matching':' users')+' · page '+d.page+' of '+pages;
  $('utable').innerHTML=table(['User','Verified','Sign-in','Registered','Last active','Sessions','Status',''],d.users.map(function(u){
   return'<tr><td>'+esc(u.name)+(u.isAdmin?' <span class="tag">admin</span>':'')+'<div class="sub">'+esc(u.email)+'</div></td>'+
    '<td>'+(u.verified?'<span class="pill connected">yes</span>':'<span class="pill idle">no</span>')+'</td>'+
    '<td>'+(u.password?'<span class="tag">password</span>':'')+(u.google?'<span class="tag">Google</span>':'')+(u.twoFactor?'<span class="tag">2FA</span>':'')+'</td>'+
    '<td>'+fmtDate(u.createdAt)+'</td><td>'+(u.lastActive?ago(u.lastActive):'never')+'</td>'+
    '<td>'+u.sessions+' signed in<div class="sub">'+u.devices+' known devices</div></td>'+
    '<td>'+(u.online?'<span class="pill active">active</span>':'<span class="pill idle">offline</span>')+'</td>'+
    '<td>'+(u.sessions?'<button class="danger" data-id="'+esc(u.id)+'" data-email="'+esc(u.email)+'">Sign out</button>':'')+'</td></tr>'}),uState.q?'No users match that search.':'No registered users.');
  $('upager').innerHTML='<button id="uprev"'+(d.page<=1?' disabled':'')+'>&larr; Previous</button><button id="unext"'+(d.page>=pages?' disabled':'')+'>Next &rarr;</button>';
  $('uprev').onclick=function(){uState.page--;fetchUsers()};$('unext').onclick=function(){uState.page++;fetchUsers()};
}
async function fetchUsers(){
  try{uData=await api('/users?q='+encodeURIComponent(uState.q)+'&page='+uState.page+'&sort='+uState.sort);renderUsersPage()}
  catch(e){if(e.message!=='auth')$('ucount').textContent='could not load users: '+e.message}
}
$('uq').addEventListener('input',function(){clearTimeout(uTimer);uTimer=setTimeout(function(){uState.q=$('uq').value.trim();uState.page=1;fetchUsers()},300)});
$('usort').addEventListener('change',function(){uState.sort=$('usort').value;uState.page=1;fetchUsers()});
function renderCollabPage(){
  var cs=data.collabSessions||[],c=data.counts,live=cs.filter(function(x){return x.live});
  $('csumm').innerHTML=tile('Live sessions',c.liveCollabSessions,live.length?'scripts being edited right now':'nobody collaborating now')+tile('People connected',c.wsConnections,c.wsUsers+' distinct users')+tile('Open invites',c.openInvites,'issued, not yet expired or revoked')+tile('Documents in memory',data.collabInternals?data.collabInternals.loadedDocuments:0,'held by the server');
  $('csessions').innerHTML=table(['Script','Status','Host','In the session now','Open invites','Started'],cs.map(function(x){
   var who=x.participants.map(function(p){return esc(p.name)+' <span class="tag">'+esc(p.role)+'</span>'}).join('<br>');
   var inv=Object.keys(x.invitedRoles).map(function(r){return x.invitedRoles[r]+' '+esc(r)}).join(', ');
   return'<tr><td class="sub">project '+esc(String(x.projectId).slice(0,8))+'<br>script '+esc(String(x.scriptId).slice(0,8))+'</td><td>'+(x.live?'<span class="pill connected">live · '+x.participants.length+'</span>':'<span class="pill idle">invites only</span>')+'</td><td>'+esc(x.host||'—')+'</td><td>'+(who||'<span class="sub">nobody</span>')+'</td><td>'+(x.openInvites?x.openInvites+'<div class="sub">'+inv+'</div>':'0')+'</td><td>'+ago(x.startedAt||x.firstInvite)+'</td></tr>'}),'No active collaboration sessions or open invites.');
  renderConns();
}
function route(){
  var h=location.hash;view=h.indexOf('#/users')===0?'users':h.indexOf('#/collab')===0?'collab':'overview';
  $('v-overview').hidden=view!=='overview';$('v-users').hidden=view!=='users';$('v-collab').hidden=view!=='collab';
  window.scrollTo(0,0);
  if(view==='users')fetchUsers();else if(data&&view==='collab')renderCollabPage();
}
window.addEventListener('hashchange',route);
async function refresh(){
  try{var r=await Promise.all([api('/dashboard'),api('/history')]);data=r[0];hist=r[1];
    renderTiles();renderUsage();renderComps();renderDb();renderCharts();renderAuth();renderUsers();renderEvents();if(view==='collab')renderCollabPage();if(view==='users')fetchUsers()}
  catch(e){if(e.message!=='auth')$('stamp').textContent='update failed: '+e.message}
}
async function start(){
  show(false);
  try{var me=await api('/me');$('who').textContent=me.email}catch(e){return}
  route();await refresh();clearInterval(timer);timer=setInterval(function(){if(!document.hidden)refresh()},5000);
}
if(auth&&auth.accessToken)start();else show(true);
})();
</script></body></html>`;
