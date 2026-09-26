import { randomUUID } from 'node:crypto';
import type { Speaker,Turn } from './protocol.js';

export type ReviewStatus='unconfirmed'|'confirmed'|'uncertain'|'dismissed';
export interface ClinicalFact {id:string;category:string;label:string;value:string;sourceTurnId:string;sourceText:string;source:'automatic'|'manual';status:ReviewStatus;createdAt:string;updatedAt:string}
export interface AttentionFlag {id:string;level:'elevated'|'high'|'critical';reason:string;sourceTurnId:string;originalText:string;englishText:string;timestamp:string;detectionSource:'explicit-language'|'manual'|'acoustic';status:ReviewStatus}
export interface AuditEntry {id:string;action:string;timestamp:string;actor:string;targetId?:string;details?:string}

const now=()=>new Date().toISOString();
const fact=(turn:Turn,category:string,label:string,value:string):ClinicalFact=>({id:randomUUID(),category,label,value,sourceTurnId:turn.id,sourceText:turn.original_text,source:'automatic',status:'unconfirmed',createdAt:now(),updatedAt:now()});
const has=(text:string,words:RegExp)=>words.test(text.toLowerCase());
const negative=(text:string)=>/\b(no|not|never|without|denies|don't|doesn't|do not|नहीं|లేదు|కాదు)\b/i.test(text);
const question=(text:string)=>/\?$|\b(do you|did you|are you|have you|where|when|what|can you|क्या|ఉందా|ఎప్పుడు)\b/i.test(text);

export function classifyTurn(turn:Turn):string{
 const text=(turn.speaker==='patient'?turn.translated_text:turn.original_text).toLowerCase();
 if(turn.speaker==='patient')return detectAttention(text)&&!negative(text)&&!question(text)?'Attention item':'Patient statement';
 if(/[?]$|\b(can you|do you|did you|are you|when|where|what|how)\b/.test(text))return 'Doctor question';
 if(/\b(mg|tablet|capsule|medicine|medication|paracetamol|ibuprofen|antibiotic|prescribe|take)\b/.test(text))return 'Medication';
 if(/\b(scan|x-ray|xray|mri|ct|ultrasound|blood test|laboratory|lab test|investigation)\b/.test(text))return 'Investigation or scan';
 if(/\b(follow.?up|return|come back|review in)\b/.test(text))return 'Follow-up';
 return 'Doctor instruction';
}

function detectAttention(text:string):{level:'high'|'critical';reason:string}|undefined{
 const rules:[RegExp,'high'|'critical',string][]=[
  [/\b(can't breathe|cannot breathe|difficulty breathing|shortness of breath|struggling to breathe)\b/i,'critical','Difficulty breathing'],
  [/\b(severe chest pain|crushing chest pain)\b/i,'critical','Severe chest pain'],
  [/\b(unconscious|loss of consciousness|passed out)\b/i,'critical','Loss of consciousness'],
  [/\b(heavy bleeding|bleeding heavily|won't stop bleeding)\b/i,'critical','Heavy bleeding'],
  [/\b(seizure|convulsion)\b/i,'critical','Seizure'],
  [/\b(face droop|slurred speech|one.side weakness|stroke)\b/i,'critical','Stroke-like symptoms'],
  [/\b(anaphylaxis|severe allergic|throat.*(closing|swelling))\b/i,'critical','Severe allergic reaction'],
  [/\b(suicid|kill myself|self.harm|hurt myself)\b/i,'critical','Self-harm statement'],
  [/\b(getting worse quickly|sudden deterioration|suddenly much worse)\b/i,'high','Sudden severe deterioration'],
  [/\b(chest pain|hard to breathe|breathless)\b/i,'high','Potential urgent symptom']
 ];
 for(const [pattern,level,reason] of rules)if(pattern.test(text))return {level,reason};
}

export function analyzeTurn(turn:Turn):{classification:string;facts:ClinicalFact[];flags:AttentionFlag[]}{
 const text=turn.speaker==='patient'?turn.translated_text:turn.original_text;
 const facts:ClinicalFact[]=[];const flags:AttentionFlag[]=[];const isNegative=negative(text);const isQuestion=question(text);
 if(turn.speaker==='patient'){
  if(isNegative)facts.push(fact(turn,'negative','Important negative finding',text));
  else if(!isQuestion){
   if(has(text,/\b(pain|ache|fever|cough|nausea|vomit|dizz|breath|bleed|weak|swelling)\b/))facts.push(fact(turn,'symptom','Symptom',text));
   if(has(text,/\b(today|yesterday|hour|day|week|month|started|since|sudden|gradual)\b/))facts.push(fact(turn,'onset','Onset or duration',text));
   if(has(text,/\b(allerg|reaction)\b/))facts.push(fact(turn,'allergy','Allergy statement',text));
   if(has(text,/\b(worried|concerned|afraid|scared)\b/))facts.push(fact(turn,'concern','Patient concern',text));
   const urgent=detectAttention(text);if(urgent)flags.push({id:randomUUID(),level:urgent.level,reason:urgent.reason,sourceTurnId:turn.id,originalText:turn.original_text,englishText:turn.translated_text,timestamp:turn.timestamp,detectionSource:'explicit-language',status:'unconfirmed'});
  }
 }else{
  const med=/\b(paracetamol|acetaminophen|ibuprofen|aspirin|amoxicillin|antibiotic|medicine|medication|tablet|capsule)\b/i.exec(text);
  if(med){const dose=/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml)\b/i.exec(text)?.[0];facts.push(fact(turn,'medication','Medication',dose?`${med[0]} — ${dose}`:`${med[0]} — dosage not captured; clinician review required`));}
  if(has(text,/\b(scan|x-ray|xray|mri|ct|ultrasound|blood test|laboratory|lab test)\b/))facts.push(fact(turn,'investigation','Investigation or scan',text));
  if(has(text,/\b(refer|procedure|operation|surgery|admit|discharge)\b/))facts.push(fact(turn,'procedure','Procedure, referral or disposition',text));
  if(has(text,/\b(follow.?up|return|come back|review in|seek urgent|emergency)\b/))facts.push(fact(turn,'followup','Follow-up or precaution',text));
 }
 return {classification:classifyTurn(turn),facts,flags};
}

export function audit(action:string,actor='system',targetId?:string,details?:string):AuditEntry{return {id:randomUUID(),action,timestamp:now(),actor,targetId,details};}
