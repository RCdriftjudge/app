import {story,as} from './fixtures.js'

export default {title:'Live Display',tags:['autodocs'],parameters:{viewport:{defaultViewport:'responsive'},docs:{description:{component:'Big screen at the track. Also opens in a new tab from the director’s phone.'}}},globals:{viewport:{value:undefined}}}

export const Registration=story(as('display','setup'),'Shows the driver QR code so walk-ups can register.')
export const Qualifying=story(as('display','qualifying'))
export const Battle=story(as('display','battleRun2'))
export const OneMoreTime=story(as('display','omt'))
export const Result=story(as('display','decided'))
export const Champion=story(as('display','finished'))
export const DirectorPreview=story(as('director','battleRun2',{displayMode:true}),'Opened from the director’s phone with ?view=display.')
