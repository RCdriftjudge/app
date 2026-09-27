import {story,as,phases,judges,drivers} from './fixtures.js'

export default {title:'Director',tags:['autodocs'],parameters:{docs:{description:{component:'The director runs the event from one phone: seats judges, approves drivers, steps through qualifying, runs battles and can overrule.'}}}}

export const NewEvent=story(as('director','setupEmpty'),'Just created: no judges or drivers yet. Start Qualifying is disabled with the reason shown.')
export const SetupReady=story(as('director','setup'),'Three judges seated, four drivers approved, one waiting, one rejected.')
export const PinRevealed=story(as('director','setup',{revealPin:true}))
export const Qualifying=story(as('director','qualifying'),'Cal on track for run 2, two of three judges have scored.')
export const BattleRun1=story(as('director','battleRun1'))
export const BattleRun2WithCall=story(as('director','battleRun2'),'Judges voting after run 2; a judge has flagged contact.')
export const OneMoreTime=story(as('director','omt'))
export const BattleDecided=story(as('director','decided'))
export const DirectorRuling=story(as('director','override'),'Result changed by the director after a review.')
export const Final=story(as('director','final'))
export const Finished=story(as('director','finished'))
export const JudgeMovingPhones=story(as('director','setup',{data:{judges:judges.map((j,i)=>i===1?{...j,released:true}:j),drivers:phases.setup.drivers.map((d,i)=>i===0?{...d,released:true}:d)}}),'Judge 2 has been released to a new phone and hasn\u2019t rejoined yet. Ava\u2019s driver code is released too.')
