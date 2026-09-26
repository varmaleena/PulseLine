class PCMCapture extends AudioWorkletProcessor {
 constructor(){super();this.samples=[];this.position=0;this.chunk=[];}
 process(inputs){
  const input=inputs[0]?.[0];if(!input)return true;
  for(const sample of input)this.samples.push(sample);
  const ratio=sampleRate/16000;
  while(this.position+1<this.samples.length){const i=Math.floor(this.position),f=this.position-i;const value=this.samples[i]*(1-f)+this.samples[i+1]*f;this.chunk.push(Math.round(Math.max(-1,Math.min(1,value))*32767));this.position+=ratio;
   if(this.chunk.length===1600){const pcm=new Int16Array(this.chunk);this.port.postMessage(pcm.buffer,[pcm.buffer]);this.chunk=[];}
  }
  const consumed=Math.floor(this.position);this.samples.splice(0,consumed);this.position-=consumed;return true;
 }
}
registerProcessor('pcm-capture',PCMCapture);
