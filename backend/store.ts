import { mkdir,writeFile,rename,readFile,readdir,unlink } from 'node:fs/promises';
import { resolve,basename } from 'node:path';
import { Firestore } from '@google-cloud/firestore';
import type { Patient,Turn } from './protocol.js';
import type { AttentionFlag,AuditEntry,ClinicalFact } from './clinical.js';
import { audit } from './clinical.js';

export interface RecordData {sessionId:string;patient:Patient;status:'active'|'review'|'ended';startedAt:string;endedAt?:string;languages:{doctor:'en';patient:'hi'|'te'};mode:string;turns:Turn[];facts:ClinicalFact[];flags:AttentionFlag[];audit:AuditEntry[];reviewedBy?:string;reviewedAt?:string;reportVersion:number}
export type RecordSummary=Pick<RecordData,'sessionId'|'status'|'startedAt'|'endedAt'|'mode'|'patient'|'reviewedBy'|'reviewedAt'|'reportVersion'> & {turnCount:number;factCount:number;flagCount:number};

export class SessionStore {
 private db = process.env.STORE==='firestore'?new Firestore():null;
 private dir=resolve(process.env.DATA_DIR||'data');
 private file(id:string){return resolve(this.dir,id+'.json');}
 async save(record:RecordData,turn?:Turn){
  if(this.db){const {turns,facts,flags,audit,...metadata}=record;const ref=this.db.collection('sessions').doc(record.sessionId);const batch=this.db.batch();batch.set(ref,{...metadata,turnCount:turns.length,factCount:facts.length,flagCount:flags.length},{merge:true});if(turn)batch.set(ref.collection('turns').doc(turn.id),turn);batch.set(ref.collection('clinical').doc('review'),{facts,flags,audit},{merge:true});await batch.commit();}
  else {await mkdir(this.dir,{recursive:true});const file=this.file(record.sessionId);await writeFile(file+'.tmp',JSON.stringify(record,null,2));await rename(file+'.tmp',file);}
 }
 async get(id:string):Promise<RecordData|undefined>{
  if(!/^[a-f0-9-]{36}$/i.test(id))return;
  if(this.db){const ref=this.db.collection('sessions').doc(id),snap=await ref.get();if(!snap.exists)return;const turns=await ref.collection('turns').get(),clinical=await ref.collection('clinical').doc('review').get();return {...snap.data(),turns:turns.docs.map(d=>d.data()),facts:clinical.data()?.facts||[],flags:clinical.data()?.flags||[],audit:clinical.data()?.audit||[]} as RecordData;}
  try{return JSON.parse(await readFile(this.file(id),'utf8'));}catch{return;}
 }
 async list(patientId?:string):Promise<RecordSummary[]>{
  if(this.db){let q:any=this.db.collection('sessions').orderBy('startedAt','desc').limit(100);if(patientId)q=q.where('patient.patientId','==',patientId);const s=await q.get();return s.docs.map((d:any)=>d.data() as RecordSummary);}
  await mkdir(this.dir,{recursive:true});const files=(await readdir(this.dir)).filter(f=>/^[a-f0-9-]{36}\.json$/i.test(f));const records=(await Promise.all(files.map(f=>this.get(basename(f,'.json'))))).filter(Boolean) as RecordData[];
  return records.filter(r=>r.patient&&(!patientId||r.patient.patientId===patientId)).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,100).map(r=>({...r,turnCount:r.turns.length,factCount:r.facts?.length||0,flagCount:r.flags?.length||0}));
 }
 async review(id:string,input:{reviewedBy:string;facts?:ClinicalFact[];flags?:AttentionFlag[]}):Promise<RecordData|undefined>{const record=await this.get(id);if(!record)return;const oldFacts=new Map(record.facts.map(f=>[f.id,f]));for(const f of input.facts||[])if(!oldFacts.has(f.id))record.audit.push(audit('clinical_item_added',input.reviewedBy,f.id));else if(oldFacts.get(f.id)!.value!==f.value||oldFacts.get(f.id)!.status!==f.status)record.audit.push(audit('clinical_item_edited',input.reviewedBy,f.id));const oldFlags=new Map(record.flags.map(f=>[f.id,f]));for(const f of input.flags||[])if(oldFlags.get(f.id)?.status!==f.status)record.audit.push(audit(f.status==='dismissed'?'attention_flag_dismissed':'attention_flag_reviewed',input.reviewedBy,f.id));record.facts=input.facts||record.facts;record.flags=input.flags||record.flags;record.reviewedBy=input.reviewedBy;record.reviewedAt=new Date().toISOString();record.status='ended';record.reportVersion=(record.reportVersion||0)+1;record.audit.push(audit('clinical_review_completed',input.reviewedBy,undefined,`Report version ${record.reportVersion}`));await this.save(record);return record;}
 async delete(id:string){if(this.db){await this.db.recursiveDelete(this.db.collection('sessions').doc(id));return;}await unlink(this.file(id));}
 async prune(){const days=Number(process.env.RETENTION_DAYS||30);if(!Number.isFinite(days)||days<=0||this.db)return;const cutoff=Date.now()-days*86400000;for(const r of await this.list())if(Date.parse(r.startedAt)<cutoff)try{await this.delete(r.sessionId);}catch{}}
}

const esc=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[^\x20-\x7e]/g,'?');
export function makePdf(title:string,record:RecordData,sections:{heading:string;lines:string[]}[]):Buffer{
 const lines=[title,'PULSELINE HOSPITAL INTERPRETATION','CONFIDENTIAL - RESEARCH PROTOTYPE',`Report ID: ${record.sessionId}`,`Generated: ${new Date().toISOString()}`,`Patient: ${record.patient.fullName} (${record.patient.patientId})`,`Language: ${record.patient.language==='hi'?'Hindi':'Telugu'} | Department: ${record.patient.doctorDepartment}`,`Clinician review: ${record.reviewedBy?`Reviewed by ${record.reviewedBy}`:'UNCONFIRMED'}`,'',...sections.flatMap(s=>[s.heading.toUpperCase(),...s.lines.map(l=>'  '+l),''])];
 const wrapped=lines.flatMap(line=>{const chunks:string[]=[];for(let i=0;i<Math.max(1,line.length);i+=92)chunks.push(line.slice(i,i+92));return chunks;}),pages:Array<string[]>=[];for(let i=0;i<wrapped.length;i+=48)pages.push(wrapped.slice(i,i+48));if(!pages.length)pages.push([]);
 const pageRefs=pages.map((_,i)=>3+i),contentRefs=pages.map((_,i)=>3+pages.length+i),fontRef=3+pages.length*2;
 const objects=[`<< /Type /Catalog /Pages 2 0 R >>`,`<< /Type /Pages /Kids [${pageRefs.map(r=>r+' 0 R').join(' ')}] /Count ${pages.length} >>`];
 pages.forEach((_,i)=>objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${contentRefs[i]} 0 R >>`));
 pages.forEach((page,i)=>{const display=[...page,'',`Page ${i+1} of ${pages.length}`],stream=`BT /F1 10 Tf 45 805 Td ${display.map((l,j)=>`${j?'0 -13 Td ':''}(${esc(l)}) Tj`).join(' ')} ET`;objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);});objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
 let out='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=Buffer.byteLength(out);out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer << /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(out);
}

export function reportSections(kind:string,r:RecordData){
 const confirmed=r.facts.filter(f=>f.status==='confirmed'),by=(c:string)=>confirmed.filter(f=>f.category===c).map(f=>`${f.value} [source ${f.sourceTurnId.slice(0,8)}]`),flags=r.flags.filter(f=>f.status==='confirmed').map(f=>`${f.reason}: ${f.englishText}`);
 if(kind==='patient')return [{heading:'Visit',lines:[r.patient.reasonForVisit]},{heading:'What you told the doctor',lines:by('symptom').concat(by('onset'))},{heading:'Medicines',lines:by('medication')},{heading:'Tests and scans',lines:by('investigation')},{heading:'Follow-up instructions',lines:by('followup')},{heading:'Warning signs discussed',lines:flags},{heading:'Important',lines:['Follow the final instructions given by your clinician. Seek urgent care if symptoms worsen.']}];
 if(kind==='transcript')return [{heading:'Bilingual transcript',lines:r.turns.flatMap(t=>[`${t.speaker.toUpperCase()} ${new Date(t.timestamp).toLocaleString('en-IN')}: ${t.original_text}`,`English/translation: ${t.translated_text}`])}];
 return [{heading:'Encounter',lines:[`Chief complaint: ${r.patient.reasonForVisit}`,`Interpretation: English <-> ${r.patient.language==='hi'?'Hindi':'Telugu'} (${r.mode})`]},{heading:'History and symptoms',lines:by('symptom').concat(by('onset'),by('history'))},{heading:'Allergies and current medication',lines:[r.patient.allergies||'Not recorded',r.patient.medications||'Not recorded']},{heading:'Key negative findings',lines:by('negative')},{heading:'Attention items',lines:flags},{heading:'Medication orders',lines:by('medication')},{heading:'Investigations and imaging',lines:by('investigation')},{heading:'Procedures, referrals and disposition',lines:by('procedure')},{heading:'Follow-up',lines:by('followup')},{heading:'Unresolved information',lines:r.facts.filter(f=>f.status!=='confirmed'&&f.status!=='dismissed').map(f=>f.value)},{heading:'Full bilingual transcript appendix',lines:r.turns.flatMap(t=>[`${t.speaker}: ${t.original_text}`,`Translation: ${t.translated_text}`])}];
}
