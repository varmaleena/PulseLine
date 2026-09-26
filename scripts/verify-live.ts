import 'dotenv/config';
import { GeminiPipeline } from '../backend/gemini.js';

// Account-access smoke test only. Real recordings are still needed to establish
// interpretation quality, interruption behavior, pronunciation, and latency.
if(!process.env.GEMINI_API_KEY){
 console.error('Set GEMINI_API_KEY in your local .env, then rerun npm run verify:live. Never paste the key into chat.');
 process.exitCode=1;
}else{
 for(const language of ['hi','te'] as const){
  const began=Date.now();let failed=false;
  const pipeline=new GeminiPipeline(language,event=>{
   if(event.type==='error'||event.type==='provider_unavailable')failed=true;
  },()=>{},()=>{});
  try{
   await pipeline.start();
   if(failed)throw new Error('Provider stream failed');
   if(process.argv.includes('--tts')){
    const audio=await pipeline.tts(language==='hi'?'नमस्ते':'నమస్కారం','normal');
    if(!audio.audio)throw new Error('No speech returned');
   }
   console.log(JSON.stringify({language,streamSetup:'passed',tts:process.argv.includes('--tts')?'passed':'not tested',setup_ms:Date.now()-began}));
  }catch(error){
   process.exitCode=1;
   const detail=error instanceof Error?error.message:'Unknown provider error';
   console.error(JSON.stringify({language,status:'failed',message:detail.split(process.env.GEMINI_API_KEY).join('[redacted]')}));
  }finally{pipeline.close();}
 }
}
