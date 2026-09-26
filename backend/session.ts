import { randomUUID } from 'node:crypto';
import { GeminiPipeline } from './gemini.js';
import { phrases,rms,type Speaker,type Urgency,type Turn,type ClientMessage } from './protocol.js';
import { SessionStore,type RecordData } from './store.js';
import { reportedAttention } from './attention.js';
export class Session {
 record:RecordData;
 private pipeline?:GeminiPipeline;
 private ended=false;
 private ending?:Promise<void>;
 private initializing?:Promise<void>;
 private speechEpoch=0;
 private speechQueue=Promise.resolve();
 private queue=Promise.resolve();
 private seq={doctor:-1,patient:-1};
 private urgency:Record<Speaker,Urgency>={doctor:'normal',patient:'normal'};
 private loud={doctor:0,patient:0};
 private lastFlag={doctor:0,patient:0};
 private began={doctor:0,patient:0};
 private store=new SessionStore();
 constructor(language:'hi'|'te',mode:'demo'|'live',private send:(event:Record<string,unknown>)=>void){this.record={sessionId:randomUUID(),status:'active',startedAt:new Date().toISOString(),languages:{doctor:'en',patient:language},mode,turns:[]};}
 start(){
  this.initializing=this.initialize();return this.initializing;
 }
 private async initialize(){
  await this.store.save(this.record);
  if(this.ended)return;
  if(this.record.mode==='live'){
   this.pipeline=new GeminiPipeline(this.record.languages.patient,e=>{if(!this.ended)this.send(e);},(s,o,t,p)=>this.commit(s,o,t,!!p),(s,u,source)=>this.flag(s,u,source));
   await this.pipeline.start();
  }
  if(this.ended)return;
  this.send({type:'session_started',sessionId:this.record.sessionId,mode:this.record.mode,urgencyMode:process.env.URGENCY_MODE||'acoustic',speechMode:process.env.SPEECH_MODE||'native'});
 }
 flag(speaker:Speaker,urgency:Urgency,source='manual'){
  if(this.ended)return;
  if(source!=='manual'&&this.urgency[speaker]==='high'&&urgency!=='high')return;
  this.urgency[speaker]=urgency;this.lastFlag[speaker]=Date.now();
  this.send({type:'urgency_update',speaker,urgency,source});
  if(urgency==='high'){this.speechEpoch++;this.send({type:'interrupt',speaker});this.pipeline?.endAudio(speaker);}
 }
 async handle(message:ClientMessage){
  if(this.ended)throw new Error('Session has ended');
  if(message.type==='flag_urgent')this.flag(message.speaker,message.urgency);
  if(message.type==='audio_end')this.pipeline?.endAudio(message.mic);
  if(message.type==='audio_chunk'){
   if(this.record.mode!=='live')throw new Error('Microphone input requires a live session');
   if(message.seq<=this.seq[message.mic])throw new Error('Out-of-order audio chunk');
   const pcm=Buffer.from(message.data,'base64');if(pcm.length%2||pcm.length>16000)throw new Error('Invalid PCM16 chunk');
   this.seq[message.mic]=message.seq;
   const level=rms(pcm);if(level>0.015&&!this.began[message.mic])this.began[message.mic]=Date.now();
   this.loud[message.mic]=level>0.22?this.loud[message.mic]+pcm.length/32000:0;
   if(this.loud[message.mic]>0.45&&Date.now()-this.lastFlag[message.mic]>5000&&this.urgency[message.mic]==='normal')this.flag(message.mic,'elevated','Sustained vocal intensity · automatic');
   if(message.seq%10===0)this.send({type:'audio_received',speaker:message.mic,chunks:message.seq+1,level});
   this.pipeline?.audio(message.mic,message.data);
  }
  if(message.type==='demo_turn'){
   if(this.record.mode!=='demo')throw new Error('Rehearsal turns are disabled in live mode');
   const [s,o,t]=phrases[this.record.languages.patient][message.index];this.began[s]=Date.now();
   this.send({type:'transcript_update',speaker:s,text:o,final:true});
   if(message.index===3)this.flag(s,'high','scripted rehearsal');
   this.commit(s,o,t,false);
  }
 }
 private commit(speaker:Speaker,original_text:string,translated_text:string,provisional:boolean){
  if(this.ended||this.record.turns.length>=500)return;
  const reason=speaker==='patient'&&!provisional?reportedAttention(translated_text):undefined;
  if(reason&&this.urgency[speaker]!=='high')this.flag(speaker,'high',reason);
  const turn:Turn={id:randomUUID(),speaker,original_text,translated_text,urgency:this.urgency[speaker],timestamp:new Date().toISOString(),interrupt:this.urgency[speaker]==='high',latency_ms:this.began[speaker]?Date.now()-this.began[speaker]:0,provisional};this.began[speaker]=0;
  this.record.turns.push(turn);this.send({type:'translated_turn',...turn,audio:null});
  console.log(JSON.stringify({event:'translated_turn',sessionId:this.record.sessionId,speaker,latency_ms:turn.latency_ms,urgency:turn.urgency}));
  this.queue=this.queue.then(async()=>{
   try{await this.store.save(this.record,turn);}catch{this.send({type:'error',message:'Transcript could not be saved. Export the transcript before closing.'});}
  });
  const epoch=this.speechEpoch;
  this.speechQueue=this.speechQueue.then(async()=>{
   if(this.pipeline&&process.env.SPEECH_MODE==='tts'&&!this.ended&&epoch===this.speechEpoch)try{const audio=await this.pipeline.tts(translated_text,turn.urgency);if(!this.ended&&epoch===this.speechEpoch)this.send({type:'audio_output',speaker,...audio});}catch{if(!this.ended)this.send({type:'error',message:'Speech synthesis failed; the translated caption is still available.'});}
  });
 }
 end(){
  if(this.ending)return this.ending;
  this.pipeline?.flushPending();
  this.ended=true;this.speechEpoch++;this.pipeline?.close();
  this.ending=this.finish();return this.ending;
 }
 private async finish(){
  await this.initializing?.catch(()=>{});await this.queue;
  this.record.status='ended';this.record.endedAt=new Date().toISOString();
  try{await this.store.save(this.record);}catch{this.send({type:'error',message:'Session could not be saved. Export your local transcript.'});}
  this.send({type:'session_ended',sessionId:this.record.sessionId,turnCount:this.record.turns.length});
 }
}
