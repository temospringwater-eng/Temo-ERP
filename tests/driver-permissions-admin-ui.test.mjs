import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {permissionKeys, createDriverPermissionClient, normalizePermissions} from '../public/driver-permissions-admin.mjs';

const fakeResponse=(status,data)=>({ok:status>=200&&status<300,status,async json(){return data;}});
function fakeServer(){
 const permissions=new Map();const requests=[];
 const drivers=[{id:11,name:'QA Driver',role:'driver'}, {id:12,name:'Other Driver',role:'driver'}];
 return {
  requests,permissions,
  async fetch(url,options={}){
   requests.push({url,method:options.method||'GET',headers:options.headers||{},body:options.body});
   if(url==='/api/drivers')return fakeResponse(200,drivers);
   const match=/^\/api\/admin\/drivers\/(\d+)\/permissions$/.exec(url);
   if(!match)return fakeResponse(404,{message:'not found'});
   const id=Number(match[1]);if(!drivers.some(x=>x.id===id))return fakeResponse(404,{message:'Unknown driver'});
   if(options.method==='PUT'){
      const change=JSON.parse(options.body||'{}').permissions||{};
      permissions.set(id,{...(permissions.get(id)||{}),...change});
   }
   return fakeResponse(200,{driverId:id,permissions:permissions.get(id)||{}});
  }
 };
}
test('optional driver flags match approved set and forbidden modules excluded',()=>{
 assert.equal(permissionKeys.length,12);
 assert.equal(new Set(permissionKeys).size,12);
 assert.ok(permissionKeys.includes('change_price'));
 assert.ok(permissionKeys.includes('refund_security_deposit'));
 assert.ok(!permissionKeys.includes('sale_return'));
 assert.ok(!permissionKeys.includes('vendor_purchase'));
 const flags=normalizePermissions({view_balance:true,change_price:'true',sale_return:true});
 assert.equal(flags.view_balance,true);
 assert.equal(flags.change_price,false);
 assert.equal(Object.hasOwn(flags,'sale_return'),false);
 assert.equal(Object.values(normalizePermissions({})).filter(Boolean).length,0);
});
test('only company admin can use browser permissions client',async()=>{
 const server=fakeServer();
 for(const role of ['driver','super_admin','staff',null]){
   const client=createDriverPermissionClient({role,token:'fake-session',fetcher:server.fetch});
   await assert.rejects(client.listDrivers(),/Company Admin required/);
   await assert.rejects(client.savePermission(11,'view_balance',true),/Company Admin required/);
 }
 assert.equal(server.requests.length,0);
});
test('admin permissions flow uses current ERP Bearer authentication and server readback',async()=>{
 const server=fakeServer();const client=createDriverPermissionClient({role:'company_admin',token:'qa-only-session',fetcher:server.fetch});
 assert.deepEqual((await client.listDrivers()).map(x=>x.id),[11,12]);
 assert.equal((await client.loadPermissions(11)).view_balance,false);
 const saved=await client.savePermission(11,'view_balance',true);
 assert.equal(saved.view_balance,true);
 assert.equal((await client.loadPermissions(11)).view_balance,true);
 assert.equal((await client.savePermission(11,'view_balance',false)).view_balance,false);
 assert.ok(server.requests.every(x=>x.headers.Authorization==='Bearer qa-only-session'));
 assert.ok(server.requests.every(x=>!x.url.includes('qa-only-session')));
 const update=server.requests.find(x=>x.method==='PUT');
 assert.equal(update.url,'/api/admin/drivers/11/permissions');
 assert.deepEqual(JSON.parse(update.body),{permissions:{view_balance:true}});
});
test('invalid key/values/driver ids fail before network and cannot enable excluded modules',async()=>{
 const server=fakeServer();const client=createDriverPermissionClient({role:'company_admin',token:'t',fetcher:server.fetch});
 for(const [id,key,value] of [[11,'sale_return',true],[11,'vendor_purchase',true],[11,'view_balance','true'],[-1,'view_balance',true],[0,'view_balance',false]]){
   await assert.rejects(client.savePermission(id,key,value));
 }
 assert.equal(server.requests.length,0);
});
test('offline, HTTP 403 and mismatched driver response fail closed',async()=>{
 const forbidden=createDriverPermissionClient({role:'company_admin',token:'t',fetcher:async()=>fakeResponse(403,{})});
 await assert.rejects(forbidden.loadPermissions(11),/Permission service denied or unavailable/);
 const mismatch=createDriverPermissionClient({role:'company_admin',token:'t',fetcher:async()=>fakeResponse(200,{driverId:12,permissions:{view_balance:true}})});
 await assert.rejects(mismatch.loadPermissions(11),/Invalid permission response/);
 const offline=createDriverPermissionClient({role:'company_admin',token:'t',fetcher:async()=>{throw Error('offline');}});
 await assert.rejects(offline.savePermission(11,'view_balance',true),/offline/);
});
test('server must confirm saved value by readback, never show success on false 200',async()=>{
 let count=0;
 const client=createDriverPermissionClient({role:'company_admin',token:'t',fetcher:async(url,opts)=>{
   count++;
   return fakeResponse(200,{driverId:11,permissions:{view_balance:false}});
 }});
 await assert.rejects(client.savePermission(11,'view_balance',true),/Permission change not confirmed/);
 assert.equal(count,2);
});
test('admin screen stays separate from Driver APK, uses safe DOM and an external module',()=>{
 const html=fs.readFileSync(new URL('../public/driver-permissions-admin.html',import.meta.url),'utf8');
 const script=fs.readFileSync(new URL('../public/driver-permissions-admin.mjs',import.meta.url),'utf8');
 assert.match(html,/TEMO Driver Permissions/);
 assert.match(html,/id="driverSelect"/);
 assert.match(html,/id="permissionList"/);
 assert.match(html,/type="module" src="\/driver-permissions-admin\.mjs"/);
 assert.doesNotMatch(script,/innerHTML\s*=/);
 assert.match(script,/textContent/);
 assert.match(script,/role !== 'company_admin'/);
});
