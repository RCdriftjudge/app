import {test,expect} from '@playwright/test'

const authUser={id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'anon@example.test'}
const session={access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user:authUser}

async function mockSupabase(page){
  await page.route('**/auth/v1/signup',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(session)}))
  await page.route('**/auth/v1/user',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user:authUser})}))
}

test('competitor QR lands in registration flow with competition intent',async({page})=>{
  await page.goto('/?register=RACE42')
  await expect(page.getByRole('heading',{name:'Register as Competitor'})).toBeVisible()
  await expect(page.locator('#driverCode')).toHaveValue('RACE42')
  await expect(page.getByText('Enter the competition registration code.')).toBeVisible()
})

test('competitor registration shows car number and two-character rejoin code, then restores same identity',async({page})=>{
  let registerCalls=0
  let rejoinCalls=0
  await mockSupabase(page)
  await page.route('**/rest/v1/rpc/register_driver',async route=>{
    registerCalls++
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{driver_id:'driver-1',competition_id:'comp-1',competition_name:'Saturday Night Drift',registration_position:1,car_number:'1',status:'pending',rejoin_code:'A9'}])})
  })
  await page.route('**/rest/v1/rpc/rejoin_driver',async route=>{
    rejoinCalls++
    const body=JSON.parse(route.request().postData()||'{}')
    expect(body.p_rejoin_code).toBe('A9')
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{driver_id:'driver-1',competition_id:'comp-1',competition_name:'Saturday Night Drift',registration_position:1,car_number:'1',status:'pending',name:'Pat'}])})
  })

  await page.goto('/?register=RACE42')
  await page.locator('#driverName').fill('Pat')
  await page.getByRole('button',{name:'Register'}).click()
  await expect(page.getByText('Car #1')).toBeVisible()
  await expect(page.getByText('A9')).toBeVisible()
  await expect(page.getByText('Saturday Night Drift')).toBeVisible()
  expect(registerCalls).toBe(1)

  await page.evaluate(()=>localStorage.clear())
  await page.goto('/')
  await page.getByRole('button',{name:'Already registered? Rejoin'}).click()
  await page.locator('#rejoinCode').fill('a9')
  await page.getByRole('button',{name:'Rejoin as Competitor'}).click()
  await expect(page.getByText('Car #1')).toBeVisible()
  await expect(page.getByText('Saturday Night Drift')).toBeVisible()
  expect(rejoinCalls).toBe(1)
})

test('judge QR lands directly in judge join flow',async({page})=>{
  await page.goto('/?join=J7')
  await expect(page.getByRole('heading',{name:'Join Competition'})).toBeVisible()
  await expect(page.locator('#code')).toHaveValue('J7')
  await expect(page.getByRole('button',{name:'Join as Judge'})).toBeVisible()
})

test('invalid rejoin code produces an actionable error',async({page})=>{
  await mockSupabase(page)
  await page.route('**/rest/v1/rpc/rejoin_driver',async route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}))
  await page.goto('/')
  await page.getByRole('button',{name:'Already registered? Rejoin'}).click()
  await page.locator('#rejoinCode').fill('ZZ')
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Rejoin code not found');await dialog.dismiss()})
  await page.getByRole('button',{name:'Rejoin as Competitor'}).click()
})
