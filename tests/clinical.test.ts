import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTurn,classifyTurn } from '../backend/clinical.js';
import type { Turn } from '../backend/protocol.js';
const turn=(speaker:'doctor'|'patient',text:string):Turn=>({id:crypto.randomUUID(),speaker,original_text:text,translated_text:text,urgency:'normal',timestamp:new Date().toISOString(),interrupt:false,latency_ms:1});
test('patient symptom extraction preserves source and remains unconfirmed',()=>{const t=turn('patient','I have severe chest pain since yesterday');const a=analyzeTurn(t);assert.equal(a.facts.some(f=>f.category==='symptom'),true);assert.equal(a.flags[0].level,'critical');assert.equal(a.flags[0].sourceTurnId,t.id);assert.ok(a.facts.every(f=>f.status==='unconfirmed'));});
test('questions and negated symptoms do not create emergency flags',()=>{assert.equal(analyzeTurn(turn('doctor','Do you have chest pain?')).flags.length,0);const a=analyzeTurn(turn('patient','I do not have chest pain'));assert.equal(a.flags.length,0);assert.equal(a.facts[0].category,'negative');});
test('medication details and missing dosage are represented without invention',()=>{const complete=analyzeTurn(turn('doctor','Take paracetamol 500 mg twice daily'));assert.match(complete.facts[0].value,/500 mg/);const incomplete=analyzeTurn(turn('doctor','Take paracetamol'));assert.match(incomplete.facts[0].value,/dosage not captured/);});
test('tests and scans are classified separately',()=>{const t=turn('doctor','I am ordering a blood test and CT scan');assert.equal(classifyTurn(t),'Investigation or scan');assert.equal(analyzeTurn(t).facts[0].category,'investigation');});
