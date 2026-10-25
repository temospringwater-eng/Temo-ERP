'use strict';
// Never mount outside isolated QA. Driver identity and company come from session middleware.
const crypto=require('node:crypto');
const {createSqlite3AtomicAdapter}=require('./driver-field-tx-qa');
const validId=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
const goodKey=x=>typeof x==='string'&&/^[a-zA-Z0-9._:-]{8,110}$/.test(x);
const bad=(status,message)=>Object.assign(new Error(message),{status});
const hash=(action,body)=>crypto.createHash('sha256').update(JSON.stringify({action,body})).digest('hex');
const money=x=>Number.isFinite(Number(x))&&Number(x)>0&&Number(x)<=1000000&&Math.abs(Number(x)*100-Math.round(Number(x)*100))<1e-7;
const text=(x,n)=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=n;
function createDriverFieldOpsQa({app,sqlite3,dbPath,query,qaEnabled=false}){
 if(!app?.get||!app?.post||!sqlite3?.Database||!dbPath||typeof query!=='function')throw Error('Isolated ERP QA dependencies required');
 const database=createSqlite3AtomicAdapter({sqlite3,dbPath});
 const route='/api/driver/field';
 const response=fn=>async(req,res)=>{
  if(!qaEnabled)return res.status(503).json({message:'Field operations staging disabled'});
  try{return res.json(await fn(req));}
  catch(e){return res.status(e.status||503).json({message:e.status?e.message:'Field operations unavailable; no changes confirmed'});}
 };
 async function actor(req,admin=false){
  if(!validId(req?.companyId)||!validId(req?.user?.id)||
     !(admin?req.user.role==='company_admin':['driver','delivery_driver'].includes(req.user.role)))
    throw bad(403,'Authenticated company role required');
  const companyId=Number(req.companyId),driverId=Number(req.user.id);
  const active=await query('SELECT u.id FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=? AND u.company_id=? AND u.role=? AND u.active=1 AND c.active=1',
   [driverId,companyId,req.user.role]);
  if(active.length!==1)throw bad(403,'Inactive or foreign account');
  return {companyId,driverId,role:req.user.role};
 }
 async function permission(a,key){
  const rows=await query('SELECT enabled FROM driver_field_permissions WHERE company_id=? AND driver_id=? AND permission=?',
    [a.companyId,a.driverId,key]);
  if(rows.length!==1||rows[0].enabled!==1)throw bad(403,'Permission not enabled by Company Admin');
 }
 const scopeSql='SELECT c.id,c.name,c.phone,c.address,c.latitude,c.longitude FROM customers c WHERE c.id=? AND c.company_id=? AND ('+
 'EXISTS(SELECT 1 FROM driver_field_customer_assignments f WHERE f.company_id=c.company_id AND f.customer_id=c.id AND f.driver_id=?) OR '+
 'EXISTS(SELECT 1 FROM orders o JOIN deliveries d ON d.order_id=o.id AND d.company_id=o.company_id WHERE o.company_id=c.company_id AND o.customer_id=c.id AND d.driver_id=?) OR '+
 'EXISTS(SELECT 1 FROM customer_service_areas cs JOIN service_area_drivers sd ON sd.service_area_id=cs.service_area_id AND sd.company_id=cs.company_id WHERE cs.company_id=c.company_id AND cs.customer_id=c.id AND sd.driver_id=?))';
 const scopeArgs=(a,id)=>[id,a.companyId,a.driverId,a.driverId,a.driverId];
 async function customer(a,id){const rows=await query(scopeSql,scopeArgs(a,id));if(rows.length!==1)throw bad(404,'Assigned customer not found');return rows[0];}
 async function receipt(a,action,p,fn,driverId=a.driverId){
  if(!goodKey(p?.idempotencyKey))throw bad(400,'Stable idempotency key required');
  const requestHash=hash(action,p);
  return database.transaction(async tx=>{
   const active=await tx.get('SELECT id FROM users WHERE id=? AND company_id=? AND active=1 AND role=?',a.driverId,a.companyId,a.role);
   if(!active)throw bad(403,'Account changed');
   if(a.role!=='company_admin'){
    const perm=await tx.get('SELECT enabled FROM driver_field_permissions WHERE company_id=? AND driver_id=? AND permission=?',
      a.companyId,a.driverId,action==='customer'?'create_customer':action==='order'?'create_order':'collect_recovery');
    if(perm?.enabled!==1)throw bad(403,'Permission changed before posting');
   }
   const old=await tx.get('SELECT action,request_hash,result_json FROM driver_field_receipts WHERE company_id=? AND driver_id=? AND idempotency_key=?',
     a.companyId,driverId,p.idempotencyKey);
   if(old){
    if(old.action!==action||old.request_hash!==requestHash)throw bad(409,'Same key with changed transaction');
    return JSON.parse(old.result_json);
   }
   const result=await fn(tx);
   await tx.run('INSERT INTO driver_field_receipts(company_id,driver_id,idempotency_key,action,request_hash,result_json) VALUES(?,?,?,?,?,?)',
     a.companyId,driverId,p.idempotencyKey,action,requestHash,JSON.stringify(result));
   return result;
  });
 }
 async function scopedInTx(tx,a,id){
  const c=await tx.get(scopeSql,...scopeArgs(a,id));
  if(!c)throw bad(403,'Customer scope revoked');return c;
 }
 app.get(route+'/customers',response(async req=>{
  const a=await actor(req);
  const rows=await query('SELECT id FROM customers WHERE company_id=? ORDER BY id DESC LIMIT 500',[a.companyId]);
  const items=[];
  for(const row of rows){const c=await query(scopeSql,scopeArgs(a,row.id));if(c.length===1)items.push(c[0]);}
  return {items};
 }));
 app.post(route+'/customers',response(async req=>{
  const a=await actor(req);await permission(a,'create_customer');const p=req.body||{};
  if(!text(p.name,100)||!text(p.phone,30)||!text(p.address,250))throw bad(400,'Name, phone and address required');
  if((p.latitude!=null&&(!Number.isFinite(Number(p.latitude))||Math.abs(Number(p.latitude))>90))||
     (p.longitude!=null&&(!Number.isFinite(Number(p.longitude))||Math.abs(Number(p.longitude))>180)))throw bad(400,'Invalid GPS coordinates');
  return receipt(a,'customer',p,async tx=>{
   const q=await tx.run('INSERT INTO customers(company_id,name,phone,address,latitude,longitude) VALUES(?,?,?,?,?,?)',
    a.companyId,p.name.trim(),p.phone.trim(),p.address.trim(),p.latitude==null?null:Number(p.latitude),p.longitude==null?null:Number(p.longitude));
   await tx.run('INSERT INTO driver_field_customer_assignments(company_id,driver_id,customer_id) VALUES(?,?,?)',a.companyId,a.driverId,q.lastID);
   return {success:true,customerId:q.lastID,companyId:a.companyId};
  });
 }));
 app.get(route+'/products',response(async req=>{
  const a=await actor(req);await permission(a,'create_order');
  return {items:await query('SELECT id,name,sale_price,stock FROM products WHERE company_id=? ORDER BY name LIMIT 200',[a.companyId])};
 }));
 app.post(route+'/orders',response(async req=>{
  const a=await actor(req);await permission(a,'create_order');const p=req.body||{},id=Number(p.customerId);
  if(!validId(id)||!Array.isArray(p.items)||!p.items.length||p.items.length>30)throw bad(400,'Assigned customer and 1-30 order lines required');
  for(const item of p.items)if(!validId(item.productId)||!validId(item.quantity)||Number(item.quantity)>999)throw bad(400,'Invalid product or quantity');
  await customer(a,id);
  return receipt(a,'order',p,async tx=>{
   const c=await scopedInTx(tx,a,id);let totalCents=0,lines=[];
   for(const x of p.items){
    const product=await tx.get('SELECT id,sale_price,stock FROM products WHERE id=? AND company_id=?',x.productId,a.companyId);
    if(!product||!Number.isFinite(product.sale_price)||product.sale_price<0||product.stock<Number(x.quantity))
      throw bad(409,'Insufficient ERP inventory or invalid product price');
    const price=Math.round(product.sale_price*100);
    if(Math.abs(price/100-product.sale_price)>1e-7)throw bad(409,'ERP product price invalid');
    totalCents+=price*Number(x.quantity);
    lines.push({id:product.id,quantity:Number(x.quantity),price:price/100});
   }
   if(!Number.isSafeInteger(totalCents)||totalCents>1000000000)throw bad(400,'Order total limit exceeded');
   const order=await tx.run("INSERT INTO orders(company_id,customer_id,customer_name,delivery_address,notes,status,total_amount,created_by) VALUES(?,?,?,?,?,'pending',?,?)",
    a.companyId,id,c.name,c.address,String(p.notes||'').slice(0,250),totalCents/100,a.driverId);
   for(const item of lines)await tx.run('INSERT INTO order_items(company_id,order_id,product_id,quantity,unit_price,total_price) VALUES(?,?,?,?,?,?)',
    a.companyId,order.lastID,item.id,item.quantity,item.price,item.price*item.quantity);
   return {success:true,orderId:order.lastID,status:'pending',totalAmount:totalCents/100,companyId:a.companyId};
  });
 }));
 app.get(route+'/customers/:id/ledger',response(async req=>{
  const a=await actor(req);await permission(a,'view_customer_ledger');const id=Number(req.params.id);
  if(!validId(id))throw bad(400,'Customer ID required');await customer(a,id);
  const totals=await query("SELECT COALESCE(SUM(CASE WHEN entry_type IN ('invoice','debit') THEN amount ELSE -amount END),0) AS balance FROM credit_ledger WHERE company_id=? AND customer_id=?",[a.companyId,id]);
  const rows=await query('SELECT id,entry_type,amount,note,due_date,created_at FROM credit_ledger WHERE company_id=? AND customer_id=? ORDER BY id DESC LIMIT 100',[a.companyId,id]);
  return {customerId:id,balance:Math.round(totals[0].balance*100)/100,items:rows};
 }));
 app.post(route+'/recoveries',response(async req=>{
  const a=await actor(req);await permission(a,'collect_recovery');const p=req.body||{},id=Number(p.customerId),amount=Number(p.amount);
  if(!validId(id)||!money(amount)||!['Cash','Bank Transfer'].includes(p.method))throw bad(400,'Customer, amount and method required');
  await customer(a,id);
  return receipt(a,'recovery',p,async tx=>{
   const c=await scopedInTx(tx,a,id);
   const due=await tx.get("SELECT COALESCE(SUM(CASE WHEN entry_type IN ('invoice','debit') THEN amount ELSE -amount END),0) AS balance FROM credit_ledger WHERE company_id=? AND customer_id=?",a.companyId,id);
   const owed=Math.round(due.balance*100),pay=Math.round(amount*100);
   if(owed<=0||pay>owed)throw bad(409,'Recovery exceeds verified customer balance');
   const payment=await tx.run('INSERT INTO payments(company_id,customer_name,amount,method,note) VALUES(?,?,?,?,?)',
     a.companyId,c.name,pay/100,p.method,'Driver recovery (QA)');
   await tx.run("INSERT INTO credit_ledger(company_id,customer_id,payment_id,entry_type,amount,note,created_by) VALUES(?,?,?,'payment',?,?,?)",
     a.companyId,id,payment.lastID,pay/100,'Driver recovery',a.driverId);
   return {success:true,paymentId:payment.lastID,remainingBalance:(owed-pay)/100,companyId:a.companyId};
  });
 }));
 app.get(route+'/zones',response(async req=>{
  const a=await actor(req);await permission(a,'view_zone');
  const zones=await query('SELECT sa.id,sa.name,sa.level FROM service_areas sa JOIN service_area_drivers sd ON sd.company_id=sa.company_id AND sd.service_area_id=sa.id WHERE sa.company_id=? AND sd.driver_id=? AND sa.active=1 ORDER BY sa.name LIMIT 100',[a.companyId,a.driverId]);
  const routes=await query('SELECT r.id,r.name,r.route_date,rs.sequence,rs.delivery_id,rs.status AS stop_status FROM delivery_routes r LEFT JOIN delivery_route_stops rs ON rs.route_id=r.id AND rs.company_id=r.company_id WHERE r.company_id=? AND r.driver_id=? ORDER BY r.route_date DESC,rs.sequence LIMIT 200',[a.companyId,a.driverId]);
  return {zones,routes};
 }));
 app.get(route+'/van-stock',response(async req=>{
  const a=await actor(req);await permission(a,'view_van_stock');
  const items=await query('SELECT v.product_id,p.name,SUM(v.quantity) AS quantity FROM driver_field_van_movements v JOIN products p ON p.id=v.product_id AND p.company_id=v.company_id WHERE v.company_id=? AND v.driver_id=? GROUP BY v.product_id,p.name ORDER BY p.name',[a.companyId,a.driverId]);
  return {items};
 }));
 app.post('/api/admin/driver/field/permissions',response(async req=>{
  const a=await actor(req,true),p=req.body||{},id=Number(p.driverId);
  if(!validId(id)||typeof p.enabled!=='boolean'||!['create_customer','create_order','view_customer_ledger','collect_recovery','view_zone','view_van_stock'].includes(p.permission))throw bad(400,'Valid driver permission required');
  return database.transaction(async tx=>{
   const driver=await tx.get("SELECT id FROM users WHERE company_id=? AND id=? AND role IN ('driver','delivery_driver') AND active=1",a.companyId,id);
   if(!driver)throw bad(404,'Driver not in company');
   await tx.run('INSERT INTO driver_field_permissions(company_id,driver_id,permission,enabled,granted_by) VALUES(?,?,?,?,?) ON CONFLICT(company_id,driver_id,permission) DO UPDATE SET enabled=excluded.enabled,granted_by=excluded.granted_by,updated_at=CURRENT_TIMESTAMP',
     a.companyId,id,p.permission,p.enabled?1:0,a.driverId);
   return {success:true,driverId:id,permission:p.permission,enabled:p.enabled};
  });
 }));
 app.post('/api/admin/driver/field/zones/assign',response(async req=>{
  const a=await actor(req,true),p=req.body||{},id=Number(p.driverId),zone=Number(p.zoneId);
  if(!validId(id)||!validId(zone))throw bad(400,'Driver and zone IDs required');
  return database.transaction(async tx=>{
   const driver=await tx.get("SELECT id FROM users WHERE company_id=? AND id=? AND role IN ('driver','delivery_driver') AND active=1",a.companyId,id);
   const area=await tx.get("SELECT id FROM service_areas WHERE id=? AND company_id=? AND level IN ('zone','sector','route') AND active=1",zone,a.companyId);
   if(!driver||!area)throw bad(404,'Driver/zone not in company');
   await tx.run('INSERT OR IGNORE INTO service_area_drivers(company_id,service_area_id,driver_id,assigned_by) VALUES(?,?,?,?)',a.companyId,zone,id,a.driverId);
   return {success:true,driverId:id,zoneId:zone};
  });
 }));
 app.post('/api/admin/driver/field/van-stock/load',response(async req=>{
  const a=await actor(req,true),p=req.body||{},id=Number(p.driverId),product=Number(p.productId),qty=Number(p.quantity);
  if(!validId(id)||!validId(product)||!validId(qty)||qty>10000)throw bad(400,'Valid driver, product and stock quantity required');
  return receipt(a,'van-load',p,async tx=>{
   const driver=await tx.get("SELECT id FROM users WHERE company_id=? AND id=? AND role IN ('driver','delivery_driver') AND active=1",a.companyId,id);
   if(!driver)throw bad(404,'Driver not in company');
   const changed=await tx.run('UPDATE products SET stock=stock-? WHERE id=? AND company_id=? AND stock>=?',qty,product,a.companyId,qty);
   if(changed.changes!==1)throw bad(409,'Insufficient ERP stock');
   await tx.run("INSERT INTO driver_field_van_movements(company_id,driver_id,product_id,quantity,movement_type,idempotency_key,created_by) VALUES(?,?,?,?,'load',?,?)",
     a.companyId,id,product,qty,p.idempotencyKey,a.driverId);
   await tx.run("INSERT INTO stock_movements(company_id,warehouse_id,product_id,movement_type,quantity,reference,created_by) VALUES(?,NULL,?,'van_load',?,?,?)",
     a.companyId,product,qty,p.idempotencyKey,a.driverId);
   return {success:true,driverId:id,productId:product,loadedQuantity:qty,companyId:a.companyId};
  },id);
 }));
 return {enabled:qaEnabled};
}
module.exports={createDriverFieldOpsQa};
