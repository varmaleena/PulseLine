import 'dotenv/config';
import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { GeminiPipeline } from '../dist/backend/gemini.js';

// Real generated speech enters Chromium's microphone, AudioWorklet, gateway,
// and Gemini. No transcript or translation responses are mocked.
await mkdir('test-results/live',{recursive:true});
const cases=[
 {language:'hi',speaker:'patient',text:'मुझे साँस लेने में बहुत तकलीफ़ हो रही है।'},
 {language:'te',speaker:'patient',text:'నాకు ఊపిరి తీసుకోవడం చాలా కష్టంగా ఉంది.'},
 {language:'hi',speaker:'doctor',text:'Can you tell me where it hurts?'},
 {language:'te',speaker:'doctor',text:'Can you tell me where it hurts?'}
];
for(const c of cases){
 const synth=new GeminiPipeline(c.language,()=>{},()=>{},()=>{});
 const speech=await synth.tts(c.text,'normal');synth.close();
 const wav=Buffer.from(speech.audio,'base64');
 assert.equal(wav.toString('ascii',0,4),'RIFF','Fixture must be WAV');
 // Append three seconds of silence to the PCM data chunk so VAD can finish.
 let offset=12,dataOffset=0,rate=24000,align=2;
 while(offset+8<=wav.length){const name=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4);if(name==='fmt '){rate=wav.readUInt32LE(offset+12);align=wav.readUInt16LE(offset+20);}if(name==='data'){dataOffset=offset;break;}offset+=8+size+(size%2);}
 assert.ok(dataOffset);const size=wav.readUInt32LE(dataOffset+4);const padded=Buffer.concat([wav.subarray(0,dataOffset+8+size),Buffer.alloc(rate*align*3)]);padded.writeUInt32LE(padded.length-8,4);padded.writeUInt32LE(size+rate*align*3,dataOffset+4);
 const path=resolve(`test-results/live/${c.language}-${c.speaker}.wav`);await writeFile(path,padded);
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${path}`]});
 try{
  const context=await browser.newContext({permissions:['microphone']});const page=await context.newPage();let audio=0,transcripts=0,chunks=0;const errors=[];
  await page.addInitScript(()=>{window.playedAudio=0;const original=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){window.playedAudio++;return original.apply(this,args);};});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('websocket',ws=>ws.on('framereceived',frame=>{try{const e=JSON.parse(String(frame.payload));if(e.type==='audio_output')audio++;if(e.type==='transcript_update')transcripts++;if(e.type==='audio_received')chunks++;}catch{}}));
  await page.goto(process.env.TEST_BASE_URL||'http://localhost:8082');await page.fill('#patient-name','Asha Rao');await page.fill('#patient-id','P-1001');await page.fill('#reason','Breathing difficulty');await page.check('#consent');await page.selectOption('#mode','live');await page.selectOption('#language',c.language);await page.click('#start');
  await page.locator('#connection').filter({hasText:'Live connection'}).waitFor({timeout:110000});
  if(c.speaker==='doctor')await page.click('#doctor-talk');
  await page.waitForFunction(side=>{const text=document.getElementById(side+'-live-original').textContent;return text&&!text.startsWith('Waiting');},c.speaker,{timeout:45000});
  await page.locator('.turn').first().waitFor({timeout:45000});
  await page.waitForFunction(side=>!document.getElementById(side+'-live-translation').textContent.startsWith('Translation appears'),c.speaker,{timeout:45000});
  if(c.speaker==='doctor')await page.waitForFunction(word=>document.getElementById('doctor-live-translation').textContent.includes(word),c.language==='hi'?'दर्द':'నొప్పి',{timeout:45000});
  if(c.speaker==='patient')await page.locator('#signal-title').filter({hasText:'Attention needed'}).waitFor({timeout:20000});
  await page.screenshot({path:`test-results/live/${c.language}-${c.speaker}.png`,fullPage:true});
  assert.ok(chunks>0,'Microphone PCM must reach the gateway');assert.ok(transcripts>0,'Live transcriber must emit captions');assert.ok(audio>0,'Translated audio must return');assert.deepEqual(errors,[]);
  const attention=await page.locator('#signal-title').textContent();
  if(c.speaker==='patient')assert.equal(attention,'Attention needed','Reported breathing distress must flag automatically');
  assert.ok(await page.evaluate(()=>window.playedAudio>0),'Translated audio must be scheduled for playback');
  console.log(JSON.stringify({...c,passed:true,transcripts,audio,chunks,attention,original:await page.locator('#'+c.speaker+'-live-original').textContent(),translation:await page.locator('#'+c.speaker+'-live-translation').textContent()}));
  await page.click('#end');await page.locator('#notice').filter({hasText:'Session complete'}).waitFor();
 }catch(error){console.error(JSON.stringify({language:c.language,speaker:c.speaker,error:error.message}));throw error;}
 finally{await browser.close();}
}
