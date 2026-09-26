import { randomUUID } from 'node:crypto';
import type { ClinicalItem,ClinicalSummary,Turn } from './protocol.js';

const symptomTerms=/\b(pain|hurt|ache|breath|breathing|dizzy|dizziness|faint|fever|vomit|nausea|bleed|bleeding|seizure|weak|numb|allerg|swelling|headache|cough|diarrhea)\b/i;
const emergencyTerms=/\b(can(?:not|'t) breathe|difficulty breathing|trouble breathing|hard for me to breathe|chest pain|heavy bleeding|seizure|passed out|unconscious|face droop|slurred speech|suicid|kill myself|severe allergic|anaphyl)\b/i;
const medicationTerms=/\b(prescrib|take|start|give|administer|continue|stop|tablet|capsule|mg\b|ml\b|dose|medicine|medication|antibiotic|paracetamol|acetaminophen|ibuprofen|aspirin)\b/i;
const investigationTerms=/\b(scan|x[- ]?ray|mri|ct\b|ultrasound|ecg|ekg|blood test|urine test|lab(?:oratory)?|imaging|test for)\b/i;
const procedureTerms=/\b(procedure|surgery|operation|stitch|suture|iv\b|intravenous|oxygen|nebuliz|refer|admit|admission|discharge)\b/i;
const followupTerms=/\b(follow[- ]?up|come back|return|review in|appointment|see your|consult|monitor|rest|avoid|drink|warning sign)\b/i;
const question=/\?\s*$/;
const negated=/\b(no|not|never|without|do not|don't|did not|didn't|denies?)\b.{0,35}\b(pain|breath|bleeding|fever|seizure|dizz)/i;

function item(turn:Turn,category:ClinicalItem['category'],text=turn.speaker==='patient'?turn.translated_text:turn.original_text):ClinicalItem{return {id:randomUUID(),category,text:text.trim(),sourceTurnId:turn.id,sourceText:turn.original_text,status:'unconfirmed',speaker:turn.speaker};}
function unique(items:ClinicalItem[]){const seen=new Set<string>();return items.filter(x=>{const key=x.category+':'+x.text.toLowerCase().replace(/\W/g,'');if(seen.has(key))return false;seen.add(key);return true;});}

export function analyzeTurns(turns:Turn[]):ClinicalSummary{
 const patientHighlights:ClinicalItem[]=[],doctorPlan:ClinicalItem[]=[],attentionItems:ClinicalItem[]=[];
 for(const turn of turns){const english=(turn.speaker==='patient'?turn.translated_text:turn.original_text).trim();if(!english)continue;
  if(turn.speaker==='patient'){
   if(!question.test(english)&&symptomTerms.test(english))patientHighlights.push(item(turn,'symptom',english));
   if(!question.test(english)&&!negated.test(english)&&emergencyTerms.test(english))attentionItems.push(item(turn,'attention',english));
  }else{
   if(medicationTerms.test(english))doctorPlan.push(item(turn,'medication',english));
   if(investigationTerms.test(english))doctorPlan.push(item(turn,'investigation',english));
   if(procedureTerms.test(english))doctorPlan.push(item(turn,'procedure',english));
   if(followupTerms.test(english))doctorPlan.push(item(turn,'followup',english));
  }
 }
 const patientTurns=turns.filter(t=>t.speaker==='patient'&&t.translated_text.trim());
 const chiefComplaint=patientHighlights[0]?.text||patientTurns[0]?.translated_text||'';
 const unresolved=doctorPlan.filter(x=>x.category==='medication'&&!/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|tablet|capsule)s?\b/i.test(x.text)).map(x=>'Medication details may be incomplete: '+x.text);
 return {chiefComplaint,patientHighlights:unique(patientHighlights),doctorPlan:unique(doctorPlan),attentionItems:unique(attentionItems),unresolved:[...new Set(unresolved)],reviewed:false};
}
