import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiPipeline } from '../backend/gemini.js';
import { connectLive,liveSetup } from '../backend/live.js';

function fixture(){
 const connections:{model:string;config:any;callbacks:any;inputs:unknown[];closed:boolean}[]=[];
 const events:any[]=[],turns:any[]=[];
 const connect:typeof connectLive=async(model,config,callbacks)=>{
  const c={model,config,callbacks,inputs:[] as unknown[],closed:false};connections.push(c);
  return {sendRealtimeInput:data=>{c.inputs.push(data);},sendToolResponse:()=>{},close:()=>{c.closed=true;}};
 };
 const pipeline=new GeminiPipeline('te',e=>events.push(e),(...turn)=>turns.push(turn),()=>{},connect);
 return {pipeline,connections,events,turns};
}
test('both speakers fan out PCM and preserve interrupted translations separately',async()=>{
 const f=fixture();await f.pipeline.start();
 f.pipeline.audio('doctor','AAAA');f.pipeline.audio('patient','BBBB');
 assert.equal(f.connections.length,4);
 assert.equal(f.connections[1].config.translationConfig.targetLanguageCode,'te');
 assert.equal(f.connections[3].config.translationConfig.targetLanguageCode,'en');
 for(const c of f.connections)assert.equal(c.inputs.length,1);
 const receive=f.connections[3].callbacks.message;
 receive({serverContent:{inputTranscription:{text:'original'},outputTranscription:{text:'partial'}}});
 receive({serverContent:{interrupted:true}});
 receive({serverContent:{inputTranscription:{text:'next'},outputTranscription:{text:'complete'},turnComplete:true}});
 assert.deepEqual(f.turns,[['patient','original','partial',true],['patient','next','complete']]);
 assert.ok(f.events.some(e=>e.type==='interrupt'));
 f.pipeline.close();assert.ok(f.connections.every(c=>c.closed));
});
test('provider failure closes every stream and suppresses late translation callbacks',async()=>{
 const f=fixture();await f.pipeline.start();f.connections[0].callbacks.close();
 assert.ok(f.connections.every(c=>c.closed));
 assert.equal(f.events.filter(e=>e.type==='provider_unavailable').length,1);
 f.connections[1].callbacks.message({serverContent:{outputTranscription:{text:'late'},turnComplete:true}});
 assert.equal(f.turns.length,0);
});
test('raw Live setup converts urgency instructions to a Content object',()=>{
 const setup=liveSetup('gemini-3.8-live',{responseModalities:['AUDIO'],systemInstruction:'Monitor attention'});
 assert.deepEqual(setup.systemInstruction,{parts:[{text:'Monitor attention'}]});
});
test('continuous translation produces a turn without a provider turnComplete event',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture();await f.pipeline.start();const receive=f.connections[3].callbacks.message;
 receive({serverContent:{inputTranscription:{text:'original'},outputTranscription:{text:'I need help.'}}});
 t.mock.timers.tick(1000);receive({serverContent:{outputTranscription:{languageCode:'en'}}});
 t.mock.timers.tick(601);
 assert.deepEqual(f.turns,[['patient','original','I need help.']]);
 receive({serverContent:{turnComplete:true}});assert.equal(f.turns.length,1);f.pipeline.close();
});
