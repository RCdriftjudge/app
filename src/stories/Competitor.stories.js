import {story,as,drivers} from './fixtures.js'

export default {title:'Competitor',tags:['autodocs'],parameters:{docs:{description:{component:'A driver’s (or team manager’s) phone. One device can hold several drivers.'}}}}

const mine=(ids,status={})=>ids.map(i=>({...drivers[i],status:status[i]||'approved'}))
export const Pending=story(as('competitor','setupEmpty',{data:{my_drivers:mine([0],{0:'pending'})}}))
export const TeamOfThree=story(as('competitor','setup',{data:{my_drivers:mine([0,1,4],{4:'pending'})}}),'Team manager registered three drivers from one phone.')
export const NotAccepted=story(as('competitor','setup',{data:{my_drivers:mine([5],{5:'rejected'})}}))
export const Qualified=story(as('competitor','qualifying',{data:{my_drivers:mine([2])}}))
export const OnTrack=story(as('competitor','battleRun2',{data:{my_drivers:mine([0])}}))
export const Eliminated=story(as('competitor','decided',{data:{my_drivers:mine([3])}}))
export const Champion=story(as('competitor','finished',{data:{my_drivers:mine([0,2])}}))
