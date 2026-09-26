import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer,WebSocket } from 'ws';
import { Session } from './session.js';
import { messageSchema } from './protocol.js';
import { SessionStore,makePdf,reportSections } from './store.js';
import { z } from 'zod';
import { audit } from './clinical.js';
export function createGateway(){
 const app=express();app.disable('x-powered-by');
 app.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','microphone=(self)');next();});
 app.use(express.json({limit:'1mb'}));
 const store=new SessionStore();void store.prune();
 const apiAuth=(req:express.Request,res:express.Response,next:express.NextFunction)=>{const expected=process.env.STAFF_PIN;if(expected&&req.headers['x-staff-pin']!==expected){res.status(401).json({error:'Staff authentication required'});return;}next();};
 app.get('/api/config',(_req,res)=>res.json({liveAvailable:!!process.env.GEMINI_API_KEY,pinRequired:!!process.env.STAFF_PIN,storage:process.env.STORE||'local',urgencyMode:process.env.URGENCY_MODE||'acoustic',retentionDays:Number(process.env.RETENTION_DAYS||30)}));
 app.get('/api/health',(_req,res)=>res.json({status:'ok',activeSessions:sessions.size}));
 app.get('/api/encounters',apiAuth,async(req,res)=>{try{res.json(await store.list(typeof req.query.patientId==='string'?req.query.patientId:undefined));}catch{res.status(500).json({error:'Could not load encounter history'});}});
 app.get('/api/encounters/:id',apiAuth,async(req,res)=>{const record=await store.get(req.params.id);if(!record){res.status(404).json({error:'Encounter not found'});return;}res.json(record);});
 const reviewSchema=z.object({reviewedBy:z.string().trim().min(2).max(100),facts:z.array(z.object({id:z.string(),category:z.string(),label:z.string(),value:z.string().max(2000),sourceTurnId:z.string(),sourceText:z.string(),source:z.enum(['automatic','manual']),status:z.enum(['unconfirmed','confirmed','uncertain','dismissed']),createdAt:z.string(),updatedAt:z.string()})).max(200),flags:z.array(z.object({id:z.string(),level:z.enum(['elevated','high','critical']),reason:z.string(),sourceTurnId:z.string(),originalText:z.string(),englishText:z.string(),timestamp:z.string(),detectionSource:z.enum(['explicit-language','manual','acoustic']),status:z.enum(['unconfirmed','confirmed','uncertain','dismissed'])})).max(100)});
 app.put('/api/encounters/:id/review',apiAuth,async(req,res)=>{const parsed=reviewSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Invalid review data'});return;}const record=await store.review(req.params.id,parsed.data);if(!record){res.status(404).json({error:'Encounter not found'});return;}res.json(record);});
 app.delete('/api/encounters/:id',apiAuth,async(req,res)=>{try{const record=await store.get(req.params.id);if(!record){res.status(404).json({error:'Encounter not found'});return;}await store.delete(req.params.id);res.status(204).end();}catch{res.status(500).json({error:'Could not delete encounter'});}});
 app.get('/api/encounters/:id/reports/:kind',apiAuth,async(req,res)=>{const kind=req.params.kind;if(!['patient','clinical','transcript','json'].includes(kind)){res.status(404).json({error:'Unknown report'});return;}const record=await store.get(req.params.id);if(!record){res.status(404).json({error:'Encounter not found'});return;}record.audit.push(audit('report_generated',record.reviewedBy||'staff',undefined,`${kind} report version ${record.reportVersion}`));await store.save(record);const safe=record.patient.patientId.replace(/[^a-z0-9_-]/gi,'_');if(kind==='json'){res.setHeader('Content-Disposition',`attachment; filename="Structured_${safe}.json"`);res.json(record);return;}const names:any={patient:`Patient_Summary_${safe}.pdf`,clinical:`Clinical_Handoff_${safe}.pdf`,transcript:`Bilingual_Transcript_${safe}.pdf`};const titles:any={patient:'PATIENT VISIT SUMMARY',clinical:'CLINICAL HANDOFF REPORT',transcript:'BILINGUAL TRANSCRIPT'};res.type('application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${names[kind]}"`);res.send(makePdf(titles[kind],record,reportSections(kind,record)));});
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
  const send=(event:Record<string,unknown>)=>{if(ws.readyState===WebSocket.OPEN){if(ws.bufferedAmount>2_000_000){ws.close(1013,'Slow connection');return;}ws.send(JSON.stringify(event));}};
  const handshake=setTimeout(()=>{if(!session)ws.close(1008,'Handshake timeout');},15000);
  const lifetime=setTimeout(()=>ws.close(1000,'Session time limit; start a new session'),50*60*1000);
  const heartbeat=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();},30000);ws.on('pong',()=>alive=true);
  ws.on('message',async(raw,binary)=>{
   try{
    if(Date.now()-windowStart>1000){windowStart=Date.now();count=0;}if(++count>60){ws.close(1008,'Rate limit');return;}
    if(binary)throw new Error('JSON messages required');
    const parsed=messageSchema.safeParse(JSON.parse(raw.toString()));if(!parsed.success){const fields=[...new Set(parsed.error.issues.map(issue=>issue.path.length?issue.path.join('.'):'message'))].slice(0,4);throw new Error(`Invalid message field${fields.length===1?'':'s'}: ${fields.join(', ')}`);}const message=parsed.data;
    if(message.type==='session_start'){
     if(session||starting||ended)throw new Error('Session already started');
     const expected=process.env.STAFF_PIN;if(expected){const a=Buffer.from(expected),b=Buffer.from(message.pin||'');if(a.length!==b.length||!timingSafeEqual(a,b)){ws.close(1008,'Invalid staff PIN');return;}}
     if(message.mode==='live'&&!process.env.GEMINI_API_KEY)throw new Error('Live mode needs GEMINI_API_KEY on the server');
     starting=true;clearTimeout(handshake);session=new Session(message.patientLanguage,message.mode,message.patient,send);sessions.add(session);
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
