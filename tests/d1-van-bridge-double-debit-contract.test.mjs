import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('legacy ERP bridge rejects already-debited D1 van inventory before posting ledger',()=>{
 const code=readFileSync(new URL('../services/driver-financial-bridge-posting-qa.js',import.meta.url),'utf8');
 const guard=code.indexOf("fail('D1 source delivery requires canonical van-stock finance integration: legacy warehouse debit prohibited')");
 const posting=code.indexOf('await postLedger(');
 assert.ok(guard>0&&posting>guard,'D1 van stock double-debit guard must precede ledger writes');
 assert.match(code,/legacy warehouse debit prohibited/);
});

// Prevent escaped newline sequences from turning the safety check into a comment.
test('van stock protection is executable code rather than commented text',()=>{
 const code=readFileSync(new URL('../services/driver-financial-bridge-posting-qa.js',import.meta.url),'utf8');
 const lines=code.split('\n');
 const guardLine=lines.find(line=>line.includes("fail('D1 source delivery requires canonical van-stock finance integration"));
 assert.ok(guardLine,'missing guard');
 assert.match(guardLine.trim(),/^fail\(/,'guard must start on its own executable line');
});

test('unmarked D1 events also fail closed before legacy warehouse debit',()=>{
 const code=readFileSync(new URL('../services/driver-financial-bridge-posting-qa.js',import.meta.url),'utf8');
 const block=code.slice(code.indexOf("if(await tx.get('SELECT id FROM driver_finance_bridge_receipts WHERE company_id=? AND source_key=?'"),code.indexOf("const company=await tx.get("));
 assert.match(block,/fail\('D1 source delivery requires canonical van-stock finance integration: legacy warehouse debit prohibited'\)/);
 assert.doesNotMatch(block,/if\s*\(\s*event\?\.source\?\.inventorySource/);
});
