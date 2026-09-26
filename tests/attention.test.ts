import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportedAttention } from '../backend/attention.js';
test('flags explicit reported breathing distress and avoids negatives and questions',()=>{
 for(const text of ["I can't breathe.",'I am having a lot of difficulty breathing.','I am struggling to breathe.',"It's very hard for me to breathe.","It's hard for me to breathe.",'It was hard for me to breathe. It was very difficult.'])assert.ok(reportedAttention(text),text);
 for(const text of ['I have no difficulty breathing.','I am not having trouble breathing.','Do you have difficulty breathing?','I have a headache.','I can breathe normally.'])assert.equal(reportedAttention(text),undefined,text);
});
