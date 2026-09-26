import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../backend/session.js';
const patient={name:'Asha Rao',patientId:'P-1001',age:'42',gender:'Female',phone:'',emergencyContact:'',allergies:'None known',conditions:'',currentMedications:'',reasonForVisit:'Chest pain',department:'Emergency department',room:'ER-4',consent:true as const};

test('sustained loud input automatically raises attention without a manual flag',async()=>{
 const events:any[]=[];const session=new Session('hi','live',patient,e=>events.push(e));
 const audio=Buffer.alloc(3200);for(let i=0;i<audio.length;i+=2)audio.writeInt16LE(12000,i);
 for(let seq=0;seq<5;seq++)await session.handle({type:'audio_chunk',mic:'patient',seq,data:audio.toString('base64')});
 assert.ok(events.some(e=>e.type==='urgency_update'&&e.urgency==='elevated'));
 assert.equal(events.some(e=>e.urgency==='high'),false);
 assert.ok(events.some(e=>e.type==='audio_received'));
});

test('disconnect during initial persistence never announces an active session and end is awaitable',async()=>{
 process.env.STORE='local';process.env.DATA_DIR=await mkdtemp(join(tmpdir(),'pulseline-lifecycle-'));
 const events:any[]=[];const session=new Session('hi','demo',patient,e=>events.push(e));
 const start=session.start();const first=session.end();const second=session.end();
 assert.equal(first,second);await Promise.all([start,first,second]);
 assert.equal(events.some(e=>e.type==='session_started'),false);
 assert.equal(events.filter(e=>e.type==='session_ended').length,1);
 const saved=JSON.parse(await readFile(join(process.env.DATA_DIR,session.record.sessionId+'.json'),'utf8'));
 assert.equal(saved.status,'ended');
});
