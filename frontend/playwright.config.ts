import {defineConfig} from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir:'./tests', testMatch:'**/workflow.spec.ts', fullyParallel:false, workers:1,
  timeout:30000, retries:0,
  use:{baseURL:'http://127.0.0.1:5174', headless:true, launchOptions:{executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox']}, screenshot:'only-on-failure', trace:'retain-on-failure'},
  webServer:[
    {command:'../.venv/bin/python -m app.seed --demo && ../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8011',cwd:'../backend',url:'http://127.0.0.1:8011/api/health',reuseExistingServer:false,env:{CIVPROJ_DB:path.resolve(process.cwd(),'../.local/e2e.sqlite3'),CIVPROJ_ORIGINS:'http://127.0.0.1:5174'}},
    {command:'npm run dev -- --port 5174 --strictPort',url:'http://127.0.0.1:5174',reuseExistingServer:false,env:{CIVPROJ_API_TARGET:'http://127.0.0.1:8011'}},
  ],
});
