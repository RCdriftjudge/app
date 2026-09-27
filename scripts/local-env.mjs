// Writes .env.local pointing the app at the local Supabase started with `npx supabase start`.
import {execSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'
const env=Object.fromEntries([...execSync('npx supabase status -o env',{encoding:'utf8'}).matchAll(/^(\w+)="?(.*?)"?$/gm)].map(m=>[m[1],m[2]]))
writeFileSync('.env.local',`VITE_SUPABASE_URL=${env.API_URL}\nVITE_SUPABASE_PUBLISHABLE_KEY=${env.PUBLISHABLE_KEY||env.ANON_KEY}\n`)
console.log(`.env.local -> ${env.API_URL}`)
