import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('legacy ERP bridge rejects already-debited D1 van inventory before posting ledger',()=>{
 const code=readFileSync(new URL('../services/driver-financial-bridge-posting-qa.js',import.meta.url),'utf8');
 const guard=code.indexOf("event?.source?.inventorySource==='d1_van_stock'");
 const posting=code.indexOf('await postLedger(');
 assert.ok(guard>0&&posting>guard,'D1 van stock double-debit guard must precede ledger writes');
 assert.match(code,/double stock debit/);
});

// Prevent escaped newline sequences from turning the safety check into a comment.
test('van stock protection is executable code rather than commented text',()=>{
 const code=readFileSync(new URL('../services/driver-financial-bridge-posting-qa.js',import.meta.url),'utf8');
 const lines=code.split('\n');
 const guardLine=lines.find(line=>line.includes("if(event?.source?.inventorySource==='d1_van_stock')"));
 assert.ok(guardLine,'missing guard');
 assert.match(guardLine.trim(),/^if\(/,'guard must start on its own executable line');
});
