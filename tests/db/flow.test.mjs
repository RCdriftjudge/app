// Runs a whole competition against a local Supabase (npx supabase start && npx supabase db reset).
// node --test tests/db/  — reads VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY from .env.local.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'

const env=Object.fromEntries(readFileSync(new URL('../../.env.local',import.meta.url),'utf8').split('\n').filter(Boolean).map(l=>l.split('=')))
const URL_=env.VITE_SUPABASE_URL,KEY=env.VITE_SUPABASE_PUBLISHABLE_KEY

async function device(){
  const sb=createClient(URL_,KEY,{auth:{persistSession:false}})
  const {error}=await sb.auth.signInAnonymously()
  if(error)throw error
  const call=async(fn,args={})=>{const {data,error}=await sb.rpc(fn,args);if(error)throw new Error(error.message);return data}
  return {sb,call,state:cid=>call('competition_state',{p_competition_id:cid})}
}
const key=()=>crypto.randomUUID()
const rejects=(p,re)=>assert.rejects(p,e=>re.test(e.message),`expected ${re}`)

test('full competition: registration, qualifying, bracket, OMT, override, rejoin',async()=>{
  const director=await device()
  const {competition_id:cid}=await director.call('create_competition',{p_name:'Test Cup',p_director_name:'Dee',p_judge_count:3})
  let st=await director.state(cid)
  const {join_code:joinCode,driver_registration_code:regCode,director_pin:pin}=st.competition
  assert.match(joinCode,/^[A-Z2-9]{6}$/)
  assert.equal(st.me.role,'director')

  // Director can create a second event from the same device (previously blocked by RLS).
  await director.call('create_competition',{p_name:'Second',p_director_name:'Dee',p_judge_count:2})

  // The old members insert policy let any fresh device make itself director of any competition.
  const intruder=await device()
  const {error:insertErr}=await intruder.sb.from('members').insert({competition_id:cid,user_id:(await intruder.sb.auth.getUser()).data.user.id,display_name:'x',role:'director'})
  assert.ok(insertErr,'direct member insert must be rejected')
  await rejects(intruder.state(cid),/not part of/)

  const invite=await intruder.call('invite_info',{p_code:regCode})
  assert.deepEqual(invite,{kind:'driver',competition_name:'Test Cup',registration_open:true})

  const judges=[]
  for(const name of ['J One','J Two','J Three']){
    const j=await device()
    const r=await j.call('join_competition_by_code',{p_code:joinCode.toLowerCase(),p_display_name:name,p_role:'judge'})
    judges.push({...j,...r})
  }
  assert.deepEqual(judges.map(j=>j.judge_number),[1,2,3])
  await rejects((await device()).call('join_competition_by_code',{p_code:joinCode,p_display_name:'Late',p_role:'judge'}),/All 3 judge seats are taken/)
  // Joining again is idempotent.
  assert.equal((await judges[0].call('join_competition_by_code',{p_code:joinCode,p_display_name:'J One',p_role:'judge'})).member_id,judges[0].member_id)
  const display=await device()
  await display.call('join_competition_by_code',{p_code:joinCode,p_display_name:'Big screen',p_role:'display'})

  await rejects(director.call('start_qualifying',{p_competition_id:cid}),/Approve at least 2 drivers/)

  const team=await device()
  const regs=[]
  for(const name of ['Ava','Ben','Cal','Dan']) regs.push(await team.call('register_driver',{p_registration_code:regCode,p_name:name,p_team_name:'Team T'}))
  const solo=await device()
  const eve=await solo.call('register_driver',{p_registration_code:regCode,p_name:'Eve',p_team_name:null})
  assert.deepEqual(regs.map(r=>r.car_number),['1','2','3','4'])
  assert.match(regs[0].rejoin_code,/^[A-Z2-9]{2}$/)

  // Competitors only see their own drivers until approved.
  st=await solo.state(cid)
  assert.equal(st.me.role,'competitor')
  assert.deepEqual(st.drivers.map(d=>d.name),['Eve'])
  await rejects(solo.call('set_driver_status',{p_driver_id:eve.driver_id,p_status:'approved'}),/Only the director/)

  for(const r of regs) await director.call('set_driver_status',{p_driver_id:r.driver_id,p_status:'approved'})
  await director.call('set_driver_status',{p_driver_id:eve.driver_id,p_status:'rejected'})
  const fin=await director.call('add_driver',{p_competition_id:cid,p_name:'Fin',p_team_name:''})
  assert.equal(fin.car_number,'6')

  await director.call('start_qualifying',{p_competition_id:cid})
  await rejects(team.call('register_driver',{p_registration_code:regCode,p_name:'Late',p_team_name:null}),/closed/)
  await rejects(director.call('set_driver_status',{p_driver_id:eve.driver_id,p_status:'approved'}),/locked/)

  // Totals per judge per run. Ava best, then Ben, Cal, Dan, Fin.
  const plan={[regs[0].driver_id]:[80,90],[regs[1].driver_id]:[85,70],[regs[2].driver_id]:[60,75],[regs[3].driver_id]:[70,72],[fin.driver_id]:[50,40]}
  for(const [driverId,[r1,r2]] of Object.entries(plan)){
    for(const [run,total] of [[1,r1],[2,r2]]){
      await director.call('set_qualifying_run',{p_competition_id:cid,p_driver_id:driverId,p_run:run})
      for(const [i,j] of judges.entries()){
        const t=total+(i-1) // judges differ by ±1, average stays at `total`
        const line=Math.min(35,Math.round(t*0.35*2)/2),angle=Math.min(30,Math.round(t*0.3*2)/2),style=t-line-angle
        await j.call('submit_qualifying_score',{p_competition_id:cid,p_driver_id:driverId,p_run:run,p_line:line,p_angle:angle,p_style:style,p_idempotency_key:key()})
      }
    }
  }
  await rejects(judges[0].call('submit_qualifying_score',{p_competition_id:cid,p_driver_id:fin.driver_id,p_run:1,p_line:36,p_angle:0,p_style:0,p_idempotency_key:key()}),/out of range/)
  // A retried submission with the same key is a no-op.
  const k=key()
  for(let i=0;i<2;i++) await judges[0].call('submit_qualifying_score',{p_competition_id:cid,p_driver_id:fin.driver_id,p_run:2,p_line:14,p_angle:12,p_style:13,p_idempotency_key:k})

  // Blind judging: a judge can't read another judge's scores.
  const {data:peek}=await judges[1].sb.from('qualifying_scores').select('*')
  assert.ok(peek.every(r=>r.judge_member_id===judges[1].member_id))
  st=await judges[1].state(cid)
  assert.ok(st.my_scores.length===10)
  assert.equal(st.competition.join_code,null)
  assert.equal(st.competition.director_pin,null)

  st=await display.state(cid)
  const names=Object.fromEntries(st.drivers.map(d=>[d.id,d.name]))
  assert.deepEqual(st.leaderboard.map(l=>names[l.driver_id]),['Ava','Ben','Cal','Dan','Fin'])
  assert.equal(st.leaderboard[0].best,90)
  assert.ok(!st.drivers.some(d=>d.name==='Eve'),'rejected drivers hidden from display')

  await rejects(director.call('build_bracket',{p_competition_id:cid,p_size:8}),/Only 5 drivers/)
  await director.call('build_bracket',{p_competition_id:cid,p_size:4})
  st=await director.state(cid)
  const byName=n=>st.drivers.find(d=>d.name===n).id
  const [semi1,semi2]=st.battles
  assert.equal(st.competition.phase,'tandem')
  assert.deepEqual([semi1.driver_a_id,semi1.driver_b_id],[byName('Ava'),byName('Dan')])
  assert.deepEqual([semi2.driver_a_id,semi2.driver_b_id],[byName('Ben'),byName('Cal')])
  assert.equal(st.competition.active_battle_id,semi1.id)

  const vote=(j,b,attempt,d,k=key())=>j.call('submit_battle_vote',{p_battle_id:b,p_attempt:attempt,p_decision:d,p_idempotency_key:k})
  await rejects(vote(judges[0],semi1.id,0,'A'),/after the second run/)
  await director.call('set_battle_run',{p_battle_id:semi1.id,p_run:2})
  await judges[0].call('record_judge_call',{p_battle_id:semi1.id,p_attempt:0,p_call_type:'Contact',p_idempotency_key:key()})
  // Split panel -> one more time.
  await vote(judges[0],semi1.id,0,'A');await vote(judges[1],semi1.id,0,'B')
  st=await judges[0].state(cid)
  assert.equal(st.battles[0].my_vote,'A')
  assert.deepEqual(st.battles[0].history,[],'votes stay hidden until the attempt is over')
  const {data:peekVotes}=await judges[0].sb.from('judge_decisions').select('*')
  assert.equal(peekVotes.length,1,'judge only reads their own vote')
  await vote(judges[2],semi1.id,0,'OMT')
  st=await director.state(cid)
  assert.equal(st.battles[0].attempt,1)
  assert.equal(st.battles[0].current_run,1)
  assert.equal(st.battles[0].history[0].votes.length,3)
  assert.equal(st.battles[0].calls[0].type,'Contact')
  await rejects(vote(judges[0],semi1.id,0,'A'),/moved on/)

  await director.call('set_battle_run',{p_battle_id:semi1.id,p_run:2})
  const k2=key()
  await vote(judges[0],semi1.id,1,'B',k2);await vote(judges[0],semi1.id,1,'B',k2) // retry is harmless
  await vote(judges[1],semi1.id,1,'B');await vote(judges[2],semi1.id,1,'A')
  st=await director.state(cid)
  assert.equal(st.battles[0].winner_driver_id,byName('Dan'))

  await director.call('set_active_battle',{p_battle_id:semi2.id})
  await director.call('set_battle_run',{p_battle_id:semi2.id,p_run:2})
  for(const j of judges) await vote(j,semi2.id,0,'B')
  st=await director.state(cid)
  const final=st.battles.find(b=>b.round===2)
  // Cal (seed 3) out-qualified Dan (seed 4), so Cal leads run 1 of the final.
  assert.deepEqual([final.round_name,final.driver_a_id,final.driver_b_id],['Final',byName('Cal'),byName('Dan')])

  // Director can still change semi 1 while the final hasn't started.
  await director.call('override_battle',{p_battle_id:semi1.id,p_result:'A',p_reason:'Dan off course, missed on replay'})
  st=await director.state(cid)
  assert.deepEqual([st.battles.find(b=>b.round===2).driver_a_id,st.battles.find(b=>b.round===2).driver_b_id],[byName('Ava'),byName('Cal')])
  await director.call('set_active_battle',{p_battle_id:final.id})
  await rejects(director.call('override_battle',{p_battle_id:semi1.id,p_result:'B',p_reason:''}),/Too late/)

  await director.call('set_battle_run',{p_battle_id:final.id,p_run:2})
  for(const j of judges) await vote(j,final.id,0,'A')
  st=await display.state(cid)
  assert.equal(st.competition.phase,'finished')
  assert.equal(st.competition.champion_driver_id,byName('Ava'))
  await director.call('override_battle',{p_battle_id:final.id,p_result:'B',p_reason:'Protest upheld'})
  st=await display.state(cid)
  assert.equal(st.competition.champion_driver_id,byName('Cal'))

  // Rejoin on new devices.
  const phone=await device()
  const r1=await phone.call('rejoin',{p_event_code:joinCode,p_rejoin_code:judges[1].rejoin_code.toLowerCase()})
  assert.deepEqual([r1.role,r1.judge_number],['judge',2])
  await rejects(judges[1].state(cid),/not part of/)
  const phone2=await device()
  assert.equal((await phone2.call('rejoin',{p_event_code:joinCode,p_rejoin_code:pin})).role,'director')
  const phone3=await device()
  const r3=await phone3.call('rejoin',{p_event_code:regCode,p_rejoin_code:regs[2].rejoin_code})
  assert.equal(r3.role,'competitor')
  assert.deepEqual((await phone3.state(cid)).my_drivers.map(d=>d.name),['Cal'])

  const guesser=await device()
  for(let i=0;i<20;i++) assert.equal((await guesser.call('rejoin',{p_event_code:joinCode,p_rejoin_code:'!'+i})).error,'Rejoin code not found')
  await rejects(guesser.call('rejoin',{p_event_code:joinCode,p_rejoin_code:pin}),/Too many/)
})

test('two-judge panel needs both judges to agree',async()=>{
  const director=await device()
  const {competition_id:cid}=await director.call('create_competition',{p_name:'Duo',p_director_name:'D',p_judge_count:2})
  const {join_code}=(await director.state(cid)).competition
  const js=[]
  for(const n of ['A','B']){const j=await device();await j.call('join_competition_by_code',{p_code:join_code,p_display_name:n,p_role:'judge'});js.push(j)}
  const ids=[]
  for(const n of ['X','Y']) ids.push((await director.call('add_driver',{p_competition_id:cid,p_name:n,p_team_name:''})).driver_id)
  await director.call('start_qualifying',{p_competition_id:cid})
  for(const [i,id] of ids.entries()) for(const j of js) await j.call('submit_qualifying_score',{p_competition_id:cid,p_driver_id:id,p_run:1,p_line:20-i,p_angle:20,p_style:20,p_idempotency_key:key()})
  await director.call('build_bracket',{p_competition_id:cid,p_size:2})
  const b=(await director.state(cid)).battles[0]
  await director.call('set_battle_run',{p_battle_id:b.id,p_run:2})
  await js[0].call('submit_battle_vote',{p_battle_id:b.id,p_attempt:0,p_decision:'A',p_idempotency_key:key()})
  await js[1].call('submit_battle_vote',{p_battle_id:b.id,p_attempt:0,p_decision:'B',p_idempotency_key:key()})
  let st=await director.state(cid)
  assert.equal(st.battles[0].attempt,1,'1-1 split is a one more time')
  // Removing a judge frees the seat and their undecided vote no longer counts.
  await director.call('set_battle_run',{p_battle_id:b.id,p_run:2})
  await js[0].call('submit_battle_vote',{p_battle_id:b.id,p_attempt:1,p_decision:'A',p_idempotency_key:key()})
  await director.call('remove_member',{p_member_id:st.judges[0].member_id})
  await rejects(js[0].state(cid),/removed/)
  const sub=await device()
  const r=await sub.call('join_competition_by_code',{p_code:join_code,p_display_name:'Sub',p_role:'judge'})
  assert.equal(r.judge_number,1)
  st=await director.state(cid)
  assert.equal(st.battles[0].votes_in,0)
})
