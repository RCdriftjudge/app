import './style.css'
import './theme/synthwave.css'
import QRCode from 'qrcode'
import {sb,rpc,inviteInfo,watchCompetition,NetworkError} from './api.js'
import {queueCall,pendingCalls,failedCalls,clearFailed,flush} from './sync.js'
import {shell,qualifyingOrder,SCORE_LIMITS} from './views.js'

const SESSION='rcdj-session-v10'
const app=document.querySelector('#app')
const params=new URLSearchParams(location.search)
const $=id=>document.getElementById(id)

const s={
  session:loadSession(),
  page:'home',joinCode:'',registerCode:'',invite:null,
  data:null,error:null,online:navigator.onLine,toast:null,
  pending:pendingCalls(),failed:failedCalls(),
  displayMode:params.get('view')==='display',
  revealPin:false,bracketSize:null,qr:{},
  appUrl:`${location.origin}${location.pathname}`,
}

function loadSession(){
  try{
    const v=JSON.parse(localStorage.getItem(SESSION)||'null')
    if(v?.competition_id)return v
    // Sessions saved by v0.9 kept the whole competition object.
    const old=JSON.parse(localStorage.getItem('rcdj09-session')||'null')
    if(old?.competition?.id&&old.role)return {competition_id:old.competition.id,role:old.role}
  }catch{}
  return null
}
function setSession(v){
  s.session=v;s.data=null;s.error=null;s.revealPin=false
  try{v?localStorage.setItem(SESSION,JSON.stringify(v)):localStorage.removeItem(SESSION);localStorage.removeItem('rcdj09-session')}catch{}
  subscribe()
}

// ------------------------------------------------------------------------------------------------
// Rendering. Re-rendering replaces the DOM, so typed values and focus are carried across.
// ------------------------------------------------------------------------------------------------

function render(){
  const inputs=[...app.querySelectorAll('input[id]')].map(el=>({id:el.id,value:el.value,checked:el.checked,type:el.type,set:el.dataset.set}))
  const focus=document.activeElement?.id
  app.innerHTML=shell(s)
  for(const v of inputs){
    const el=$(v.id)
    if(!el||el.readOnly)continue
    if(v.type==='radio'||v.type==='checkbox')el.checked=v.checked
    else if(v.type==='range'){if(v.set==='1'){el.value=v.value;markSlider(el)}}
    else el.value=v.value
  }
  if(focus&&$(focus))$(focus).focus()
  drawQrs()
}

async function drawQrs(){
  const missing=[...app.querySelectorAll('[data-qr]')].map(el=>el.dataset.qr).filter(t=>!s.qr[t])
  if(!missing.length)return
  for(const t of missing){try{s.qr[t]=await QRCode.toDataURL(t,{width:440,margin:1})}catch{}}
  render()
}

function markSlider(el){
  el.dataset.set='1'
  el.style.setProperty('--pct',`${el.value/el.max*100}%`)
  el.setAttribute('aria-valuetext',el.value)
  const out=$(`${el.id}-out`)
  if(out)out.textContent=el.value
}

let toastTimer
function toast(text,kind='info'){
  s.toast={text,kind};render()
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{s.toast=null;render()},kind==='error'?6000:3500)
}

// ------------------------------------------------------------------------------------------------
// Competition state: one role-aware RPC, refreshed on realtime changes, on a timer, and after every action.
// ------------------------------------------------------------------------------------------------

let refreshing=null,again=false
async function refresh(){
  if(!s.session)return
  if(refreshing){again=true;return refreshing}
  refreshing=(async()=>{
    do{
      again=false
      try{
        s.data=await rpc('competition_state',{p_competition_id:s.session.competition_id})
        s.error=null
      }catch(e){
        if(e instanceof NetworkError){s.error=s.data?null:e.message}
        else if(/not part of|removed you|not found/i.test(e.message)){setSession(null);toast(e.message,'error')}
        else s.error=e.message
      }
    }while(again)
  })()
  try{await refreshing}finally{refreshing=null;render()}
}

let unwatch=()=>{}
function subscribe(){
  unwatch()
  unwatch=s.session?watchCompetition(s.session.competition_id,()=>refresh()):()=>{}
}

async function syncQueue(){
  s.pending=pendingCalls()
  if(!s.pending.length||!s.online)return
  await flush((fn,args)=>rpc(fn,args),e=>e instanceof NetworkError)
  const failedBefore=s.failed.length
  s.pending=pendingCalls();s.failed=failedCalls()
  if(s.failed.length>failedBefore)toast('Some saved submissions were not accepted','error')
  await refresh()
}

// Judge submissions: sent now if possible, otherwise saved and retried. The idempotency key is fixed
// before the first attempt, so a retry after a lost response is harmless.
async function judgeSubmit(fn,args,sentText){
  args={...args,p_idempotency_key:crypto.randomUUID()}
  const save=()=>{queueCall(fn,args);s.pending=pendingCalls();toast('Saved on this device. It will send when you reconnect.','warn')}
  if(!s.online)return save()
  try{await rpc(fn,args);toast(sentText,'ok');await refresh()}
  catch(e){if(e instanceof NetworkError)save();else throw e}
}

// ------------------------------------------------------------------------------------------------
// Actions
// ------------------------------------------------------------------------------------------------

const value=id=>($(id)?.value||'').trim()
const code=id=>value(id).toUpperCase()

function goto(page){
  s.page=page
  if(page==='home'){s.joinCode='';s.registerCode='';s.invite=null}
  render()
}

const actions={
  nav:({page,role})=>{if(page==='join'||page==='driver'){s.invite=null;s.joinCode='';s.registerCode='';s.joinRole=role||'judge'}goto(page)},
  refresh:()=>refresh(),
  async create(){
    const judges=Number(document.querySelector('input[name="judgeCount"]:checked')?.value||3)
    const r=await rpc('create_competition',{p_name:value('competitionName'),p_director_name:value('directorName'),p_judge_count:judges})
    setSession({competition_id:r.competition_id,role:'director'});goto('home');await refresh()
  },
  async join({role}){
    const c=code('code')
    if(!c)return toast('Enter the access code','error')
    const r=await rpc('join_competition_by_code',{p_code:c,p_display_name:value('name'),p_role:role||'judge'})
    setSession({competition_id:r.competition_id,role:r.role});goto('home');await refresh()
    if(r.role==='judge')toast(`You're Judge ${r.judge_number}. Your rejoin code is ${r.rejoin_code}.`,'ok')
  },
  async register(){
    const c=code('driverCode')
    if(!value('driverName'))return toast('Please enter your driver name','error')
    const r=await rpc('register_driver',{p_registration_code:c,p_name:value('driverName'),p_team_name:value('teamName')})
    setSession({competition_id:r.competition_id,role:'competitor',registration_code:c});goto('home');await refresh()
  },
  async rejoin(){
    const r=await rpc('rejoin',{p_event_code:code('rejoinEvent'),p_rejoin_code:code('rejoinCode')})
    if(r.error)throw new Error(r.error)
    setSession({competition_id:r.competition_id,role:r.role,registration_code:r.role==='competitor'?code('rejoinEvent'):undefined});goto('home');await refresh()
    toast('Welcome back','ok')
  },
  leave(){
    const role=s.session?.role
    const warn=role==='director'?'Leave this competition? Note your recovery PIN first; you need it to get back in.':role==='judge'?'Leave? Your judge seat stays yours; use your rejoin code to come back.':'Leave this competition on this device?'
    if(!confirm(warn))return
    if(s.displayMode)return window.close()
    setSession(null);goto('home')
  },
  registerAnother(){s.registerCode=s.session?.registration_code||'';s.invite=null;goto('driver')},
  revealPin(){s.revealPin=true;render()},
  openDisplay(){window.open(`${s.appUrl}?view=display`,'_blank')},
  dismissFailed(){clearFailed();s.failed=[];render()},

  // Director
  async driverStatus({driver,status}){await rpc('set_driver_status',{p_driver_id:driver,p_status:status});await refresh()},
  async addDriver(){
    const name=value('newDriverName')
    if(!name)return toast('Enter a driver name','error')
    await rpc('add_driver',{p_competition_id:s.session.competition_id,p_name:name,p_team_name:value('newDriverTeam')})
    $('newDriverName').value='';$('newDriverTeam').value=''
    toast(`${name} added`,'ok');await refresh()
  },
  async releaseJudge({member,name}){
    if(!confirm(`Let ${name} move to a new phone?\n\nThey keep their seat and scores. On the new phone they tap Rejoin and enter the judge code and their rejoin code.`))return
    await rpc('release_member',{p_member_id:member});toast(`${name} can now rejoin on a new phone`,'ok');await refresh()
  },
  async releaseDriver({driver,name}){
    if(!confirm(`Let ${name} move to a new phone? They rejoin with the registration code and their rejoin code.`))return
    await rpc('release_driver',{p_driver_id:driver});toast(`${name} can now rejoin on a new phone`,'ok');await refresh()
  },
  async removeJudge({member,name}){
    if(!confirm(`Replace ${name} with a different person?\n\nTheir seat opens for someone new to join with the judge code. Scores they already gave still count. If it's the same person on a new phone, use "New phone" instead.`))return
    await rpc('remove_member',{p_member_id:member});await refresh()
  },
  async startQualifying(){await rpc('start_qualifying',{p_competition_id:s.session.competition_id});await refresh()},
  async setQualRun({driver,run}){await rpc('set_qualifying_run',{p_competition_id:s.session.competition_id,p_driver_id:driver,p_run:Number(run)});await refresh()},
  async qualStep({dir}){
    const c=s.data.competition,order=qualifyingOrder(s)
    const i=order.findIndex(o=>o.driver.id===c.active_driver_id&&o.run===c.active_run)
    const next=order[Math.max(0,Math.min(order.length-1,i+Number(dir)))]
    if(next)await actions.setQualRun({driver:next.driver.id,run:next.run})
  },
  pickBracket:el=>{s.bracketSize=Number(el.value);render()},
  nudge({for:id,step}){
    const el=$(id)
    if(!el)return
    const base=el.dataset.set==='1'?Number(el.value):Number(el.max)/2
    el.value=Math.min(Number(el.max),Math.max(0,el.dataset.set==='1'?base+Number(step):base))
    markSlider(el)
  },
  async buildBracket({size}){
    if(!confirm(`Close qualifying and build the Top ${size} bracket?`))return
    await rpc('build_bracket',{p_competition_id:s.session.competition_id,p_size:Number(size)});await refresh()
  },
  async selectBattle({battle}){await rpc('set_active_battle',{p_battle_id:battle});await refresh()},
  async battleRun({battle,run}){await rpc('set_battle_run',{p_battle_id:battle,p_run:Number(run)});await refresh()},
  async override({battle,result}){
    const reason=prompt(result==='OMT'?'Reason for one more time (optional)':'Reason for the ruling (optional)')
    if(reason===null)return
    await rpc('override_battle',{p_battle_id:battle,p_result:result,p_reason:reason});await refresh()
  },

  // Judge
  async score({driver,run}){
    const key=`${driver}-${run}`,v={}
    for(const [k,max] of Object.entries(SCORE_LIMITS)){
      const el=$(`score-${k}-${key}`),n=Number(el?.value),label=k[0].toUpperCase()+k.slice(1)
      if(el?.dataset.set!=='1')return toast(`Set a ${label} score`,'error')
      if(!(n>=0&&n<=max))return toast(`${label} must be between 0 and ${max}`,'error')
      v[k]=n
    }
    await judgeSubmit('submit_qualifying_score',{p_competition_id:s.session.competition_id,p_driver_id:driver,p_run:Number(run),p_line:v.line,p_angle:v.angle,p_style:v.style},`Score sent: ${v.line+v.angle+v.style}`)
  },
  async vote({battle,attempt,v}){await judgeSubmit('submit_battle_vote',{p_battle_id:battle,p_attempt:Number(attempt),p_decision:v},'Vote sent')},
  async call({battle,attempt,type}){await judgeSubmit('record_judge_call',{p_battle_id:battle,p_attempt:Number(attempt),p_call_type:type},`${type} sent to the director`)},
}

let busy=false
async function run(name,arg){
  const fn=actions[name]
  if(!fn||busy)return
  busy=true;app.classList.add('busy')
  try{await fn(arg)}
  catch(e){toast(e.message,'error')}
  finally{busy=false;app.classList.remove('busy')}
}

app.addEventListener('click',e=>{
  const el=e.target.closest('[data-action]')
  if(!el||el.disabled)return
  if(el.tagName==='INPUT')return run(el.dataset.action,el)
  e.preventDefault()
  run(el.dataset.action,{...el.dataset})
})
app.addEventListener('input',e=>{if(e.target.type==='range')markSlider(e.target)})
app.addEventListener('submit',e=>{
  e.preventDefault()
  const f=e.target
  const action=f.dataset.submit==='join'?'join':f.dataset.submit
  run(action,{...f.dataset})
})

// ------------------------------------------------------------------------------------------------
// Startup
// ------------------------------------------------------------------------------------------------

addEventListener('online',()=>{s.online=true;render();syncQueue()})
addEventListener('offline',()=>{s.online=false;render()})
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){refresh();syncQueue()}})
// Fallback for missed realtime events and flaky venue wifi.
setInterval(()=>{if(document.visibilityState==='visible'){refresh();syncQueue()}},8000)

async function start(){
  if(params.has('register')){s.registerCode=params.get('register').toUpperCase();s.page='driver'}
  else if(params.has('join')){s.joinCode=params.get('join').toUpperCase();s.joinRole='judge';s.page='join'}
  if(params.has('register')||params.has('join'))history.replaceState(null,'',s.appUrl+(s.displayMode?'?view=display':''))
  if(!sb)s.error='Backend is not configured.'
  render()
  if(s.registerCode||s.joinCode){s.invite=await inviteInfo(s.registerCode||s.joinCode);render()}
  subscribe()
  await refresh()
  syncQueue()
}
start()

if('serviceWorker' in navigator&&import.meta.env.PROD)navigator.serviceWorker.register('./sw.js').catch(()=>{})
