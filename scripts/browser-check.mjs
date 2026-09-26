import { chromium } from '@playwright/test';
import { mkdir,readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1120}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await mkdir('test-results/qa',{recursive:true});
try{
 await page.goto(process.env.TEST_BASE_URL||'http://localhost:8080');await page.locator('#start').waitFor();
 await page.screenshot({path:'test-results/qa/desktop.png',fullPage:true});
 await page.locator('#sound').uncheck();
 await page.selectOption('#mode','demo');
 for(const language of ['hi','te']){
  await page.selectOption('#language',language);await page.click('#start');await page.locator('#connection').filter({hasText:'Rehearsal connected'}).waitFor();
  for(let i=0;i<4;i++){await page.click('#demo-next');await page.waitForFunction(n=>document.querySelectorAll('.turn').length===n,i+1);}
  assert.equal(await page.locator('#signal-title').textContent(),'Attention needed');assert.equal(await page.locator('.turn').count(),4);
  await page.click('#clear');await page.locator('#signal-title').filter({hasText:'Conversation steady'}).waitFor();
  const downloadPromise=page.waitForEvent('download');await page.click('#export');const download=await downloadPromise;assert.match(download.suggestedFilename(),/^pulseline-/);
  await page.screenshot({path:`test-results/qa/${language}-conversation.png`,fullPage:true});
  await page.click('#end');await page.locator('#notice').filter({hasText:'Session complete'}).waitFor();await page.waitForFunction(()=>!document.getElementById('start').disabled);
  await page.selectOption('#language',language==='hi'?'te':'hi');
  const exported=page.waitForEvent('download');await page.click('#export');const saved=await exported;const record=JSON.parse(await readFile(await saved.path(),'utf8'));assert.equal(record.languages.patient,language,'Export retains the session language after selector changes');
 }
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/qa/mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,languages:['hi','te'],checks:['start','four turns','urgent interruption','clear flag','download','end','mobile layout','no JS errors']}));
}finally{await browser.close();}
