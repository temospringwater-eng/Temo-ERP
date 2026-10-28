// QA-only finance posting guard: financial ledger must never be independently posted
// from a van stock debit without a verified, single D1 transaction.
const id=n=>Number.isSafeInteger(n)&&n>0;
const nonnegative=n=>Number.isSafeInteger(n)&&n>=0;
export function validateDeliveryFinanceInput(p){
 if(!p||![p.companyId,p.driverId,p.deliveryId,p.productId,p.quantity].every(id)||
  ![p.cashCents,p.creditCents,p.bottlesReturned].every(nonnegative)||
  typeof p.idempotencyKey!=='string'||!/^[a-zA-Z0-9._:-]{8,110}$/.test(p.idempotencyKey))
  throw Error('invalid delivery finance payload');
 if(typeof p.signatureRef!=='string'||p.signatureRef.length<8||
  typeof p.photoRef!=='string'||p.photoRef.length<8||
  !Number.isFinite(p.latitude)||Math.abs(p.latitude)>90||
  !Number.isFinite(p.longitude)||Math.abs(p.longitude)>180)
  throw Error('delivery signature photo and GPS required');
 return Object.freeze({...p});
}
export async function postDeliveryFinanceQa(db,p){
 validateDeliveryFinanceInput(p);
 if(!db?.prepare||!db?.batch)throw Error('D1 required');
 // No standalone stock debit + separate finance posting: a crash between calls
 // would lose financial integrity. This intentionally blocks release until the
 // full delivery/receipt/payment/bottle/credit operation is one atomic D1 batch.
 throw Error('QA BLOCKED: combined stock cash credit bottle and proof transaction not implemented');
}
