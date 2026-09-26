export class Capture {
 private stream?:MediaStream;private context?:AudioContext;private node?:AudioWorkletNode;
 async start(deviceId:string,onChunk:(data:string,level:number)=>void){
  try{
   this.stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:deviceId?{exact:deviceId}:undefined,channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:false}});
   this.context=new AudioContext();await this.context.audioWorklet.addModule('/pcm-worklet.js');await this.context.resume();
   this.node=new AudioWorkletNode(this.context,'pcm-capture');
   this.node.port.onmessage=e=>{const bytes=new Uint8Array(e.data),pcm=new Int16Array(e.data);let sum=0;for(const value of pcm)sum+=(value/32768)**2;let binary='';for(const b of bytes)binary+=String.fromCharCode(b);onChunk(btoa(binary),Math.sqrt(sum/pcm.length));};
   const source=this.context.createMediaStreamSource(this.stream);const mute=this.context.createGain();mute.gain.value=0;source.connect(this.node);this.node.connect(mute);mute.connect(this.context.destination);
  }catch(error){this.stop();throw error;}
 }
 stop(){this.node?.disconnect();this.node?.port.close();this.stream?.getTracks().forEach(t=>t.stop());void this.context?.close();this.context=undefined;}
}
export class Playback {
 private context?:AudioContext;private next=0;private sources=new Set<AudioBufferSourceNode>();private generation=0;
 async unlock(){this.context??=new AudioContext();await this.context.resume();}
 async sink(id:string){await this.unlock();const context=this.context as AudioContext&{setSinkId?:(id:string)=>Promise<void>};if(context.setSinkId)await context.setSinkId(id);else if(id)throw new Error('This browser does not support audio output selection');}
 async play(data:string,mime:string){
  const generation=this.generation;await this.unlock();const ctx=this.context!;const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));let buffer:AudioBuffer;
  if(mime.includes('pcm')){const rate=Number(mime.match(/rate=(\d+)/)?.[1]||24000);buffer=ctx.createBuffer(1,Math.floor(bytes.length/2),rate);const view=new DataView(bytes.buffer),channel=buffer.getChannelData(0);for(let i=0;i<channel.length;i++)channel[i]=view.getInt16(i*2,true)/32768;}
  else buffer=await ctx.decodeAudioData(bytes.buffer);
  if(generation!==this.generation)return;
  const source=ctx.createBufferSource();source.buffer=buffer;source.connect(ctx.destination);const start=Math.max(ctx.currentTime+.02,this.next);this.next=start+buffer.duration;this.sources.add(source);source.onended=()=>this.sources.delete(source);source.start(start);
 }
 stop(){this.generation++;for(const source of this.sources)try{source.stop();}catch{}this.sources.clear();this.next=0;}
}
