import { WebSocket } from 'ws';
// Direct documented Live wire protocol: the published SDK currently rejects
// languageCodes and drops translationConfig. Do not silently lose those settings.
export interface LiveStream {sendRealtimeInput:(data:unknown)=>void;sendToolResponse:(data:unknown)=>void;close:()=>void}
export function liveSetup(model:string,config:Record<string,any>):Record<string,any>{
 const {responseModalities,...rest}=config;
 if(model.includes('live-translate')){
  const {translationConfig,...transcription}=rest;
  return {model:'models/'+model,generationConfig:{responseModalities,translationConfig},...transcription};
 }
 if(typeof rest.systemInstruction==='string')rest.systemInstruction={parts:[{text:rest.systemInstruction}]};
 return {model:'models/'+model,generationConfig:{responseModalities},...rest};
}
export async function connectLive(model:string,config:Record<string,any>,callbacks:{message:(m:any)=>void;error:()=>void;close:()=>void},endpoint?:string):Promise<LiveStream>{
 const url=endpoint||'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
 const ws=new WebSocket(url,{headers:{'x-goog-api-key':process.env.GEMINI_API_KEY||''},maxPayload:8*1024*1024});
 let ready=false,closed=false;
 const safeReason=(reason:string)=>reason.split(process.env.GEMINI_API_KEY||'__no_key__').join('[redacted]').slice(0,600);
 const send=(data:unknown)=>{if(ws.readyState!==WebSocket.OPEN)throw new Error('Provider disconnected');if(ws.bufferedAmount>512000)throw new Error('Provider connection is too slow');ws.send(JSON.stringify(data));};
 await new Promise<void>((resolve,reject)=>{
  const timeout=setTimeout(()=>{ws.terminate();reject(new Error('Provider setup timed out'));},15000);
  ws.on('open',()=>send({setup:liveSetup(model,config)}));
  ws.on('message',raw=>{
   try{const m=JSON.parse(raw.toString());if(m.setupComplete){ready=true;clearTimeout(timeout);resolve();}else if(m.error){if(!ready){clearTimeout(timeout);reject(new Error('Provider rejected setup'));ws.close();}else callbacks.error();}else callbacks.message(m);}
   catch{callbacks.error();}
  });
  ws.on('error',()=>{clearTimeout(timeout);if(!ready)reject(new Error('Provider connection failed'));else callbacks.error();});
  ws.on('close',(code,reason)=>{clearTimeout(timeout);if(!ready)reject(new Error(`Provider closed during setup (${code}): ${safeReason(reason.toString())}`));if(!closed)callbacks.close();});
 });
 return {sendRealtimeInput:data=>send({realtimeInput:data}),sendToolResponse:data=>send({toolResponse:data}),close:()=>{closed=true;ws.close();}};
}
