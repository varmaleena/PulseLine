import { mkdir,writeFile,rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Firestore } from '@google-cloud/firestore';
import type { Turn } from './protocol.js';
export interface RecordData {sessionId:string;status:'active'|'ended';startedAt:string;endedAt?:string;languages:{doctor:'en';patient:'hi'|'te'};mode:string;turns:Turn[]}
export class SessionStore {
 private db = process.env.STORE==='firestore'?new Firestore():null;
 private dir=resolve(process.env.DATA_DIR||'data');
 async save(record:RecordData,turn?:Turn){
  if(this.db){const {turns,...metadata}=record;const ref=this.db.collection('sessions').doc(record.sessionId);const batch=this.db.batch();batch.set(ref,{...metadata,turnCount:turns.length},{merge:true});if(turn)batch.set(ref.collection('turns').doc(turn.id),turn);await batch.commit();}
  else {await mkdir(this.dir,{recursive:true});const file=resolve(this.dir,record.sessionId+'.json');await writeFile(file+'.tmp',JSON.stringify(record,null,2));await rename(file+'.tmp',file);}
 }
}
