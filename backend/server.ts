import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer,WebSocket } from 'ws';
import { Session } from './session.js';
import { messageSchema } from './protocol.js';
export function createGateway(){
 const app=express();app.disable('x-powered-by');
 app.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','microphone=(self)');next();});
 app.get('/api/config',(_req,res)=>res.json({liveAvailable:!!process.env.GEMINI_API_KEY,pinRequired:!!process.env.STAFF_PIN,storage:process.env.STORE||'local',urgencyMode:process.env.URGENCY_MODE||'acoustic'}));
 app.get('/api/health',(_req,res)=>res.json({status:'ok',activeSessions:sessions.size}));
 const staticRoot=resolve(fileURLToPath(new URL('../client/',import.meta.url)));
 app.use(express.static(staticRoot));
 const server=createServer(app);const wss=new WebSocketServer({noServer:true,maxPayload:32000});const sessions=new Set<Session>();
 server.on('upgrade',(req,socket,head)=>{
  const origin=req.headers.origin;const allowed=(process.env.ALLOWED_ORIGINS||'http://localhost:8080,http://localhost:5173,http://127.0.0.1:8080').split(',');
  if(req.url!=='/ws'||(origin&&!allowed.includes(origin))||wss.clients.size>=Number(process.env.MAX_SESSIONS||20)){socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
 });
 wss.on('connection',ws=>{
  let session:Session|undefined;let starting=false;let ended=false;let alive=true;let windowStart=Date.now(),count=0;
  const send=(event:Record<string,unknown>)=>{if(ws.readyState===WebSocket.OPEN){if(ws.bufferedAmount>2_000_000){ws.close(1013,'Slow connection');return;}ws.send(JSON.stringify(event));if(event.type==='provider_unavailable')ws.close(1011,'Live provider disconnected');}};
  const handshake=setTimeout(()=>{if(!session)ws.close(1008,'Handshake timeout');},15000);
  const lifetime=setTimeout(()=>ws.close(1000,'Session time limit; start a new session'),50*60*1000);
  const heartbeat=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();},30000);ws.on('pong',()=>alive=true);
  ws.on('message',async(raw,binary)=>{
   try{
    if(Date.now()-windowStart>1000){windowStart=Date.now();count=0;}if(++count>60){ws.close(1008,'Rate limit');return;}
    if(binary)throw new Error('JSON messages required');
    const parsed=messageSchema.safeParse(JSON.parse(raw.toString()));if(!parsed.success)throw new Error('Invalid message');const message=parsed.data;
    if(message.type==='session_start'){
     if(session||starting||ended)throw new Error('Session already started');
     const expected=process.env.STAFF_PIN;if(expected){const a=Buffer.from(expected),b=Buffer.from(message.pin||'');if(a.length!==b.length||!timingSafeEqual(a,b)){ws.close(1008,'Invalid staff PIN');return;}}
     if(message.mode==='live'&&!process.env.GEMINI_API_KEY)throw new Error('Live mode needs GEMINI_API_KEY on the server');
     starting=true;clearTimeout(handshake);session=new Session(message.patientLanguage,message.mode,send);sessions.add(session);
     try{await session.start();}catch{await session.end();sessions.delete(session);ws.close(1011,'Provider connection failed');}finally{starting=false;if(ws.readyState!==WebSocket.OPEN)await session.end();}
    }else{
     if(!session||starting||ended)throw new Error('Start a session first');
     if(message.type==='session_end'){ended=true;await session.end();sessions.delete(session);ws.close(1000,'Session ended');}
     else await session.handle(message);
    }
   }catch(error){send({type:'error',message:error instanceof SyntaxError?'Invalid JSON':error instanceof Error?error.message:'Request failed'});}
  });
  ws.on('error',()=>{});
  ws.on('close',()=>{clearTimeout(handshake);clearTimeout(lifetime);clearInterval(heartbeat);if(session){sessions.delete(session);void session.end();}});
 });
 async function close(){for(const ws of wss.clients)ws.close(1001,'Server restarting');await Promise.all([...sessions].map(s=>s.end()));wss.close();await new Promise<void>(r=>server.close(()=>r()));}
 return {server,close};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const gateway=createGateway();gateway.server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log(JSON.stringify({event:'gateway_ready',port:Number(process.env.PORT||8080)})));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{void gateway.close().then(()=>process.exit(0));});
}
