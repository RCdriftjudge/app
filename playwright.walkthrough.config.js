import {defineConfig} from '@playwright/test'

// End-to-end walkthrough against a real local Supabase (npx supabase start). Records a video per device
// into test-results/walkthrough; scripts/compose-walkthrough.sh tiles them into one video.
export default defineConfig({
  testDir:'./tests/walkthrough',
  timeout:15*60*1000,
  expect:{timeout:15000},
  outputDir:'test-results/walkthrough-artifacts',
  use:{baseURL:'http://127.0.0.1:4174',headless:true},
  webServer:{command:'npx vite --host 127.0.0.1 --port 4174 --strictPort',url:'http://127.0.0.1:4174',reuseExistingServer:true},
})
