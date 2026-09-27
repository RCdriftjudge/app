import QRCode from 'qrcode'
import {shell,joinUrl,registerUrl} from '../views.js'

// Mock competition_state payloads for every phase. Stories render the real templates from views.js.
export const APP_URL='https://rcdriftjudge.github.io/app/'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`

const names=[['Ava','Westside Slide'],['Ben','Westside Slide'],['Cal','Nightshift'],['Dan',null],['Eve','Nightshift'],['Fin',null]]
export const drivers=names.map(([name,team_name],i)=>({id:id(i+1),name,team_name,car_number:String(i+1),status:'approved',seed:null,rejoin_code:['YZ','Q4','M8','HR','TX','W2'][i],self_registered:i<3}))
export const judges=[['Alex','UY'],['Kim','KC'],['Jo','J8']].map(([display_name,rejoin_code],i)=>({member_id:id(100+i),display_name,judge_number:i+1,rejoin_code}))
const [ava,ben,cal,dan]=drivers

const competition={id:id(900),name:'Saturday Night Drift',judge_count:3,phase:'setup',state_version:1,rules_version:'SDC 2026 Rev. 10.4',
  active_driver_id:null,active_run:1,active_battle_id:null,bracket_size:null,champion_driver_id:null,join_code:'K7Q2XM',driver_registration_code:'R4D9PL',director_pin:'H3N8PV'}

const leaderboard=[[ava,87.33,92.67],[ben,84,68.33],[cal,75,79.67],[dan,71,58.33]].map(([d,run1,run2],i)=>({driver_id:d.id,run1,run2,best:Math.max(run1,run2),rank:i+1}))
const seeded=drivers.map((d,i)=>i<4?{...d,seed:i+1}:d)
const battle=(n,a,b,extra={})=>({id:id(500+n),round:1,slot:n,round_name:'Semi Final',driver_a_id:a.id,driver_b_id:b.id,status:'pending',current_run:1,lead_driver_id:a.id,attempt:0,winner_driver_id:null,decided_by:null,votes_in:0,my_vote:null,history:[],calls:[],...extra})
const votes=(...d)=>d.map((decision,i)=>({judge_number:i+1,decision}))

export const phases={
  setupEmpty:{competition,judges:[],drivers:[],leaderboard:[],qualifying_progress:[],my_scores:[],battles:[]},
  setup:{competition,judges,drivers:drivers.map((d,i)=>({...d,status:i<4?'approved':i===4?'pending':'rejected'})),leaderboard:[],qualifying_progress:[],my_scores:[],battles:[]},
  qualifying:{competition:{...competition,phase:'qualifying',active_driver_id:cal.id,active_run:2},judges,drivers:drivers.slice(0,4),leaderboard,
    qualifying_progress:[...drivers.slice(0,4).map(d=>({driver_id:d.id,run:1,scored:3})),{driver_id:ava.id,run:2,scored:3},{driver_id:ben.id,run:2,scored:3},{driver_id:cal.id,run:2,scored:2}],my_scores:[],battles:[]},
  battleRun1:{competition:{...competition,phase:'tandem',bracket_size:4,active_battle_id:id(501)},judges,drivers:seeded.slice(0,4),leaderboard,qualifying_progress:[],my_scores:[],
    battles:[battle(1,ava,dan,{status:'active'}),battle(2,ben,cal)]},
}
phases.battleRun2={...phases.battleRun1,battles:[battle(1,ava,dan,{status:'active',current_run:2,lead_driver_id:dan.id,votes_in:2,calls:[{type:'Contact',judge_number:2,attempt:0,run:1}]}),battle(2,ben,cal)]}
phases.omt={...phases.battleRun1,battles:[battle(1,ava,dan,{status:'active',attempt:1,history:[{attempt:0,votes:votes('A','B','OMT')}]}),battle(2,ben,cal)]}
phases.decided={...phases.battleRun1,battles:[battle(1,ava,dan,{status:'decided',current_run:2,winner_driver_id:ava.id,decided_by:'judges',history:[{attempt:0,votes:votes('A','A','B')}]}),battle(2,ben,cal)]}
phases.override={...phases.decided,battles:[battle(1,ava,dan,{status:'decided',current_run:2,winner_driver_id:dan.id,decided_by:'director',history:[{attempt:0,votes:votes('A','A','B')}]}),battle(2,ben,cal)]}
phases.final={...phases.battleRun1,competition:{...phases.battleRun1.competition,active_battle_id:id(503)},battles:[
  battle(1,ava,dan,{status:'decided',winner_driver_id:ava.id,history:[{attempt:0,votes:votes('A','A','B')}]}),
  battle(2,ben,cal,{status:'decided',winner_driver_id:cal.id,history:[{attempt:0,votes:votes('B','B','A')}]}),
  {...battle(1,ava,cal,{status:'active',current_run:2,lead_driver_id:cal.id}),id:id(503),round:2,round_name:'Final'}]}
phases.finished={...phases.final,competition:{...phases.final.competition,phase:'finished',champion_driver_id:ava.id},
  battles:[...phases.final.battles.slice(0,2),{...phases.final.battles[2],status:'decided',winner_driver_id:ava.id,history:[{attempt:0,votes:votes('A','A','A')}]}]}

const me={
  director:{member_id:id(99),role:'director',judge_number:null,rejoin_code:null,display_name:'Sam'},
  judge:{...judges[1],role:'judge'},
  display:{member_id:id(98),role:'display',judge_number:null,rejoin_code:'P7',display_name:'Big screen'},
  competitor:{role:'competitor'},
}
const hide=(c,role)=>role==='director'?c:{...c,join_code:null,director_pin:null,driver_registration_code:role==='display'?c.driver_registration_code:null}

// Builds app state for a role in a given phase. `data` overrides merge into the competition_state payload.
export function as(role,phase,{data={},...rest}={}){
  const p=phases[phase]
  return {
    session:{competition_id:competition.id,role},page:'home',online:true,pending:[],failed:[],appUrl:APP_URL,qr:{},
    data:{...p,competition:hide(p.competition,role),me:me[role],my_drivers:[],
      drivers:role==='director'?p.drivers:p.drivers.filter(d=>d.status==='approved').map(d=>({...d,rejoin_code:null})),
      judges:role==='director'?p.judges:p.judges.map(j=>({...j,rejoin_code:null})),...data},
    ...rest,
  }
}
export const landing=(page,rest={})=>({session:null,page,online:true,pending:[],failed:[],appUrl:APP_URL,qr:{},joinCode:'',registerCode:'',invite:null,...rest})

export function screen(s){
  const el=document.createElement('div')
  el.innerHTML=shell(s)
  // Mirrors drawQrs() in main.js
  el.querySelectorAll('[data-qr]').forEach(async slot=>{try{const img=document.createElement('img');img.src=await QRCode.toDataURL(slot.dataset.qr,{width:440,margin:1});img.alt='QR code';slot.replaceWith(img)}catch{}})
  return el
}
export const story=(state,note)=>({render:()=>screen(typeof state==='function'?state():state),...(note?{parameters:{docs:{description:{story:note}}}}:{})})
export {joinUrl,registerUrl,ava,ben,cal,dan}
