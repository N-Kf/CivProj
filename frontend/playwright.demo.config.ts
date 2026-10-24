import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'**/browser-demo.spec.ts',workers:1,timeout:30000,
  use:{headless:true,launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']},screenshot:'only-on-failure'},
  webServer:{command:'../.venv/bin/python -m http.server 5185 --bind 127.0.0.1 --directory ../demo',url:'http://127.0.0.1:5185',reuseExistingServer:false},
});
