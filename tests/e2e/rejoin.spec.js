import {test,expect} from '@playwright/test'

const authUser={id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'anon@example.test'}
const session={access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user:authUser}
const json=body=>({status:200,contentType:'application/json',body:JSON.stringify(body)})

const competitorState={
  competition:{id:'comp-1',name:'Saturday Night Drift',phase:'setup',judge_count:3,state_version:1},
  me:{role:'competitor'},
  my_drivers:[{id:'driver-1',name:'Pat',team_name:null,car_number:'1',status:'pending',rejoin_code:'A9'}],
  judges:[],drivers:[{id:'driver-1',name:'Pat',car_number:'1',status:'pending'}],leaderboard:[],qualifying_progress:[],my_scores:[],battles:[],
}

async function mockSupabase(page){
  await page.route('**/auth/v1/signup',route=>route.fulfill(json(session)))
  await page.route('**/auth/v1/user',route=>route.fulfill(json({user:authUser})))
  await page.route('**/realtime/**',route=>route.abort())
  await page.route('**/rest/v1/rpc/invite_info',async route=>{
    const {p_code}=JSON.parse(route.request().postData()||'{}')
    await route.fulfill(json(p_code==='RACE42'?{kind:'driver',competition_name:'Saturday Night Drift',registration_open:true}:{kind:'judge',competition_name:'Saturday Night Drift'}))
  })
  await page.route('**/rest/v1/rpc/competition_state',route=>route.fulfill(json(competitorState)))
}

test('competitor QR lands in registration flow with competition intent',async({page})=>{
  await mockSupabase(page)
  await page.goto('/?register=RACE42')
  await expect(page.getByRole('heading',{name:'Register as Competitor'})).toBeVisible()
  await expect(page.locator('#driverCode')).toHaveValue('RACE42')
  await expect(page.getByText('Registering for Saturday Night Drift')).toBeVisible()
  await expect(page.getByRole('button',{name:'Register',exact:true})).toBeVisible()
})

test('competitor registration shows car number and two-character rejoin code, then restores same identity',async({page})=>{
  let registerCalls=0
  let rejoinCalls=0
  await mockSupabase(page)
  await page.route('**/rest/v1/rpc/register_driver',async route=>{
    registerCalls++
    await route.fulfill(json({competition_id:'comp-1',competition_name:'Saturday Night Drift',driver_id:'driver-1',car_number:'1',rejoin_code:'A9',role:'competitor'}))
  })
  await page.route('**/rest/v1/rpc/rejoin',async route=>{
    rejoinCalls++
    const body=JSON.parse(route.request().postData()||'{}')
    expect(body).toEqual({p_event_code:'RACE42',p_rejoin_code:'A9'})
    await route.fulfill(json({competition_id:'comp-1',competition_name:'Saturday Night Drift',driver_id:'driver-1',car_number:'1',rejoin_code:'A9',role:'competitor'}))
  })

  await page.goto('/?register=RACE42')
  await page.locator('#driverName').fill('Pat')
  await page.getByRole('button',{name:'Register',exact:true}).click()
  await expect(page.getByText('Car #1')).toBeVisible()
  await expect(page.getByText('A9')).toBeVisible()
  await expect(page.getByText('Saturday Night Drift')).toBeVisible()
  await expect(page.getByText('Waiting for director approval')).toBeVisible()
  expect(registerCalls).toBe(1)

  await page.evaluate(()=>localStorage.clear())
  await page.goto('/')
  await page.getByRole('button',{name:'Already registered? Rejoin'}).click()
  await page.locator('#rejoinEvent').fill('race42')
  await page.locator('#rejoinCode').fill('a9')
  await page.getByRole('button',{name:'Rejoin',exact:true}).click()
  await expect(page.getByText('Car #1')).toBeVisible()
  await expect(page.getByText('Saturday Night Drift')).toBeVisible()
  expect(rejoinCalls).toBe(1)
})

test('judge QR lands directly in judge join flow',async({page})=>{
  await mockSupabase(page)
  await page.goto('/?join=J7')
  await expect(page.getByRole('heading',{name:'Join as Judge'})).toBeVisible()
  await expect(page.locator('#code')).toHaveValue('J7')
  await expect(page.getByText('Joining Saturday Night Drift')).toBeVisible()
  await expect(page.getByRole('button',{name:'Join as Judge'})).toBeVisible()
})

test('home offers separate judge and live display joins',async({page})=>{
  await mockSupabase(page)
  let role
  await page.route('**/rest/v1/rpc/join_competition_by_code',async route=>{role=JSON.parse(route.request().postData()).p_role;await route.fulfill(json({competition_id:'comp-1',member_id:'m1',role:'display'}))})
  await page.goto('/')
  await page.getByRole('button',{name:'Set up a Live Display screen'}).click()
  await expect(page.getByRole('heading',{name:'Set up Live Display'})).toBeVisible()
  await page.locator('#code').fill('K7Q2XM')
  await page.getByRole('button',{name:'Connect Live Display'}).click()
  await expect.poll(()=>role).toBe('display')
  await page.goto('/')
  await page.evaluate(()=>localStorage.clear())
  await page.goto('/')
  await page.getByRole('button',{name:'Join as Judge'}).click()
  await expect(page.getByRole('heading',{name:'Join as Judge'})).toBeVisible()
})

test('invalid rejoin code produces an actionable error',async({page})=>{
  await mockSupabase(page)
  await page.route('**/rest/v1/rpc/rejoin',route=>route.fulfill(json({error:'Rejoin code not found'})))
  await page.goto('/')
  await page.getByRole('button',{name:'Already registered? Rejoin'}).click()
  await page.locator('#rejoinEvent').fill('RACE42')
  await page.locator('#rejoinCode').fill('ZZ')
  await page.getByRole('button',{name:'Rejoin',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('Rejoin code not found')
})

test('user-supplied names are escaped, not rendered as HTML',async({page})=>{
  await mockSupabase(page)
  await page.route('**/rest/v1/rpc/competition_state',route=>route.fulfill(json({...competitorState,my_drivers:[{...competitorState.my_drivers[0],name:'<img src=x onerror="window.pwned=1">'}]})))
  await page.addInitScript(()=>localStorage.setItem('rcdj-session-v10',JSON.stringify({competition_id:'comp-1',role:'competitor'})))
  await page.goto('/')
  await expect(page.getByText('<img src=x onerror="window.pwned=1">')).toBeVisible()
  expect(await page.evaluate(()=>window.pwned)).toBeUndefined()
})

// Bad venue wifi: requests that never answer must not lock the app.
const stall=()=>new Promise(()=>{})

test('a stalled request times out with a message and the app stays usable',async({page})=>{
  test.setTimeout(40000)
  await mockSupabase(page)
  await page.route('**/rest/v1/rpc/rejoin',stall)
  await page.goto('/')
  await page.getByRole('button',{name:'Already registered? Rejoin'}).click()
  await page.locator('#rejoinEvent').fill('K7Q2XM')
  await page.locator('#rejoinCode').fill('A9')
  await page.getByRole('button',{name:'Rejoin',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('No connection to the server',{timeout:20000})
  await page.getByRole('button',{name:'Back'}).click()
  await expect(page.getByRole('button',{name:'Create Competition'})).toBeVisible()
})

test('a stalled judge score is saved on the phone instead of freezing',async({page})=>{
  test.setTimeout(40000)
  await mockSupabase(page)
  const driver={id:'d1',name:'Ava',team_name:null,car_number:'1',status:'approved'}
  await page.route('**/rest/v1/rpc/competition_state',route=>route.fulfill(json({
    competition:{id:'comp-1',name:'Saturday Night Drift',phase:'qualifying',judge_count:3,state_version:2,active_driver_id:'d1',active_run:1},
    me:{member_id:'m2',role:'judge',judge_number:2,rejoin_code:'KC',display_name:'Kim'},my_drivers:[],judges:[],drivers:[driver],
    leaderboard:[],qualifying_progress:[],my_scores:[],battles:[]})))
  await page.route('**/rest/v1/rpc/submit_qualifying_score',stall)
  await page.addInitScript(()=>localStorage.setItem('rcdj-session-v10',JSON.stringify({competition_id:'comp-1',role:'judge'})))
  await page.goto('/')
  for(const [k,v] of [['line','30'],['angle','25'],['style','28']])await page.locator(`input[id^="score-${k}-"]`).fill(v)
  await page.getByRole('button',{name:'Submit score'}).click()
  await expect(page.getByText('Saved offline')).toBeVisible({timeout:20000})
  await expect(page.getByText('1 submission waiting to send')).toBeVisible()
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('rcdj-pending-calls-v10'))).length).toBe(1)
})
