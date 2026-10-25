'use strict';
// Real Nodemailer SMTP protocol tested against an isolated local fake server.
// NO external email, credentials, customers or production networks.
const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createNotificationDeliveryService}=require('../services/notification-delivery-service');
const {createDriverCustomerOtpProvider}=require('../services/driver-customer-otp-provider');
async function mailbox({rejectRecipient=false}={}){
 const mail=[];
 const server=net.createServer(socket=>{
  socket.setEncoding('utf8');
  socket.write('220 localhost ESMTP QA-only\r\n');
  let bytes='',dataMode=false,body=[];
  socket.on('data',chunk=>{
   bytes+=chunk;
   while(bytes.includes('\r\n')){
    const end=bytes.indexOf('\r\n'),line=bytes.slice(0,end);
    bytes=bytes.slice(end+2);
    if(dataMode){
     if(line==='.'){
      mail.push(body.join('\n'));body=[];dataMode=false;
      socket.write('250 2.0.0 accepted for QA mailbox\r\n');
     }else body.push(line.startsWith('..')?line.slice(1):line);
     continue;
    }
    const cmd=line.split(' ')[0].toUpperCase();
    if(cmd==='EHLO'||cmd==='HELO')socket.write('250 localhost\r\n');
    else if(cmd==='MAIL')socket.write('250 2.1.0 Sender accepted\r\n');
    else if(cmd==='RCPT')socket.write(rejectRecipient?'550 5.1.1 Rejected in QA\r\n':'250 2.1.5 Recipient accepted\r\n');
    else if(cmd==='DATA'){dataMode=true;socket.write('354 End data with <CRLF>.<CRLF>\r\n');}
    else if(cmd==='QUIT'){socket.write('221 Bye\r\n');socket.end();}
    else socket.write('250 ok\r\n');
   }
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 return {port:server.address().port,mail,close:()=>new Promise(resolve=>server.close(resolve))};
}
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE customers(id INTEGER PRIMARY KEY,company_id INTEGER,email TEXT);"+
  "CREATE TABLE orders(id INTEGER PRIMARY KEY,company_id INTEGER,customer_id INTEGER);"+
  "CREATE TABLE deliveries(id INTEGER PRIMARY KEY,company_id INTEGER,order_id INTEGER,driver_id INTEGER,status TEXT);"+
  "CREATE TABLE delivery_otp_challenges(id INTEGER PRIMARY KEY,company_id INTEGER,delivery_id INTEGER,customer_id INTEGER,"+
   "code_hash TEXT,expires_at TEXT,created_by INTEGER,attempts INTEGER DEFAULT 0,verified_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);"+
  "INSERT INTO customers VALUES(51,1,'qa-inbox@example.invalid');"+
  "INSERT INTO orders VALUES(201,1,51);"+
  "INSERT INTO deliveries VALUES(301,1,201,11,'assigned');");
 const query=async(sql,args=[])=>db.prepare(sql).all(...args);
 const insert=async(sql,args=[])=>({id:Number(db.prepare(sql).run(...args).lastInsertRowid)});
 const update=async(sql,args=[])=>({changes:Number(db.prepare(sql).run(...args).changes)});
 const n=createNotificationDeliveryService({query,insert,update});
 const issue=createDriverCustomerOtpProvider({query,insert,update,
  writeAudit:async()=>{},sendEmail:n.sendEmail,randomCode:()=> '123456'});
 return {db,send:n.sendEmail,call:()=>issue({companyId:1,deliveryId:301,driverId:11,actorId:11,
  req:{user:{id:11,role:'driver'},companyId:1}}),close:()=>db.close()};
}
function configure(t,port){
 const names=['SMTP_HOST','SMTP_PORT','SMTP_FROM','SMTP_SECURE','SMTP_USER','SMTP_PASSWORD'];
 const previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{SMTP_HOST:'127.0.0.1',SMTP_PORT:String(port),
  SMTP_FROM:'TEMO QA <qa-sender@example.invalid>',SMTP_SECURE:'false'});
 delete process.env.SMTP_USER;delete process.env.SMTP_PASSWORD;
 t.after(()=>{for(const k of names)previous[k]===undefined?delete process.env[k]:process.env[k]=previous[k]});
}
test('SMTP wire-level: valid tenant OTP email accepted by isolated real SMTP server, code never exposed to API',async t=>{
 const smtp=await mailbox(),f=fixture();t.after(async()=>{f.close();await smtp.close()});configure(t,smtp.port);
 const result=await f.call();
 assert.equal(result.challengeId,1);assert.equal(result.otpCode,undefined);
 assert.equal(result.maskedDestination,'q***@example.invalid');
 assert.equal(smtp.mail.length,1);
 assert.match(smtp.mail[0],/123456/);
 const saved=f.db.prepare('SELECT code_hash,attempts,expires_at FROM delivery_otp_challenges').get();
 assert.equal(saved.code_hash,crypto.createHash('sha256').update('123456').digest('hex'));
 assert.equal(saved.attempts,0);
 assert.ok(Date.parse(saved.expires_at.replace(' ','T')+'Z')>Date.now());
});
test('SMTP recipient rejects email: locked customer OTP remains unusable and no false send success',async t=>{
 const smtp=await mailbox({rejectRecipient:true}),f=fixture();t.after(async()=>{f.close();await smtp.close()});configure(t,smtp.port);
 await assert.rejects(f.call(),e=>e.status===503);
 assert.equal(smtp.mail.length,0);
 const saved=f.db.prepare('SELECT attempts,expires_at FROM delivery_otp_challenges').get();
 assert.equal(saved.attempts,5);
 assert.ok(Date.parse(saved.expires_at.replace(' ','T')+'Z')<Date.now());
});
test('SMTP missing configuration: no external delivery and zero redeemable challenge',async t=>{
 const f=fixture();t.after(f.close);
 const names=['SMTP_HOST','SMTP_PORT','SMTP_FROM'],old=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 names.forEach(k=>delete process.env[k]);t.after(()=>names.forEach(k=>old[k]===undefined?delete process.env[k]:process.env[k]=old[k]));
 await assert.rejects(f.call(),e=>e.status===503);
 const saved=f.db.prepare('SELECT attempts FROM delivery_otp_challenges').get();
 assert.equal(saved.attempts,5);
});
