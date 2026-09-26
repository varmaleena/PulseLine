import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { GoogleGenAI } from '@google/genai';
// Supply consented PCM16 LE mono, 16kHz recordings, not WAV containers.
const files=process.argv.slice(2);if(!process.env.GEMINI_API_KEY||!files.length)throw new Error('Set GEMINI_API_KEY and pass one or more 16kHz mono PCM16 .pcm files');
const ai=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});
for(const file of files){
 const audio=await readFile(file);if(audio.length%2||audio.length>32000*60)throw new Error('Expected at most 60 seconds of PCM16');
 let result:unknown;const start=Date.now();let resolveResponse:()=>void=()=>{};const received=new Promise<void>(r=>resolveResponse=r);
 const session=await ai.live.connect({model:process.env.URGENCY_MODEL||'gemini-3.8-live',config:{responseModalities:['AUDIO'] as any,systemInstruction:'Listen to the supplied recording. Call flag_attention with vocal attention level normal, elevated, or high. Do not diagnose.',tools:[{functionDeclarations:[{name:'flag_attention',description:'Report vocal attention',parameters:{type:'OBJECT' as any,properties:{urgency:{type:'STRING' as any,enum:['normal','elevated','high']}},required:['urgency']}}]}]},callbacks:{onmessage:m=>{const call=m.toolCall?.functionCalls?.find(c=>c.name==='flag_attention');if(call){result={classification:call.args,latency_ms:Date.now()-start};resolveResponse();}},onerror:()=>resolveResponse()}});
 try{for(let offset=0;offset<audio.length&&!result;offset+=3200){session.sendRealtimeInput({audio:{data:audio.subarray(offset,offset+3200).toString('base64'),mimeType:'audio/pcm;rate=16000'}});await new Promise(r=>setTimeout(r,100));}session.sendRealtimeInput({audioStreamEnd:true});await Promise.race([received,new Promise(r=>setTimeout(r,8000))]);console.log(JSON.stringify({file,...(result as object||{classification:null,error:'No classification within timeout'})}));}finally{session.close();}
}
