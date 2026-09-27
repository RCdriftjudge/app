// Panel changes mid-event: a judge's phone dies, or a judge is replaced by someone else.
// Runs against local Supabase like flow.test.mjs.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'

const env=Object.fromEntries(readFileSync(new URL('../../.env.local',import.meta.url),'utf8').split('\n').filter(Boolean).map(l=>l.split('=')))
async function device(){
  const sb=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}})
  const {error}=await sb.auth.signInAnonymously()
  if(error)throw error
  const call=async(fn,args={})=>{const {data,error}=await sb.rpc(fn,args);if(error)throw new Error(error.message);return data}
  return {sb,call,state:cid=>call('competition_state',{p_competition_id:cid})}
}
const key=()=>crypto.randomUUID()

async function event({drivers=4,judges=3}={}){
  const director=await device()
  const {competition_id:cid}=await director.call('create_competition',{p_name:'Race day',p_director_name:'D',p_judge_count:judges})
  const {join_code:joinCode}=(await director.state(cid)).competition
  const js=[]
  for(let i=0;i<judges;i++){const j=await device();Object.assign(j,await j.call('join_competition_by_code',{p_code:joinCode,p_display_name:'J'+(i+1),p_role:'judge'}));js.push(j)}
  const ids=[]
  for(let i=0;i<drivers;i++)ids.push((await director.call('add_driver',{p_competition_id:cid,p_name:'D'+i,p_team_name:''})).driver_id)
  await director.call('start_qualifying',{p_competition_id:cid})
  return {director,cid,joinCode,js,ids}
}
const score=(j,cid,id,run,total)=>{const line=Math.round(total*.35),angle=Math.round(total*.3);return j.call('submit_qualifying_score',{p_competition_id:cid,p_driver_id:id,p_run:run,p_line:line,p_angle:angle,p_style:total-line-angle,p_idempotency_key:key()})}
const vote=(j,b,attempt,d)=>j.call('submit_battle_vote',{p_battle_id:b,p_attempt:attempt,p_decision:d,p_idempotency_key:key()})

test('replacing a judge keeps completed qualifying runs, and the substitute scores from then on',async()=>{
  const {director,cid,joinCode,js,ids}=await event()
  for(const [i,id] of ids.entries())for(const j of js)await score(j,cid,id,1,80-i*2)
  assert.equal((await director.state(cid)).leaderboard.length,4)
  await director.call('remove_member',{p_member_id:js[2].member_id})
  const sub=await device()
  const seat=await sub.call('join_competition_by_code',{p_code:joinCode,p_display_name:'Sub',p_role:'judge'})
  assert.equal(seat.judge_number,3)
  let st=await director.state(cid)
  assert.equal(st.leaderboard.length,4,'runs already complete stay complete')
  assert.equal(st.leaderboard[0].best,80)
  // Run 2 needs the substitute's score to complete.
  for(const j of js.slice(0,2))await score(j,cid,ids[0],2,90)
  assert.equal((await director.state(cid)).leaderboard[0].run2,null)
  await score(sub,cid,ids[0],2,90)
  assert.equal((await director.state(cid)).leaderboard[0].run2,90)
})

test('a run waiting only on a judge who is replaced completes with the judges still seated',async()=>{
  const {director,cid,js,ids}=await event()
  for(const j of js.slice(0,2))await score(j,cid,ids[0],1,80)
  assert.equal((await director.state(cid)).leaderboard.length,0)
  await director.call('remove_member',{p_member_id:js[2].member_id})
  const st=await director.state(cid)
  assert.equal(st.leaderboard.length,1)
  assert.equal(st.qualifying_progress.find(p=>p.driver_id===ids[0]).complete,true)
})

test('a judge who moves to a new phone keeps their seat and scores',async()=>{
  const {director,cid,joinCode,js,ids}=await event()
  for(const j of js)await score(j,cid,ids[0],1,80)
  await director.call('release_member',{p_member_id:js[1].member_id})
  const phone=await device()
  const r=await phone.call('rejoin',{p_event_code:joinCode,p_rejoin_code:js[1].rejoin_code})
  assert.equal(r.judge_number,2)
  const st=await phone.state(cid)
  assert.equal(st.my_scores.length,1,'their earlier scores come with them')
  assert.equal((await director.state(cid)).leaderboard.length,1)
})

test('battles resolve with the judges who are seated when one leaves mid-battle',async()=>{
  const {director,cid,js,ids}=await event({drivers:4})
  for(const [i,id] of ids.entries())for(const j of js)await score(j,cid,id,1,80-i*2)
  await director.call('build_bracket',{p_competition_id:cid,p_size:4})
  let [b1,b2]=(await director.state(cid)).battles
  await director.call('set_battle_run',{p_battle_id:b1.id,p_run:2})
  await vote(js[0],b1.id,0,'A');await vote(js[1],b1.id,0,'A')
  // Judge 3 walks off before voting: the two votes already cast decide it.
  await director.call('remove_member',{p_member_id:js[2].member_id})
  let st=await director.state(cid)
  assert.equal(st.battles[0].status,'decided')
  assert.equal(st.battles[0].winner_driver_id,ids[0])
  // With two seated, a 1-1 split is a one more time.
  await director.call('set_active_battle',{p_battle_id:b2.id})
  await director.call('set_battle_run',{p_battle_id:b2.id,p_run:2})
  await vote(js[0],b2.id,0,'A');await vote(js[1],b2.id,0,'B')
  st=await director.state(cid)
  assert.equal(st.battles[1].attempt,1)
})

test('a full three-judge panel still waits for all three votes',async()=>{
  const {director,cid,js,ids}=await event({drivers:2})
  for(const [i,id] of ids.entries())for(const j of js)await score(j,cid,id,1,80-i*2)
  await director.call('build_bracket',{p_competition_id:cid,p_size:2})
  const b=(await director.state(cid)).battles[0]
  await director.call('set_battle_run',{p_battle_id:b.id,p_run:2})
  await vote(js[0],b.id,0,'A');await vote(js[1],b.id,0,'A')
  assert.equal((await director.state(cid)).battles[0].status,'active')
  await vote(js[2],b.id,0,'B')
  assert.equal((await director.state(cid)).competition.phase,'finished')
})
