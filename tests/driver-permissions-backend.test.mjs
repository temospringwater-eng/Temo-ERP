import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const require=createRequire(import.meta.url);
const {permissionKeys,normalizePermissions,driverPermissionsSchema,createDriverPermissionRoutes}=
  require('../services/driver-permissions-service');

function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE companies(id INTEGER PRIMARY KEY,active INTEGER NOT NULL,status TEXT NOT NULL);
  CREATE TABLE users(id INTEGER PRIMARY KEY,company_id INTEGER,role TEXT NOT NULL,active INTEGER NOT NULL,status TEXT NOT NULL);
  CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,company_id INTEGER,user_id INTEGER,action TEXT,entity_type TEXT,entity_id INTEGER,
     previous_value TEXT,new_value TEXT);
  INSERT INTO companies VALUES(1,1,'active'),(2,1,'active'),(3,0,'inactive');
  INSERT INTO users VALUES(11,1,'driver',1,'active'),(12,1,'delivery_driver',1,'active'),(13,1,'driver',0,'inactive'),
    (14,1,'driver',1,'inactive'),(21,2,'driver',1,'active'),(31,1,'company_admin',1,'active'),
    (32,2,'company_admin',1,'active'),(33,3,'company_admin',1,'active'),
    (41,1,'staff',1,'active'),(99,NULL,'super_admin',1,'active');
 `);
 db.exec(driverPermissionsSchema);
 const query=async(sql,values=[])=>db.prepare(sql).all(...values);
 const insert=async(sql,values=[])=>({id:Number(db.prepare(sql).run(...values).lastInsertRowid)});
 const update=async(sql,values=[])=>({changes:Number(db.prepare(sql).run(...values).changes)});
 const writeAudit=async(req,action,entityType,entityId,oldValue,newValue)=>{
  db.prepare('INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,previous_value,new_value) VALUES(?,?,?,?,?,?,?)')
    .run(req.companyId,req.user.id,action,entityType,entityId,JSON.stringify(oldValue),JSON.stringify(newValue));
 };
 const routes=new Map();
 const app={
  get(path,...handlers){routes.set('GET '+path,handlers);},
  put(path,...handlers){routes.set('PUT '+path,handlers);}
 };
 createDriverPermissionRoutes({app,query,insert,update,writeAudit});
 const persons={
  driver:{id:11,company_id:1,role:'driver'},
  secondDriver:{id:12,company_id:1,role:'delivery_driver'},
  inactiveDriver:{id:13,company_id:1,role:'driver'},
  revokedStatusDriver:{id:14,company_id:1,role:'driver'},
  otherDriver:{id:21,company_id:2,role:'driver'},
  admin:{id:31,company_id:1,role:'company_admin'},
  otherAdmin:{id:32,company_id:2,role:'company_admin'},
  inactiveCompanyAdmin:{id:33,company_id:3,role:'company_admin'},
  staff:{id:41,company_id:1,role:'staff'},
  superAdmin:{id:99,company_id:null,role:'super_admin'}
 };
 async function request(method,pattern,{actor=persons.driver,targetId,body}={}){
  const handlers=routes.get(method+' '+pattern);
  assert.ok(handlers,'API route registered: '+pattern);
  const req={user:actor,companyId:actor?.company_id??null,
             params:targetId===undefined?{}:{id:String(targetId)},body};
  const res={code:200,body:null,status(n){this.code=n;return this;},json(value){this.body=value;return this;}};
  for(const handler of handlers){
   let nextCalled=false;
   await handler(req,res,()=>{nextCalled=true;});
   if(!nextCalled||res.body!==null)break;
  }
  return {status:res.code,json:res.body};
 }
 return {db,persons,request,close:()=>db.close()};
}
const me='/api/driver/permissions';
const admin='/api/admin/drivers/:id/permissions';

test('12 exact approved driver permissions; missing and string values fail closed',()=>{
 assert.equal(permissionKeys.length,12);
 assert.equal(new Set(permissionKeys).size,12);
 assert.equal(Object.keys(normalizePermissions({})).length,12);
 assert.equal(Object.values(normalizePermissions({})).some(Boolean),false);
 assert.equal(normalizePermissions({view_balance:true,change_price:'true'}).view_balance,true);
 assert.equal(normalizePermissions({view_balance:true,change_price:'true'}).change_price,false);
 assert.equal(Object.hasOwn(normalizePermissions({admin_access:true}),'admin_access'),false);
});
test('authenticated drivers see only own empty permissions, never admin controls',async t=>{
 const f=fixture();t.after(f.close);
 for(const actor of [f.persons.driver,f.persons.secondDriver]){
  const result=await f.request('GET',me,{actor});
  assert.equal(result.status,200,JSON.stringify(result.json));
  assert.equal(result.json.driverId,actor.id);
  assert.equal(Object.values(result.json.permissions).some(Boolean),false);
 }
 for(const actor of [f.persons.admin,f.persons.staff,f.persons.superAdmin,null]){
  const result=await f.request('GET',me,{actor});
  assert.equal(result.status,actor?403:401);
 }
});
test('Company Admin can grant/revoke one permission with scoped readback and audit',async t=>{
 const f=fixture();t.after(f.close);
 assert.equal((await f.request('GET',admin,{actor:f.persons.admin,targetId:11})).json.permissions.view_balance,false);
 const save=await f.request('PUT',admin,{actor:f.persons.admin,targetId:11,body:{permissions:{view_balance:true}}});
 assert.equal(save.status,200,JSON.stringify(save.json));
 assert.equal(save.json.driverId,11);
 assert.equal(save.json.permissions.view_balance,true);
 assert.equal(save.json.permissions.change_price,false);
 assert.equal((await f.request('GET',me,{actor:f.persons.driver})).json.permissions.view_balance,true);
 const revoke=await f.request('PUT',admin,{actor:f.persons.admin,targetId:11,body:{permissions:{view_balance:false}}});
 assert.equal(revoke.status,200);
 assert.equal(revoke.json.permissions.view_balance,false);
 assert.equal(f.db.prepare('SELECT COUNT(*) as n FROM audit_logs').get().n,2);
 assert.equal(f.db.prepare('SELECT COUNT(*) as n FROM driver_permission_settings').get().n,1);
});
test('cross-tenant, inactive driver and unauthorized admin roles cannot read/update',async t=>{
 const f=fixture();t.after(f.close);
 for(const actor of [f.persons.driver,f.persons.otherDriver,f.persons.staff,f.persons.superAdmin]){
  const r=await f.request('PUT',admin,{actor,targetId:11,body:{permissions:{view_balance:true}}});
  assert.equal(r.status,403);
 }
 for(const id of [13,14,21,999]){
  assert.equal((await f.request('GET',admin,{actor:f.persons.admin,targetId:id})).status,404);
  assert.equal((await f.request('PUT',admin,{actor:f.persons.admin,targetId:id,body:{permissions:{view_balance:true}}})).status,404);
 }
 assert.equal((await f.request('PUT',admin,{actor:f.persons.inactiveCompanyAdmin,targetId:21,body:{permissions:{view_balance:true}}})).status,403);
 assert.equal(f.db.prepare('SELECT COUNT(*) as n FROM audit_logs').get().n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) as n FROM driver_permission_settings').get().n,0);
});
test('unknown flag, nonboolean grant, empty and forged request identity fail before DB write',async t=>{
 const f=fixture();t.after(f.close);
 for(const body of [
  {permissions:{admin_access:true}}, {permissions:{view_balance:'true'}},
  {permissions:{view_balance:1}}, {permissions:{}},
  {permissions:[true]}, {permissions:null}, {},
  {permissions:{view_balance:true},companyId:2},
  {permissions:{view_balance:true},driverId:21},
 ]) {
  const r=await f.request('PUT',admin,{actor:f.persons.admin,targetId:11,body});
  assert.equal(r.status,400,JSON.stringify({body,result:r}));
 }
 assert.equal(f.db.prepare('SELECT COUNT(*) as n FROM driver_permission_settings').get().n,0);
});
test('one tenant cannot view another tenant settings even with a valid target ID',async t=>{
 const f=fixture();t.after(f.close);
 await f.request('PUT',admin,{actor:f.persons.otherAdmin,targetId:21,body:{permissions:{view_balance:true}}});
 assert.equal((await f.request('GET',admin,{actor:f.persons.admin,targetId:21})).status,404);
 assert.equal((await f.request('GET',me,{actor:f.persons.driver})).json.permissions.view_balance,false);
 assert.equal((await f.request('GET',me,{actor:f.persons.otherDriver})).json.permissions.view_balance,true);
});
