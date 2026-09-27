// A full event on six devices against a real local Supabase: director, three judges, a live display and
// a driver's phone. Each device records a video; captions.json marks what happens when.
import {test,expect} from '@playwright/test'
import {mkdirSync,writeFileSync,rmSync} from 'node:fs'

const OUT='test-results/walkthrough'
const PHONE={width:390,height:844}
const SCREEN={width:1280,height:720}
const pause=ms=>new Promise(r=>setTimeout(r,ms))

test('walkthrough: a full competition from registration to champion',async({browser})=>{
  rmSync(OUT,{recursive:true,force:true});mkdirSync(OUT,{recursive:true})
  const devices={}
  for(const [name,size] of [['director',PHONE],['judge1',PHONE],['judge2',PHONE],['judge3',PHONE],['driver',PHONE],['display',SCREEN]]){
    const ctx=await browser.newContext({viewport:size,recordVideo:{dir:`${OUT}/${name}`,size},hasTouch:size===PHONE,baseURL:'http://127.0.0.1:4174'})
    const page=await ctx.newPage()
    page.on('dialog',d=>d.accept(d.type()==='prompt'?'':undefined))
    devices[name]={ctx,page,started:Date.now()}
    await page.goto('/')
  }
  const t0=Math.max(...Object.values(devices).map(d=>d.started))
  const steps=[]
  const step=async(text,ms=600)=>{steps.push({t:(Date.now()-t0)/1000,text});await pause(ms)}
  const {director,display,driver}=Object.fromEntries(Object.entries(devices).map(([k,v])=>[k,v.page]))
  const judges=[devices.judge1.page,devices.judge2.page,devices.judge3.page]

  await step('The director creates the event and picks a 3-judge panel',1200)
  await director.getByRole('button',{name:'Create Competition'}).click()
  await director.locator('#competitionName').pressSequentially('Saturday Night Drift',{delay:30})
  await director.locator('#directorName').pressSequentially('Sam',{delay:30})
  await pause(500)
  await director.getByRole('button',{name:'Create Competition'}).click()
  await expect(director.getByRole('heading',{name:'Get ready'})).toBeVisible()
  const [joinCode,regCode]=await director.locator('.code').allTextContents()
  await pause(1200)

  await step('The live display joins with the judge access code')
  await display.getByRole('button',{name:'Set up a Live Display screen'}).click()
  await display.locator('#code').pressSequentially(joinCode,{delay:40})
  await display.locator('#name').fill('Big screen')
  await pause(500)
  await display.getByRole('button',{name:'Connect Live Display'}).click()
  await expect(display.getByText('Scan to register')).toBeVisible()

  await step('Judges scan the judge QR code and are seated 1, 2 and 3')
  for(const [i,j] of judges.entries()){
    await j.goto(`/?join=${joinCode}`)
    await expect(j.getByText('Joining Saturday Night Drift')).toBeVisible()
    await j.locator('#name').pressSequentially(['Alex','Kim','Jo'][i],{delay:30})
    await j.getByRole('button',{name:'Join as Judge'}).click()
    await expect(j.getByRole('heading',{name:`You're Judge ${i+1}`})).toBeVisible()
  }
  await expect(director.getByText('Judges joined: 3/3')).toBeVisible()
  await pause(800)

  await step('A team manager scans the driver QR code and registers three drivers')
  await driver.goto(`/?register=${regCode}`)
  await expect(driver.getByText('Registering for Saturday Night Drift')).toBeVisible()
  for(const [i,[name,team]] of [['Ava','Westside Slide'],['Ben','Westside Slide'],['Cal','Westside Slide']].entries()){
    if(i>0){await driver.getByRole('button',{name:'Register another driver'}).click()}
    await driver.locator('#driverName').pressSequentially(name,{delay:30})
    await driver.locator('#teamName').fill(team)
    await driver.getByRole('button',{name:'Register',exact:true}).click()
    await expect(driver.getByText(`Car #${i+1}`)).toBeVisible()
    await pause(500)
  }
  await expect(driver.getByText('Waiting for director approval').first()).toBeVisible()

  await step('The director approves them and adds a walk-up driver by hand')
  for(let i=0;i<3;i++){
    await expect(director.getByRole('button',{name:'Approve'}).first()).toBeVisible()
    await director.getByRole('button',{name:'Approve'}).first().click()
    await pause(400)
  }
  await director.locator('#newDriverName').pressSequentially('Dan',{delay:30})
  await director.getByRole('button',{name:'Add driver'}).click()
  await expect(director.getByText('Drivers approved: 4')).toBeVisible()
  await expect(driver.getByText('Approved')).toHaveCount(3)
  await expect(display.getByText('4 confirmed')).toBeVisible()
  await pause(800)

  await step('Qualifying starts. Judges score every run for line, angle and style')
  await director.getByRole('button',{name:'Start Qualifying'}).click()
  await expect(director.getByRole('heading',{name:'On track'})).toBeVisible()

  // Per-judge [line, angle, style] for each driver's two runs.
  const scores={
    Ava:[[[31,26,30],[30,27,31],[32,26,29]],[[33,28,32],[32,28,33],[33,27,32]]],
    Ben:[[[30,25,29],[29,26,28],[30,25,30]],[[25,20,24],[24,21,22],[26,20,23]]],
    Cal:[[[27,22,26],[26,23,25],[27,22,27]],[[28,24,27],[29,23,28],[28,25,27]]],
    Dan:[[[26,21,24],[25,22,23],[27,21,24]],[[20,18,20],[21,17,19],[22,18,20]]],
  }
  const order=['Ava','Ben','Cal','Dan']
  for(const run of [1,2]){
    for(const name of order){
      const onTrack=`${name} · run ${run}`
      await expect(display.locator('.live h2')).toContainText(name)
      await expect(display.locator('.live small')).toContainText(`RUN ${run}`)
      await step(run===1&&name==='Ben'?`${onTrack}. Judge 3 loses signal: the score is saved on the phone and sent on reconnect`:`Qualifying: ${onTrack}`,200)
      for(const [i,j] of judges.entries()){
        await expect(j.locator('.onTrackName')).toContainText(name)
        const [line,angle,style]=scores[name][run-1][i]
        const offline=run===1&&name==='Ben'&&i===2
        if(offline)await devices.judge3.ctx.setOffline(true)
        await j.locator('input[id^="score-line-"]').fill(String(line))
        await j.locator('input[id^="score-angle-"]').fill(String(angle))
        await j.locator('input[id^="score-style-"]').fill(String(style))
        await j.getByRole('button',{name:/Submit score|Update score/}).click()
        if(offline){
          await expect(j.getByText('Saved offline')).toBeVisible()
          await expect(director.getByText('Judges scored: 2/3')).toBeVisible()
          await pause(2500)
          await devices.judge3.ctx.setOffline(false)
        }
        await expect(j.locator('.badge',{hasText:'Submitted'})).toBeVisible()
      }
      await expect(director.getByText('Judges scored: 3/3')).toBeVisible()
      await pause(run===1&&name==='Ava'?1500:500)
      if(!(run===2&&name==='Dan'))await director.getByRole('button',{name:'Next ▶'}).click()
    }
  }
  await expect(display.locator('table.board tbody tr')).toHaveCount(4)
  await step('The leaderboard ranks drivers by their best run',2500)

  await step('The director closes qualifying and builds the Top 4 bracket (1 v 4, 2 v 3)')
  await director.getByRole('button',{name:'Build Top 4 bracket'}).click()
  await expect(display.locator('.versus')).toBeVisible()
  await pause(1500)

  const runPair=async(leadB)=>{
    await pause(1200)
    await director.getByRole('button',{name:`Run 2 · ${leadB} leads`}).click()
    await expect(judges[0].locator('[data-action="vote"][data-v="A"]')).toBeEnabled()
    await pause(800)
  }
  const vote=async(votes)=>{
    for(const [i,v] of votes.entries()){
      await judges[i].locator(`[data-action="vote"][data-v="${v}"]`).click()
      await pause(500)
    }
  }

  await step('Semi final 1: Ava (seed 1) leads run 1, Dan leads run 2')
  await expect(judges[0].locator('.versus')).toContainText('Ava')
  await runPair('Dan')
  await step('Judges vote blind: Ava, Dan and One More Time. No majority, so it is a one more time')
  await vote(['A','B','OMT'])
  await expect(display.getByText('ONE MORE TIME #1')).toBeVisible()
  await pause(1500)
  await step('OMT: both runs again, then a new vote')
  await runPair('Dan')
  await vote(['A','A','B'])
  await expect(display.locator('.result')).toContainText('Ava')
  await step('Ava wins 2 to 1 and moves on to the final',2000)

  await step("Judge 2's phone is wiped. On the new phone the rejoin code is refused until the director releases it")
  const kimCode=(await judges[1].locator('.judgeHead .mono').textContent()).trim()
  await judges[1].evaluate(()=>localStorage.clear())
  await judges[1].goto('/')
  await judges[1].getByRole('button',{name:'Already registered? Rejoin'}).click()
  await judges[1].locator('#rejoinEvent').fill(joinCode)
  await judges[1].locator('#rejoinCode').pressSequentially(kimCode,{delay:60})
  await judges[1].getByRole('button',{name:'Rejoin',exact:true}).click()
  await expect(judges[1].getByRole('status')).toContainText('Ask the director to release it')
  await pause(1500)
  await step('The director taps "New phone" for Judge 2, who rejoins with the same seat and code')
  await director.locator('[data-action="releaseJudge"][data-name="Kim"]').click()
  await expect(director.getByText(`Released: rejoin with ${kimCode}`)).toBeVisible()
  await pause(800)
  await judges[1].getByRole('button',{name:'Rejoin',exact:true}).click()
  await expect(judges[1].getByText('JUDGE 2')).toBeVisible()
  await pause(1500)

  await step('Semi final 2: Ben vs Cal. Judge 2 flags contact for the director')
  await director.getByRole('button',{name:/Next battle/}).click()
  await expect(judges[1].locator('.versus')).toContainText('Cal')
  await judges[1].getByRole('button',{name:'⚠ Contact'}).click()
  await expect(director.getByText('Judge calls')).toBeVisible()
  await runPair('Cal')
  await vote(['B','B','A'])
  await expect(display.locator('.result')).toContainText('Cal')
  await step('Cal upsets Ben. The final is Ava vs Cal',2000)

  await step('Final: Ava vs Cal')
  await director.getByRole('button',{name:/Next battle/}).click()
  await expect(display.locator('.live small')).toContainText('FINAL')
  await runPair('Cal')
  await vote(['A','A','A'])
  await expect(display.getByText('🏆')).toBeVisible()
  await expect(driver.getByText('Out in the Final.')).toBeVisible()
  await step('Ava is champion. The display and every phone update live',4000)

  for(const d of Object.values(devices))await d.ctx.close()
  const videos={}
  for(const [name,d] of Object.entries(devices))videos[name]={path:await d.page.video().path(),offset:(t0-d.started)/1000}
  writeFileSync(`${OUT}/captions.json`,JSON.stringify({steps,videos,duration:(Date.now()-t0)/1000},null,2))
})
