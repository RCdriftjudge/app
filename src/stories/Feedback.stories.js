import {story,as,landing} from './fixtures.js'

export default {title:'Feedback',tags:['autodocs'],parameters:{docs:{description:{component:'Toasts replace browser alert() pop-ups; errors show the server’s plain-language message.'}}}}

export const Offline=story(as('judge','battleRun2',{online:false}))
export const Success=story(as('judge','battleRun2',{toast:{text:'Vote sent',kind:'ok'}}))
export const SavedOffline=story(as('judge','battleRun2',{online:false,toast:{text:'Saved on this device. It will send when you reconnect.',kind:'warn'}}))
export const Error=story(landing('join',{toast:{text:'All 3 judge seats are taken',kind:'error'}}))
export const RejoinNotFound=story(landing('rejoin',{toast:{text:'Rejoin code not found',kind:'error'}}))
export const RateLimited=story(landing('rejoin',{toast:{text:'Too many wrong codes. Wait a few minutes and try again',kind:'error'}}))
export const StartBlocked=story(as('director','setupEmpty',{toast:{text:'Waiting for judges: 0/3 joined',kind:'error'}}))
