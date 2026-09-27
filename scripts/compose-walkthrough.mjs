// Tiles the per-device walkthrough recordings into one captioned video.
// Run after: npx playwright test -c playwright.walkthrough.config.js
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {execFileSync} from 'node:child_process'

const DIR='test-results/walkthrough'
const OUT=process.argv[2]||`${DIR}/walkthrough.mp4`
const {steps,videos,duration}=JSON.parse(readFileSync(`${DIR}/captions.json`,'utf8'))
const FONT=['/System/Library/Fonts/Supplemental/Arial Bold.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find(existsSync)
const PW=390,PH=844,DW=1280,DH=720,LABEL=40,BAR=110,GAP=12
const W=Math.max(4*PW+3*GAP,PW+GAP+DW),H=BAR+2*(PH+LABEL)+GAP

// [name, label, x, y]
const tiles=[
  ['director','Director',0,BAR],['judge1','Judge 1',PW+GAP,BAR],['judge2','Judge 2',2*(PW+GAP),BAR],['judge3','Judge 3',3*(PW+GAP),BAR],
  ['driver','Driver phone',0,BAR+PH+LABEL+GAP],['display','Live display',PW+GAP,BAR+PH+LABEL+GAP],
]
mkdirSync(`${DIR}/captions`,{recursive:true})
const inputs=[],filters=[]
tiles.forEach(([name,label],i)=>{
  inputs.push('-ss',String(videos[name].offset.toFixed(3)),'-i',videos[name].path)
  writeFileSync(`${DIR}/captions/label-${i}.txt`,label)
  filters.push(`[${i}:v]setpts=PTS-STARTPTS,pad=iw:ih+${LABEL}:0:${LABEL}:color=0x101010,drawtext=fontfile='${FONT}':textfile='${DIR}/captions/label-${i}.txt':fontcolor=0x9a9a9a:fontsize=24:x=8:y=8[v${i}]`)
})
let chain=`color=c=0x050505:s=${W}x${H}:d=${duration.toFixed(2)}[bg]`
let last='bg'
tiles.forEach(([,,x,y],i)=>{chain+=`;[${last}][v${i}]overlay=${x}:${y}:shortest=0:eof_action=pass[o${i}]`;last=`o${i}`})
steps.forEach((s,i)=>{
  const end=i+1<steps.length?steps[i+1].t:duration
  writeFileSync(`${DIR}/captions/step-${i}.txt`,`${i+1}. ${s.text}`)
  chain+=`;[${last}]drawtext=fontfile='${FONT}':textfile='${DIR}/captions/step-${i}.txt':fontcolor=white:fontsize=34:x=24:y=(${BAR}-text_h)/2:enable='between(t,${s.t.toFixed(2)},${end.toFixed(2)})'[c${i}]`
  last=`c${i}`
})
chain+=`;[${last}]scale=1400:-2[final]`
const graph=[...filters,chain].join(';')
execFileSync('ffmpeg',['-y','-loglevel','error',...inputs,'-filter_complex',graph,'-map','[final]','-t',duration.toFixed(2),
  '-c:v','libx264','-preset','medium','-crf','26','-pix_fmt','yuv420p','-r','25','-movflags','+faststart',OUT],{stdio:'inherit'})
console.log(`wrote ${OUT} (${W}x${H} scaled to 1400 wide, ${duration.toFixed(0)}s)`)
