'use strict';
// Deliberately not installed on central production ERP. Private, QA-only HTTP
// entrypoint for trusted server-to-server D1 financial delivery receipts.
const crypto=require('node:crypto'),express=require('express');
const route='/internal/qa/d1-driver-finance';
const pattern=/^[a-f0-9]{64}$/;
function requestMac(secret,stamp,raw){
 if(typeof secret!=='string'||Buffer.byteLength(secret)<32)throw Error('QA transport secret invalid');
 const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
 const sha=crypto.createHash('sha256').update(bytes).digest('hex');
 return crypto.createHmac('sha256',secret).update(stamp+'\n'+sha).digest('hex');
}
function validAuth(secret,stamp,raw,signature){
 if(!/^\d{13}$/.test(stamp||'')||Math.abs(Date.now()-Number(stamp))>300000||
    !pattern.test(signature||''))return false;
 const expected=Buffer.from(requestMac(secret,stamp,raw),'hex');
 return crypto.timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
function qaOnly({qaEnabled,nodeEnv,dbPath}){
 return qaEnabled===true&&nodeEnv==='test'&&
  typeof dbPath==='string'&&/(?:^|[\\/])[^\\/]*qa[^\\/]*\.db$/i.test(dbPath);
}
function createDriverFinanceHttpQa({app,qaEnabled=false,nodeEnv=process.env.NODE_ENV,dbPath,
 transportSecret,receiptSecret,service}={}){
 if(!qaOnly({qaEnabled,nodeEnv,dbPath}))return false;
 if(!app?.post||!service||typeof service.post!=='function'||
  typeof transportSecret!=='string'||Buffer.byteLength(transportSecret)<32||
  typeof receiptSecret!=='string'||Buffer.byteLength(receiptSecret)<32||
  transportSecret===receiptSecret)throw Error('STOP: isolated signed finance bridge configuration invalid');
 app.post(route,(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))
   return res.status(415).json({error:'JSON required'});
  next();
 },express.raw({type:'application/json',limit:'32kb'}),async(req,res)=>{
  const stamp=req.headers['x-temo-qa-timestamp'],auth=req.headers['x-temo-qa-auth'];
  const body=req.body;
  if(!Buffer.isBuffer(body)||body.length<30||body.length>32768||
    !validAuth(transportSecret,stamp,body,auth))
   return res.status(401).json({error:'Service authorization rejected'});
  let payload;
  try {payload=JSON.parse(body.toString('utf8'));}
  catch {return res.status(400).json({error:'Invalid signed JSON'});}
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    !payload.event||!pattern.test(payload.signature||''))
   return res.status(400).json({error:'Signed receipt required'});
  try{
   const receipt=await service.post(payload); // Dedicated atomic and idempotent DB posting
   if(receipt?.status!=='applied'||!Number.isSafeInteger(receipt.erpDeliveryId)||
      receipt.erpDeliveryId<1||!Number.isSafeInteger(receipt.d1DeliveryId)||
      receipt.d1DeliveryId<1||!Number.isSafeInteger(receipt.companyId)||
      receipt.companyId<1||!Number.isSafeInteger(receipt.d1CompanyId)||
      receipt.d1CompanyId<1||receipt.d1CompanyId!==payload.event?.source?.companyId||
      receipt.d1DeliveryId!==payload.event?.source?.deliveryId)
    throw Error('ERP posted result invalid or signed source mapping mismatch');
   const raw=JSON.stringify({ok:true,receipt});
   res.setHeader('Content-Type','application/json');
   res.setHeader('x-temo-qa-ack-time',stamp);
   res.setHeader('x-temo-qa-ack',requestMac(transportSecret,stamp,raw));
   return res.status(200).end(raw);
  }catch{
   // Do not report internal SQL, tenant mappings or the HMAC secret to callers.
   return res.status(409).json({error:'QA sync blocked; manual reconciliation required'});
  }
 });
 return true;
}
module.exports={createDriverFinanceHttpQa,requestMac,validAuth,qaOnly,route};
