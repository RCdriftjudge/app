import {story,landing} from './fixtures.js'

export default {title:'Landing',tags:['autodocs'],parameters:{docs:{description:{component:'Screens before the device belongs to a competition.'}}}}

export const Home=story(landing('home'))
export const CreateCompetition=story(landing('create'))
export const JoinByCode=story(landing('join'),'Judges and displays join with the access code. Two explicit buttons, no hidden role state.')
export const JoinFromQr=story(landing('join',{joinCode:'K7Q2XM',invite:{kind:'judge',competition_name:'Saturday Night Drift'}}),'Scanning the judge QR fills in the code and names the event.')
export const RegisterByCode=story(landing('driver'))
export const RegisterFromQr=story(landing('driver',{registerCode:'R4D9PL',invite:{kind:'driver',competition_name:'Saturday Night Drift',registration_open:true}}))
export const RegistrationClosed=story(landing('driver',{registerCode:'R4D9PL',invite:{kind:'driver',competition_name:'Saturday Night Drift',registration_open:false}}),'Registration code scanned after qualifying has started.')
export const Rejoin=story(landing('rejoin'),'One form for drivers, judges (2-character code) and the director (6-character PIN).')
export const Loading=story({...landing('home'),session:{competition_id:'x',role:'judge'},data:null})
export const LoadFailed=story({...landing('home'),session:{competition_id:'x',role:'judge'},data:null,error:'No connection to the server'})
