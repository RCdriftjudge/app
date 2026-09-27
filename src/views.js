// Pure templates: (state) => HTML string. No DOM or network access here, so Storybook can render every screen.
// Every value that came from a user or the server goes through esc().

export const SCORE_LIMITS={line:35,angle:30,style:35}

export function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])}
const fmt=n=>n==null?'—':String(Math.round(Number(n)*100)/100)
const PHASES={setup:'Registration',qualifying:'Qualifying',tandem:'Tandem battles',finished:'Finished'}

export function joinUrl(s,code){return `${s.appUrl}?join=${encodeURIComponent(code)}`}
export function registerUrl(s,code){return `${s.appUrl}?register=${encodeURIComponent(code)}`}

function qr(s,text,label){
  const src=s.qr?.[text]
  return `<figure class="qr">${src?`<img alt="QR code: ${esc(label)}" src="${src}">`:`<div class="qrSlot" data-qr="${esc(text)}"></div>`}<figcaption>${esc(label)}</figcaption></figure>`
}
const driverMap=s=>Object.fromEntries((s.data?.drivers||[]).map(d=>[d.id,d]))
const carTag=d=>d?`<span class="car">#${esc(d.car_number)}</span>`:''
const driverLabel=d=>d?`${carTag(d)} ${esc(d.name)}`:'<span class="muted">TBD</span>'
const badge=(text,kind='')=>`<span class="badge ${kind}">${esc(text)}</span>`

// ------------------------------------------------------------------------------------------------
// Shell
// ------------------------------------------------------------------------------------------------

export function shell(s){
  const c=s.data?.competition
  return `<main class="${s.displayMode||screenRole(s)==='display'?'displayMode':''}" data-screen="${screenName(s)}" data-phase="${esc(c?.phase||'')}">
<header><div><h1 class="logo"><span>RC</span> <span>Drift</span> <span>Judge</span></h1><small>${c?esc(c.name):'v1.1'}</small></div><div class="hdr">${c?badge(PHASES[c.phase]||c.phase):''}<span class="statusdot ${s.online?'on':''}" title="${s.online?'Online':'Offline'}"></span></div></header>
${!s.online?`<div class="banner warn">Offline. Judge scores and votes are saved on this device and sent when you reconnect.</div>`:''}
${screen(s)}
${s.toast?`<div class="toast ${esc(s.toast.kind||'')}" role="status">${esc(s.toast.text)}</div>`:''}
</main>`
}

// Which screen is showing, for styling only (e.g. the theme decorates landing screens more than working ones).
function screenName(s){
  if(s.page!=='home')return s.page
  if(!s.session)return 'home'
  return s.data?screenRole(s):'loading'
}

export function screenRole(s){
  if(s.page!=='home'||!s.session)return null
  if(s.displayMode)return 'display'
  return s.session.role
}

function screen(s){
  if(s.page==='create')return createView(s)
  if(s.page==='join')return joinView(s)
  if(s.page==='driver')return driverRegisterView(s)
  if(s.page==='rejoin')return rejoinView(s)
  if(!s.session)return homeView(s)
  if(!s.data)return loadingView(s)
  const role=screenRole(s)
  if(role==='director')return directorView(s)
  if(role==='judge')return judgeView(s)
  if(role==='display')return displayView(s)
  return competitorView(s)
}

// ------------------------------------------------------------------------------------------------
// Landing screens
// ------------------------------------------------------------------------------------------------

export function homeView(){
  return `<section class="card hero"><h2>RC Drift Competition</h2><p class="muted">Create an event, join one, or register as a competitor.</p>
<button data-action="nav" data-page="create" class="primary">Create Competition</button>
<button data-action="nav" data-page="join">Join as Judge or Display</button>
<button data-action="nav" data-page="driver">Register as Competitor</button>
<button data-action="nav" data-page="rejoin">Already registered? Rejoin</button></section>`
}

export function loadingView(s){
  return `<section class="card hero">${s.error?`<h2>Can't load the competition</h2><p class="muted">${esc(s.error)}</p><button data-action="refresh" class="primary">Try again</button><button data-action="leave">Leave competition</button>`:'<h2>Loading…</h2>'}</section>`
}

export function createView(){
  return `<form class="card hero" data-submit="create"><h2>Create Competition</h2>
<label>Competition name<input id="competitionName" placeholder="e.g. Saturday Night Drift" required></label>
<label>Your name<input id="directorName" placeholder="Director name"></label>
<fieldset><legend>Number of judges</legend><div class="seg"><label><input type="radio" name="judgeCount" value="2"><span>2 judges</span></label><label><input type="radio" name="judgeCount" value="3" checked><span>3 judges</span></label></div></fieldset>
<button type="submit" class="primary">Create Competition</button><button type="button" data-action="nav" data-page="home">Back</button></form>`
}

export function joinView(s){
  const invite=s.invite?.kind==='judge'?s.invite:null
  return `<form class="card hero" data-submit="join" data-role="judge"><h2>Join Competition</h2>
${invite?`<p class="muted">Joining <b>${esc(invite.competition_name)}</b></p>`:'<p class="muted">Enter the access code from the director.</p>'}
<label>Access code<input id="code" value="${esc(s.joinCode)}" placeholder="K7Q2XM" autocapitalize="characters" autocomplete="off" required ${s.joinCode?'readonly':''}></label>
<label>Your name<input id="name" placeholder="Your name"></label>
<button type="submit" class="primary">Join as Judge</button>
<button type="button" data-action="join" data-role="display">Join as Live Display</button>
<button type="button" data-action="nav" data-page="home">Back</button></form>`
}

export function driverRegisterView(s){
  const invite=s.invite?.kind==='driver'?s.invite:null
  const closed=invite&&invite.registration_open===false
  return `<form class="card hero" data-submit="register"><h2>Register as Competitor</h2>
${invite?`<p class="muted">Registering for <b>${esc(invite.competition_name)}</b></p>`:'<p class="muted">Enter the registration code from the director.</p>'}
${closed?'<div class="banner warn">Registration for this event has closed.</div>':''}
<label>Registration code<input id="driverCode" value="${esc(s.registerCode)}" placeholder="R4D9PL" autocapitalize="characters" autocomplete="off" required ${s.registerCode?'readonly':''}></label>
<label>Driver name<input id="driverName" placeholder="Driver name" required></label>
<label>Team name<input id="teamName" placeholder="Optional"></label>
<button type="submit" class="primary" ${closed?'disabled':''}>Register</button>
<button type="button" data-action="nav" data-page="rejoin">Already registered? Rejoin</button>
<button type="button" data-action="nav" data-page="home">Back</button></form>`
}

export function rejoinView(s){
  return `<form class="card hero" data-submit="rejoin"><h2>Rejoin</h2>
<p class="muted">Restore your driver, judge or director session on this device.</p>
<label>Competition code<input id="rejoinEvent" value="${esc(s.registerCode||s.joinCode)}" placeholder="Judge or driver registration code" autocapitalize="characters" autocomplete="off" required></label>
<label>Rejoin code<input id="rejoinCode" maxlength="6" autocapitalize="characters" autocomplete="off" placeholder="A9" required></label>
<p class="muted small">Drivers and judges have a 2-character code. Directors use their 6-character PIN.</p>
<button type="submit" class="primary">Rejoin</button><button type="button" data-action="nav" data-page="home">Back</button></form>`
}

// ------------------------------------------------------------------------------------------------
// Director
// ------------------------------------------------------------------------------------------------

export function directorView(s){
  const {competition:c}=s.data
  return `${directorControl(s)}
${c.phase==='setup'?driversCard(s):''}
${c.phase!=='setup'?standingsCard(s):''}
${judgesCard(s)}
${invitesCard(s)}
${c.phase!=='setup'?driversCard(s):''}
<section class="card row"><button data-action="openDisplay">Open Live Display</button><button data-action="leave" class="ghost">Leave</button></section>`
}

function directorControl(s){
  const {competition:c,judges,drivers}=s.data
  if(c.phase==='setup'){
    const approved=drivers.filter(d=>d.status==='approved').length
    const pending=drivers.filter(d=>d.status==='pending').length
    const judgesReady=judges.length>=c.judge_count
    const reason=!judgesReady?`Waiting for judges (${judges.length}/${c.judge_count})`:approved<2?'Approve at least 2 drivers':''
    return `<section class="card"><small>DIRECTOR · SETUP</small><h2>Get ready</h2>
<ul class="checks"><li class="${judgesReady?'ok':''}">Judges joined: <b>${judges.length}/${c.judge_count}</b></li><li class="${approved>=2?'ok':''}">Drivers approved: <b>${approved}</b>${pending?` · ${badge(pending+' waiting','warn')}`:''}</li></ul>
<button class="primary big" data-action="startQualifying" ${reason?'disabled':''}>Start Qualifying</button>${reason?`<p class="muted small">${esc(reason)}</p>`:''}</section>`
  }
  if(c.phase==='qualifying')return qualifyingControl(s)
  if(c.phase==='tandem')return battleControl(s)
  return championCard(s)
}

export function qualifyingOrder(s){
  const approved=s.data.drivers.filter(d=>d.status==='approved')
  return [1,2].flatMap(run=>approved.map(d=>({driver:d,run})))
}

function qualifyingControl(s){
  const {competition:c,qualifying_progress:progress,leaderboard,judges}=s.data
  const order=qualifyingOrder(s)
  const i=order.findIndex(o=>o.driver.id===c.active_driver_id&&o.run===c.active_run)
  const cur=order[i]
  const scored=progress.find(p=>p.driver_id===c.active_driver_id&&p.run===c.active_run)?.scored||0
  const sizes=[2,4,8,16,32].filter(n=>n<=leaderboard.length)
  const pick=s.bracketSize&&sizes.includes(s.bracketSize)?s.bracketSize:sizes[sizes.length-1]
  return `<section class="card"><small>DIRECTOR · QUALIFYING</small><h2>On track</h2>
${cur?`<div class="onTrack"><div>${driverLabel(cur.driver)}</div><div>${badge('Run '+cur.run)}</div></div>`:'<p class="muted">Pick a driver below.</p>'}
<p>Judges scored: <b>${scored}/${judges.length}</b>${scored>=c.judge_count?' '+badge('Complete','ok'):''}</p>
<div class="row"><button data-action="qualStep" data-dir="-1" ${i<=0?'disabled':''}>◀ Previous</button><button class="primary" data-action="qualStep" data-dir="1" ${i>=order.length-1?'disabled':''}>Next ▶</button></div>
<details><summary>Jump to driver</summary><div class="list">${order.map(o=>{
    const n=progress.find(p=>p.driver_id===o.driver.id&&p.run===o.run)?.scored||0
    return `<button class="listBtn ${o===cur?'current':''}" data-action="setQualRun" data-driver="${esc(o.driver.id)}" data-run="${o.run}">${driverLabel(o.driver)} <span class="muted">Run ${o.run} · ${n}/${c.judge_count}</span></button>`}).join('')}</div></details>
</section>
<section class="card"><small>END OF QUALIFYING</small><h2>Build tandem bracket</h2>
${sizes.length?`<div class="seg">${sizes.map(n=>`<label><input type="radio" name="bracketSize" value="${n}" data-action="pickBracket" ${n===pick?'checked':''}><span>Top ${n}</span></label>`).join('')}</div>
<button class="primary big" data-action="buildBracket" data-size="${pick}">Build Top ${pick} bracket</button>`:'<p class="muted">At least 2 drivers need a complete qualifying score.</p>'}</section>`
}

function battleControl(s){
  const {competition:c,battles,judges}=s.data
  const d=driverMap(s)
  const b=battles.find(x=>x.id===c.active_battle_id)
  const next=battles.find(x=>x.status==='pending')
  if(!b)return `<section class="card"><small>DIRECTOR · TANDEM</small><h2>Pick a battle</h2>${next?`<button class="primary big" data-action="selectBattle" data-battle="${next.id}">Start next battle</button>`:''}</section>`
  const a=d[b.driver_a_id],bb=d[b.driver_b_id]
  const last=b.history?.[b.history.length-1]
  return `<section class="card"><small>DIRECTOR · ${esc(b.round_name).toUpperCase()} · BATTLE ${b.slot}</small>
${battleHeader(b,d)}
${b.status==='decided'?`<div class="result">${badge('Winner','ok')} ${driverLabel(d[b.winner_driver_id])}${b.decided_by==='director'?' '+badge('Director ruling','warn'):''}</div>${votesLine(last)}
${next?`<button class="primary big" data-action="selectBattle" data-battle="${next.id}">Next battle: ${driverLabel(d[next.driver_a_id])} vs ${driverLabel(d[next.driver_b_id])}</button>`:'<p class="muted">Waiting for the other side of the bracket.</p>'}`
:`${b.attempt?`<p>${badge('One more time #'+b.attempt,'warn')}</p>${votesLine(last,'Previous attempt')}`:''}
<div class="seg runs"><button class="${b.current_run===1?'on':''}" data-action="battleRun" data-battle="${b.id}" data-run="1">Run 1 · ${esc(a?.name)} leads</button><button class="${b.current_run===2?'on':''}" data-action="battleRun" data-battle="${b.id}" data-run="2">Run 2 · ${esc(bb?.name)} leads</button></div>
<p>Judge votes: <b>${b.votes_in}/${judges.length}</b>${b.current_run<2?' <span class="muted">(judges vote after run 2)</span>':''}</p>`}
${callsList(b)}
<details><summary>Director ruling</summary><p class="muted small">Overrides the judges. Allowed until the next battle for these drivers starts.</p>
<div class="row"><button data-action="override" data-battle="${b.id}" data-result="A">${esc(a?.name)} wins</button><button data-action="override" data-battle="${b.id}" data-result="B">${esc(bb?.name)} wins</button><button data-action="override" data-battle="${b.id}" data-result="OMT">One more time</button></div></details>
</section>`
}

function callsList(b){
  if(!b.calls?.length)return ''
  return `<div class="calls"><b>Judge calls</b><ul>${b.calls.map(x=>`<li>⚠ ${esc(x.type)} · Judge ${esc(x.judge_number)} · run ${esc(x.run)}${x.attempt?` · OMT ${x.attempt}`:''}</li>`).join('')}</ul></div>`
}

function votesLine(h,label='Judges'){
  if(!h)return ''
  return `<p class="muted small">${esc(label)}: ${h.votes.map(v=>`J${esc(v.judge_number)} ${esc(v.decision)}`).join(' · ')}</p>`
}

function battleHeader(b,d){
  const a=d[b.driver_a_id],bb=d[b.driver_b_id]
  const lead=b.current_run===1?a:bb
  return `<div class="versus"><div class="${b.winner_driver_id===a?.id?'won':''}"><span class="tag">A · Seed ${esc(a?.seed)}</span>${driverLabel(a)}</div><div class="vs">VS</div><div class="${b.winner_driver_id===bb?.id?'won':''}"><span class="tag">B · Seed ${esc(bb?.seed)}</span>${driverLabel(bb)}</div></div>
${b.status!=='decided'?`<p class="lead">Run ${b.current_run} · <b>${esc(lead?.name)}</b> leads</p>`:''}`
}

function championCard(s){
  const {competition:c,battles}=s.data
  const d=driverMap(s)
  const final=battles.find(b=>b.round_name==='Final'&&b.status==='decided')
  const runnerUp=final?(final.winner_driver_id===final.driver_a_id?final.driver_b_id:final.driver_a_id):null
  return `<section class="card hero"><small>FINISHED</small><h2>🏆 ${driverLabel(d[c.champion_driver_id])}</h2>${runnerUp?`<p>Runner-up: ${driverLabel(d[runnerUp])}</p>`:''}</section>`
}

function standingsCard(s){
  const c=s.data.competition
  return c.phase==='qualifying'?`<section class="card"><small>QUALIFYING RESULTS</small>${leaderboardTable(s)}</section>`:`<section class="card"><small>BRACKET</small>${bracketView(s,true)}</section>`
}

function driversCard(s){
  const {competition:c,drivers}=s.data
  const groups=[['pending','Waiting for approval'],['approved','Approved'],['rejected','Rejected']]
  const open=c.phase==='setup'
  return `<section class="card"><small>DRIVERS</small><h2>${drivers.filter(d=>d.status==='approved').length} approved</h2>
${groups.map(([st,label])=>{const list=drivers.filter(d=>d.status===st);return list.length?`<h3>${label} (${list.length})</h3><ul class="people">${list.map(d=>`<li><div>${driverLabel(d)}${d.team_name?`<br><span class="muted small">${esc(d.team_name)}</span>`:''}</div><div class="actions">${d.rejoin_code?`<span class="muted small" title="Rejoin code">${esc(d.rejoin_code)}</span>`:''}${open&&st!=='approved'?`<button class="small primary" data-action="driverStatus" data-driver="${d.id}" data-status="approved">Approve</button>`:''}${open&&st!=='rejected'?`<button class="small" data-action="driverStatus" data-driver="${d.id}" data-status="rejected">Reject</button>`:''}</div></li>`).join('')}</ul>`:''}).join('')}
${!drivers.length?'<p class="muted">No drivers yet. Share the driver QR code or add drivers here.</p>':''}
${open?`<form class="inline" data-submit="addDriver"><input id="newDriverName" placeholder="Driver name" required><input id="newDriverTeam" placeholder="Team (optional)"><button type="submit">Add driver</button></form>`:'<p class="muted small">The driver list is locked once qualifying starts.</p>'}</section>`
}

function judgesCard(s){
  const {competition:c,judges}=s.data
  const seats=Array.from({length:c.judge_count},(_,i)=>judges.find(j=>j.judge_number===i+1))
  return `<section class="card"><small>JUDGES</small><h2>${judges.length}/${c.judge_count} seated</h2><ul class="people">${seats.map((j,i)=>`<li><div><b>Judge ${i+1}</b> ${j?esc(j.display_name):'<span class="muted">Empty seat</span>'}</div><div class="actions">${j?`<span class="muted small" title="Rejoin code">${esc(j.rejoin_code)}</span><button class="small" data-action="removeJudge" data-member="${j.member_id}" data-name="${esc(j.display_name)}">Remove</button>`:''}</div></li>`).join('')}</ul></section>`
}

function invitesCard(s){
  const c=s.data.competition
  return `<section class="card"><small>ACCESS</small>
<div class="codes"><div><p class="muted">Judges &amp; displays</p><div class="code">${esc(c.join_code)}</div>${qr(s,joinUrl(s,c.join_code),'Scan to join as judge')}</div>
${c.phase==='setup'?`<div><p class="muted">Driver registration</p><div class="code">${esc(c.driver_registration_code)}</div>${qr(s,registerUrl(s,c.driver_registration_code),'Scan to register as competitor')}</div>`:''}</div>
<p class="muted small">Director recovery PIN: ${s.revealPin?`<b class="mono">${esc(c.director_pin)}</b>`:`<button class="small" data-action="revealPin">Show</button>`} · use it with the judge code on “Rejoin” if you change phones.</p></section>`
}

// ------------------------------------------------------------------------------------------------
// Judge
// ------------------------------------------------------------------------------------------------

export function judgeView(s){
  const {competition:c,me}=s.data
  let body
  if(c.phase==='setup')body=`<section class="card hero"><h2>You're Judge ${esc(me.judge_number)}</h2><p class="muted">Waiting for the director to start qualifying.</p></section>`
  else if(c.phase==='qualifying')body=judgeQualifying(s)
  else if(c.phase==='tandem')body=judgeBattle(s)
  else body=championCard(s)
  return `<section class="card judgeHead"><div><small>JUDGE ${esc(me.judge_number)}</small><b>${esc(me.display_name)}</b></div><div class="muted small">Rejoin code <b class="mono">${esc(me.rejoin_code)}</b></div></section>
${queueCard(s)}${body}
<section class="card row"><button data-action="leave" class="ghost">Leave</button></section>`
}

function queueCard(s){
  if(!s.pending?.length&&!s.failed?.length)return ''
  return `<section class="card ${s.failed?.length?'error':'warnCard'}">${s.pending?.length?`<p><b>${s.pending.length}</b> submission${s.pending.length>1?'s':''} waiting to send.</p>`:''}
${s.failed?.length?`<p><b>${s.failed.length} not accepted:</b></p><ul>${s.failed.map(f=>`<li>${esc(f.error)}</li>`).join('')}</ul><button class="small" data-action="dismissFailed">Dismiss</button>`:''}</section>`
}

const queuedFor=(s,fn,match)=>(s.pending||[]).filter(p=>p.fn===fn&&Object.entries(match).every(([k,v])=>p.args[k]===v)).pop()

// Slider plus a large readout and -/+ nudges for exact half points. Starts unset ("—") so an untouched
// slider can't be submitted as a score by accident.
export function scoreSlider(id,label,max,value){
  const set=value!==''&&value!=null
  return `<div class="score"><div class="scoreHead"><label for="${id}">${esc(label)} <span class="muted">/ ${max}</span></label><output for="${id}" id="${id}-out">${set?esc(value):'—'}</output></div>
<div class="scoreCtl"><button type="button" class="nudge" data-action="nudge" data-for="${id}" data-step="-0.5" aria-label="${esc(label)} down half a point">−</button>
<input id="${id}" type="range" min="0" max="${max}" step="0.5" value="${set?esc(value):0}" data-set="${set?1:0}" aria-valuetext="${set?esc(value):'not set'}" style="--pct:${set?(Number(value)/max*100):0}%">
<button type="button" class="nudge" data-action="nudge" data-for="${id}" data-step="0.5" aria-label="${esc(label)} up half a point">+</button></div></div>`
}

function judgeQualifying(s){
  const {competition:c,my_scores}=s.data
  const d=driverMap(s)[c.active_driver_id]
  if(!d)return `<section class="card hero"><p class="muted">Waiting for the next driver.</p></section>`
  const mine=my_scores.find(x=>x.driver_id===d.id&&x.run===c.active_run)
  const queued=queuedFor(s,'submit_qualifying_score',{p_driver_id:d.id,p_run:c.active_run})
  const val=k=>queued?queued.args['p_'+k]:mine?mine[k]:''
  const key=`${d.id}-${c.active_run}`
  return `<form class="card" data-submit="score" data-driver="${d.id}" data-run="${c.active_run}"><small>QUALIFYING · RUN ${c.active_run}</small>
<h2 class="onTrackName">${driverLabel(d)}</h2>${d.team_name?`<p class="muted">${esc(d.team_name)}</p>`:''}
<div class="scores">${Object.entries(SCORE_LIMITS).map(([k,max])=>scoreSlider(`score-${k}-${key}`,k[0].toUpperCase()+k.slice(1),max,val(k))).join('')}</div>
${queued?`<p>${badge('Saved offline','warn')} Total ${fmt(Number(queued.args.p_line)+Number(queued.args.p_angle)+Number(queued.args.p_style))}</p>`:mine?`<p>${badge('Submitted','ok')} Total <b>${fmt(mine.total)}</b>. You can change it until the director moves on.</p>`:''}
<button type="submit" class="primary big">${mine||queued?'Update score':'Submit score'}</button></form>`
}

function judgeBattle(s){
  const {competition:c,battles}=s.data
  const d=driverMap(s)
  const b=battles.find(x=>x.id===c.active_battle_id)
  if(!b)return `<section class="card hero"><p class="muted">Waiting for the director to start the next battle.</p></section>`
  const queued=queuedFor(s,'submit_battle_vote',{p_battle_id:b.id,p_attempt:b.attempt})
  const vote=queued?.args.p_decision||b.my_vote
  const canVote=b.status==='active'&&b.current_run===2
  const a=d[b.driver_a_id],bb=d[b.driver_b_id]
  return `<section class="card"><small>${esc(b.round_name).toUpperCase()} · BATTLE ${b.slot}${b.attempt?` · ONE MORE TIME #${b.attempt}`:''}</small>
${battleHeader(b,d)}
${b.status==='decided'?`<div class="result">${badge('Winner','ok')} ${driverLabel(d[b.winner_driver_id])}</div>${votesLine(b.history?.[b.history.length-1])}`
:`<div class="decisions">${[['A',a],['OMT',null],['B',bb]].map(([v,dr])=>`<button class="decision ${vote===v?'chosen':''}" data-action="vote" data-battle="${b.id}" data-attempt="${b.attempt}" data-v="${v}" ${canVote?'':'disabled'}>${v==='OMT'?'OMT':`${esc(v)}<br><small>${dr?`#${esc(dr.car_number)} ${esc(dr.name)}`:''}</small>`}</button>`).join('')}</div>
<p class="muted small">${!canVote?'Voting opens when run 2 starts.':vote?`Your vote: <b>${esc(vote==='OMT'?'One more time':vote==='A'?a?.name:bb?.name)}</b>${queued?' (saved offline)':''}. You can change it until every judge has voted.`:'Pick after both runs. Other judges’ votes stay hidden until the result.'}</p>
<div class="special"><button data-action="call" data-battle="${b.id}" data-attempt="${b.attempt}" data-type="Contact">⚠ Contact</button><button data-action="call" data-battle="${b.id}" data-attempt="${b.attempt}" data-type="Special Situation">⚠ Special</button></div>`}
</section>`
}

// ------------------------------------------------------------------------------------------------
// Competitor
// ------------------------------------------------------------------------------------------------

export function competitorView(s){
  const {competition:c,my_drivers,leaderboard,battles}=s.data
  const d=driverMap(s)
  return `${my_drivers.map(me=>{
    const lb=leaderboard.find(l=>l.driver_id===me.id)
    const mine=battles.filter(b=>b.driver_a_id===me.id||b.driver_b_id===me.id)
    const cur=mine.find(b=>b.status!=='decided')
    const out=mine.find(b=>b.status==='decided'&&b.winner_driver_id!==me.id)
    return `<section class="card hero"><small>COMPETITOR</small><h2>${esc(me.name)}</h2>${me.team_name?`<p class="muted">${esc(me.team_name)}</p>`:''}
<div class="code">Car #${esc(me.car_number)}</div>
<p>${me.status==='approved'?badge('Approved','ok'):me.status==='rejected'?badge('Not accepted','bad'):badge('Waiting for director approval','warn')}</p>
${lb?`<p>Qualified <b>P${esc(lb.rank)}</b> · best ${fmt(lb.best)} (run 1 ${fmt(lb.run1)}, run 2 ${fmt(lb.run2)})</p>`:''}
${c.champion_driver_id===me.id?'<p class="big">🏆 Champion!</p>':out?`<p>Out in the ${esc(out.round_name)}.</p>`:cur?`<p>${cur.status==='active'?'<b>On track now:</b>':'Next:'} ${esc(cur.round_name)} vs ${driverLabel(d[cur.driver_a_id===me.id?cur.driver_b_id:cur.driver_a_id])}</p>`:''}
<p class="muted small">Rejoin code</p><div class="code small">${esc(me.rejoin_code)}</div><p class="muted small">Use it with the registration code to get back to this screen on another phone.</p></section>`}).join('')}
<section class="card row">${c.phase==='setup'?`<button data-action="registerAnother">Register another driver</button>`:''}<button data-action="leave" class="ghost">Leave</button></section>`
}

// ------------------------------------------------------------------------------------------------
// Live display
// ------------------------------------------------------------------------------------------------

export function displayView(s){
  const {competition:c,drivers,battles}=s.data
  const d=driverMap(s)
  let main
  if(c.phase==='setup'){
    const approved=drivers.filter(x=>x.status==='approved')
    main=`<section class="card live"><small>REGISTRATION OPEN</small><h2>Scan to register</h2>${c.driver_registration_code?`${qr(s,registerUrl(s,c.driver_registration_code),'Driver registration')}<div class="code">${esc(c.driver_registration_code)}</div>`:''}</section>
<section class="card"><small>DRIVERS</small><h2>${approved.length} confirmed</h2><ul class="people">${approved.map(x=>`<li><div>${driverLabel(x)}${x.team_name?` <span class="muted">· ${esc(x.team_name)}</span>`:''}</div></li>`).join('')}</ul></section>`
  }else if(c.phase==='qualifying'){
    const cur=d[c.active_driver_id]
    main=`<section class="card live"><small>QUALIFYING · RUN ${c.active_run}</small><h2 class="huge">${cur?driverLabel(cur):'—'}</h2>${cur?.team_name?`<p class="muted">${esc(cur.team_name)}</p>`:''}</section>
<section class="card"><small>LEADERBOARD</small>${leaderboardTable(s)}</section>`
  }else if(c.phase==='tandem'){
    const b=battles.find(x=>x.id===c.active_battle_id)
    main=`${b?`<section class="card live"><small>${esc(b.round_name).toUpperCase()}${b.attempt?` · ONE MORE TIME #${b.attempt}`:''}</small>${battleHeader(b,d)}${b.status==='decided'?`<div class="result big">${badge('Winner','ok')} ${driverLabel(d[b.winner_driver_id])}</div>${votesLine(b.history?.[b.history.length-1])}`:''}</section>`:''}
<section class="card"><small>BRACKET</small>${bracketView(s)}</section>`
  }else main=`${championCard(s)}<section class="card"><small>BRACKET</small>${bracketView(s)}</section>`
  return `${main}${s.displayMode&&s.session?.role!=='display'?'<p class="muted small center">Director preview. Close this tab to return.</p>':`<section class="card row"><button data-action="leave" class="ghost">Leave</button></section>`}`
}

export function leaderboardTable(s){
  const {leaderboard,competition:c}=s.data
  const d=driverMap(s)
  if(!leaderboard.length)return '<p class="muted">No complete runs yet.</p>'
  return `<table class="board"><thead><tr><th>#</th><th>Driver</th><th>R1</th><th>R2</th><th>Best</th></tr></thead><tbody>${leaderboard.map(l=>`<tr class="${c.bracket_size&&l.rank<=c.bracket_size?'in':''}"><td>${l.rank}</td><td>${driverLabel(d[l.driver_id])}</td><td>${fmt(l.run1)}</td><td>${fmt(l.run2)}</td><td><b>${fmt(l.best)}</b></td></tr>`).join('')}</tbody></table>`
}

export function bracketView(s,clickable=false){
  const {battles,competition:c}=s.data
  const d=driverMap(s)
  if(!c.bracket_size)return '<p class="muted">Bracket not built yet.</p>'
  const rounds=Math.log2(c.bracket_size)
  let html='<div class="bracket">'
  for(let r=1;r<=rounds;r++){
    const n=c.bracket_size/2**r
    const name=n===1?'Final':n===2?'Semi Final':`Top ${n*2}`
    html+=`<div class="round"><h3>${name}</h3>`
    for(let slot=1;slot<=n;slot++){
      const b=battles.find(x=>x.round===r&&x.slot===slot)
      const cell=id=>`<div class="slot ${b?.winner_driver_id&&b.winner_driver_id===id?'won':''} ${b?.winner_driver_id&&b.winner_driver_id!==id?'lost':''}">${driverLabel(d[id])}</div>`
      const inner=b?`${cell(b.driver_a_id)}${cell(b.driver_b_id)}`:`<div class="slot"><span class="muted">TBD</span></div><div class="slot"><span class="muted">TBD</span></div>`
      html+=clickable&&b&&b.status!=='decided'?`<button class="battle ${b.id===c.active_battle_id?'current':''}" data-action="selectBattle" data-battle="${b.id}">${inner}</button>`:`<div class="battle ${b&&b.id===c.active_battle_id?'current':''}">${inner}</div>`
    }
    html+='</div>'
  }
  return html+'</div>'
}
