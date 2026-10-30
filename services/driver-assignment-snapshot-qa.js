'use strict';
const crypto=require('node:crypto');
const path=require('node:path');

// Source-of-truth read export only. Never runs against hayrila.db, normal ERP,
// or a production process. An approved private transport must deliver this
// signed snapshot; this module deliberately creates no public endpoint.
const positive=value=>Number.isSafeInteger(value)&&value>0;
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
 !Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function assertId(value,label){if(!positive(value))throw Error('Invalid '+label);}
async function buildQaDriverAssignmentSnapshot({
 query,dbPath,qaEnabled=false,nodeEnv=process.env.NODE_ENV,secret,
 erpCompanyId,erpDriverId,d1CompanyId,d1DriverId,date,sequence
}={}){
 if(qaEnabled!==true||nodeEnv==='production'||!/(?:^|[\\/])[^\\/]*qa[^\\/]*\.db$/i.test(dbPath||''))
  throw Error('QA-only disposable SQLite assignment export disabled');
 if(typeof query!=='function')throw Error('QA scoped ERP query is required');
 if(typeof secret!=='string'||Buffer.byteLength(secret)<32)throw Error('Private HMAC secret too short');
 for(const [value,name] of [
  [erpCompanyId,'ERP company'],[erpDriverId,'ERP driver'],
  [d1CompanyId,'mapped D1 company'],[d1DriverId,'mapped D1 driver'],[sequence,'sequence']])
   assertId(value,name);
 if(!validDate(date))throw Error('Invalid assignment date');
 const authorized=await query(`SELECT u.id FROM users u
  JOIN companies c ON c.id=u.company_id
  WHERE u.id=? AND u.company_id=? AND u.active=1 AND c.active=1
    AND u.role IN ('driver','delivery_driver')`,[erpDriverId,erpCompanyId]);
 if(authorized.length!==1)throw Error('ERP driver or company not active in requested tenant');
 const rows=await query(`SELECT d.id AS delivery_id,d.order_id,d.status,
   o.customer_name,o.delivery_address,o.total_amount,c.phone
   FROM deliveries d
   JOIN orders o ON o.id=d.order_id AND o.company_id=d.company_id
   LEFT JOIN customers c ON c.id=o.customer_id AND c.company_id=o.company_id
   WHERE d.company_id=? AND d.driver_id=?
     AND date(COALESCE(d.scheduled_date,d.created_at))=?
     AND d.status IN ('assigned','out_for_delivery')
   ORDER BY d.id LIMIT 100`,[erpCompanyId,erpDriverId,date]);
 const exported=rows.map(row=>{
  const deliveryId=Number(row.delivery_id),orderId=Number(row.order_id),
        totalAmount=Number(row.total_amount);
  if(!positive(deliveryId)||!positive(orderId)||!Number.isFinite(totalAmount)||
     totalAmount<0||totalAmount>10000000||!['assigned','out_for_delivery'].includes(row.status))
    throw Error('ERP assignment identity, status or amount invalid');
  const customerName=String(row.customer_name||'').trim(),
        phone=String(row.phone||''),address=String(row.delivery_address||'');
  if(!customerName||customerName.length>150||phone.length>40||address.length>300)
    throw Error('ERP assignment contact fields invalid');
  return {deliveryId,orderId,customerName,phone,address,totalAmount,
    status:row.status,scheduledDate:date};
 });
 const snapshot={
  version:1,issuedAt:new Date().toISOString(),sequence,date,
  company:{erpId:erpCompanyId,d1Id:d1CompanyId},
  driver:{erpId:erpDriverId,d1Id:d1DriverId},rows:exported
 };
 const signature=crypto.createHmac('sha256',secret).update(JSON.stringify(snapshot)).digest('hex');
 return {snapshot,signature};
}
module.exports={buildQaDriverAssignmentSnapshot};
