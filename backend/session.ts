import { randomUUID } from 'node:crypto';
import { GeminiPipeline } from './gemini.js';
import { phrases,rms,type Speaker,type Urgency,type Turn,type ClientMessage,type Patient } from './protocol.js';
import { SessionStore,type RecordData } from './store.js';
import { analyzeTurn,audit } from './clinical.js';
export class Session {
 record:RecordData;
 private pipeline?:GeminiPipeline;
 private ended=false;
 private queue=Promise.resolve();
 private seq={doctor:-1,patient:-1};
 private urgency:Record<Speaker,Urgency>={doctor:'normal',patient:'normal'};
 private loud={doctor:0,patient:0};
 private lastFlag={doctor:0,patient:0};
 private began={doctor:0,patient:0};
 private store=new SessionStore();
 constructor(language:'hi'|'te',mode:'demo'|'live',patient:Patient,private send:(event:Record<string,unknown>)=>void){this.record={sessionId:randomUUID(),patient,status:'active',startedAt:new Date().toISOString(),languages:{doctor:'en',patient:language},mode,turns:[],facts:[],flags:[],audit:[],reportVersion:0};this.record.audit.push(audit('session_started','system'));}
 async start(){
  await this.store.save(this.record);
  if(this.record.mode==='live'){
   this.pipeline=new GeminiPipeline(this.record.languages.patient,e=>{if(!this.ended)this.send(e);},(s,o,t,p)=>this.commit(s,o,t,!!p),(s,u,source)=>this.flag(s,u,source));
   await this.pipeline.start();
  }
  this.send({type:'session_started',sessionId:this.record.sessionId,mode:this.record.mode,urgencyMode:process.env.URGENCY_MODE||'acoustic',speechMode:process.env.SPEECH_MODE||'native'});
 }
 flag(speaker:Speaker,urgency:Urgency,source='manual'){
  if(this.ended)return;
  this.urgency[speaker]=urgency;this.lastFlag[speaker]=Date.now();
  if(urgency!=='normal'&&(source==='manual'||source==='acoustic'))this.record.flags.push({id:randomUUID(),level:urgency,reason:source==='manual'?'Clinician raised an attention flag':'Elevated vocal intensity',sourceTurnId:'',originalText:'',englishText:'',timestamp:new Date().toISOString(),detectionSource:source==='manual'?'manual':'acoustic',status:'unconfirmed'});
  this.record.audit.push(audit(urgency==='normal'?'attention_cleared':'attention_flag_generated',source));
  this.send({type:'urgency_update',speaker,urgency,source});
  if(urgency==='high'){this.send({type:'interrupt',speaker});this.pipeline?.endAudio(speaker);}
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
   if(process.env.URGENCY_MODE!=='gemini'&&this.loud[message.mic]>0.45&&Date.now()-this.lastFlag[message.mic]>5000&&this.urgency[message.mic]!=='high')this.flag(message.mic,'elevated','acoustic');
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
  const turn:Turn={id:randomUUID(),speaker,original_text,translated_text,urgency:this.urgency[speaker],timestamp:new Date().toISOString(),interrupt:this.urgency[speaker]==='high',latency_ms:this.began[speaker]?Date.now()-this.began[speaker]:0,provisional};this.began[speaker]=0;
  const analysis=analyzeTurn(turn);turn.classification=analysis.classification;this.record.facts.push(...analysis.facts);this.record.flags.push(...analysis.flags);for(const flag of analysis.flags)this.record.audit.push(audit('attention_flag_generated','automatic',flag.id,flag.reason));
  this.record.turns.push(turn);this.send({type:'translated_turn',...turn,audio:null});
  if(analysis.facts.length||analysis.flags.length)this.send({type:'clinical_update',facts:analysis.facts,flags:analysis.flags});
  this.queue=this.queue.then(async()=>{
   try{await this.store.save(this.record,turn);}catch{this.send({type:'error',message:'Transcript could not be saved. Export the transcript before closing.'});}
   if(this.pipeline&&process.env.SPEECH_MODE==='tts'&&!this.ended)try{const audio=await this.pipeline.tts(translated_text,turn.urgency);if(!this.ended)this.send({type:'audio_output',speaker,...audio});}catch{this.send({type:'error',message:'Speech synthesis failed; the translated caption is still available.'});}
  });
 }
 async end(){
  if(this.ended)return;this.ended=true;this.pipeline?.close();await this.queue;
  this.record.status='review';this.record.endedAt=new Date().toISOString();this.record.audit.push(audit('session_ended','system'));
  try{await this.store.save(this.record);}catch{this.send({type:'error',message:'Session could not be saved. Export your local transcript.'});}
  this.send({type:'session_ended',sessionId:this.record.sessionId,turnCount:this.record.turns.length});
 }
}
