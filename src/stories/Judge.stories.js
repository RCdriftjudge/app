import {story,as,phases,cal,ava,dan} from './fixtures.js'

export default {title:'Judge',tags:['autodocs'],parameters:{docs:{description:{component:'Judge 2’s phone. Judges only ever see their own scores and votes until a result is in.'}}}}

const key={p_competition_id:'x',p_driver_id:cal.id,p_run:2}
export const Waiting=story(as('judge','setup'))
export const ScoreRun=story(as('judge','qualifying'))
export const ScoreSubmitted=story(as('judge','qualifying',{data:{my_scores:[{driver_id:cal.id,run:2,line:28,angle:24,style:27,total:79}]}}))
export const ScoreSavedOffline=story(as('judge','qualifying',{online:false,pending:[{id:'q1',fn:'submit_qualifying_score',args:{...key,p_line:28,p_angle:24,p_style:27}}]}),'Signal lost: the score is kept on the phone and sent on reconnect.')
export const RejectedAfterReconnect=story(as('judge','qualifying',{failed:[{id:'q2',fn:'submit_battle_vote',args:{},error:'This battle has moved on; your vote was not counted'}]}),'A saved submission the server refused is shown, not silently dropped.')
export const BattleRun1=story(as('judge','battleRun1'),'Voting opens once run 2 starts.')
export const BattleVoting=story(as('judge','battleRun2'))
export const BattleVoted=story(as('judge','battleRun2',{data:{battles:phases.battleRun2.battles.map((b,i)=>i?b:{...b,my_vote:'A'})}}))
export const OneMoreTime=story(as('judge','omt'))
export const BattleDecided=story(as('judge','decided'))
export const Finished=story(as('judge','finished'))
