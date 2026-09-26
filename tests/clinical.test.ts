import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTurns } from '../backend/clinical.js';
import type { Turn } from '../backend/protocol.js';
const turn=(speaker:'doctor'|'patient',original_text:string,translated_text=original_text,id=crypto.randomUUID()):Turn=>({id,speaker,original_text,translated_text,urgency:'normal',timestamp:new Date().toISOString(),interrupt:false,latency_ms:100});
test('separates patient highlights, attention items, medicines, scans and follow-up',()=>{
 const summary=analyzeTurns([
  turn('patient','मेरे सीने में दर्द है।','I have severe chest pain.'),
  turn('patient','मुझे सांस लेने में दिक्कत है।','I have difficulty breathing.'),
  turn('doctor','Take paracetamol 500 mg twice daily for three days.'),
  turn('doctor','We will order a chest X-ray and blood test.'),
  turn('doctor','Return immediately if breathing gets worse.')
 ]);
 assert.match(summary.chiefComplaint,/chest pain/i);assert.equal(summary.patientHighlights.length,2);assert.equal(summary.attentionItems.length,2);
 assert.ok(summary.doctorPlan.some(x=>x.category==='medication'));assert.ok(summary.doctorPlan.some(x=>x.category==='investigation'));assert.ok(summary.doctorPlan.some(x=>x.category==='followup'));assert.deepEqual(summary.unresolved,[]);
});
test('does not convert a question or a negated symptom into an emergency fact',()=>{const summary=analyzeTurns([turn('doctor','Do you have chest pain?'),turn('patient','मुझे सीने में दर्द नहीं है।','I do not have chest pain.')]);assert.equal(summary.attentionItems.length,0);});
test('marks medication instructions without a captured dose as unresolved',()=>{const summary=analyzeTurns([turn('doctor','Start the antibiotic today.')]);assert.equal(summary.doctorPlan[0].category,'medication');assert.match(summary.unresolved[0],/incomplete/i);});
