// Company Admin-only QA page for driver permissions. Server remains the authority.
// Not wired to production API until tenant-scoped backend and migrations are approved.
export const permissionKeys=Object.freeze([
 'create_customer','create_order','view_balance','change_qty',
 'change_price','edit_notes','manage_customer_schedule',
 'gps_delivery_override','refund_security_deposit','sale_quotation',
 'stock_negative_override','view_customer_ledger'
]);
const labels=Object.freeze({
 create_customer:'Add Customer',create_order:'Create Order',view_balance:'View Balance',
 change_qty:'Change Quantity',change_price:'Change Price',edit_notes:'Edit Notes',
 manage_customer_schedule:'Manage Customer Schedule',gps_delivery_override:'GPS Override',
 refund_security_deposit:'Refund Security Deposit',sale_quotation:'Create Quotation',
 stock_negative_override:'Negative Stock Override',view_customer_ledger:'Customer Ledger'
});
export function normalizePermissions(source){
 return Object.fromEntries(permissionKeys.map(key=>[key,source?.[key]===true]));
}
const validId=(x)=>Number.isSafeInteger(Number(x))&&Number(x)>0&&String(x).trim()!=='';
export function createDriverPermissionClient({role,token,fetcher}){
 function verify(){
   if(role !== 'company_admin') throw Error('Company Admin required');
   if(!token||typeof token!=='string')throw Error('Verified company session required');
 }
 async function call(url,options={}){
   verify();
   const response=await fetcher(url,{
     ...options,
     headers:{Accept:'application/json',Authorization:'Bearer '+token,...(options.headers||{})}
   });
   if(!response.ok)throw Error('Permission service denied or unavailable');
   return response.json();
 }
 function pathFor(id){
   if(!validId(id))throw Error('Invalid driver');
   return '/api/admin/drivers/'+Number(id)+'/permissions';
 }
 async function listDrivers(){
   const items=await call('/api/drivers');
   if(!Array.isArray(items))throw Error('Invalid drivers response');
   return items.filter(x=>x&&validId(x.id)&&['driver','delivery_driver'].includes(x.role))
     .map(x=>({id:Number(x.id),name:String(x.name||'Driver')}));
 }
 async function loadPermissions(id){
   const data=await call(pathFor(id));
   if(!data||Number(data.driverId)!==Number(id)||!data.permissions||
      typeof data.permissions!=='object'||Array.isArray(data.permissions))
     throw Error('Invalid permission response');
   return normalizePermissions(data.permissions);
 }
 async function savePermission(id,key,value){
   verify();
   const path=pathFor(id);
   if(!permissionKeys.includes(key)||typeof value!=='boolean')throw Error('Invalid driver permission');
   await call(path,{method:'PUT',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({permissions:{[key]:value}})});
   const confirmed=await loadPermissions(id);
   if(confirmed[key]!==value)throw Error('Permission change not confirmed');
   return confirmed;
 }
 return {listDrivers,loadPermissions,savePermission};
}
function showStatus(message,kind='info'){
 const element=document.getElementById('permissionStatus');
 element.textContent=message;element.dataset.kind=kind;
}
function renderPermissionList(client,driverId,permissions){
 const list=document.getElementById('permissionList');
 list.replaceChildren();
 for(const key of permissionKeys){
   const row=document.createElement('label');
   row.className='permission-row';
   const name=document.createElement('span');name.textContent=labels[key]||key;
   const input=document.createElement('input');
   input.type='checkbox';input.checked=permissions[key]===true;
   input.setAttribute('aria-label',name.textContent);
   input.addEventListener('change',async()=>{
     const attempted=input.checked;
     input.disabled=true;
     showStatus('Saving permission…');
     try{
       const confirmed=await client.savePermission(driverId,key,attempted);
       renderPermissionList(client,driverId,confirmed);
       showStatus('Permission verified and saved.','success');
     }catch(error){
       input.checked=!attempted;
       input.disabled=false;
       showStatus('Save not confirmed. Check the Company Admin API and try again.','error');
     }
   });
   row.append(name,input);list.appendChild(row);
 }
}
async function startAdminPage(){
 const select=document.getElementById('driverSelect');
 const button=document.getElementById('reloadDrivers');
 select.disabled=true;button.disabled=true;
 let user=null;
 try{user=JSON.parse(localStorage.getItem('temo_aquaflow_user')||'null');}catch{}
 const token=localStorage.getItem('temo_aquaflow_token');
 if(user?.role !== 'company_admin'){
   showStatus('Company Admin required. This is not a Driver screen.','error');
   return;
 }
 if(!token){showStatus('Sign in to ERP as Company Admin first.','error');return;}
 const client=createDriverPermissionClient({role:user.role,token,fetcher:(url,options)=>fetch(url,options)});
 async function openSelected(){
   const driverId=Number(select.value);
   document.getElementById('permissionList').replaceChildren();
   if(!Number.isSafeInteger(driverId)||driverId<=0)return;
   showStatus('Checking driver permissions…');
   try{
     const permissions=await client.loadPermissions(driverId);
     renderPermissionList(client,driverId,permissions);
     showStatus('Only Company Admin can update these flags.','success');
   }catch{
     showStatus('Permission service unavailable. No rights granted.','error');
   }
 }
 async function reload(){
   select.disabled=true;button.disabled=true;
   select.replaceChildren();
   document.getElementById('permissionList').replaceChildren();
   showStatus('Loading authorized drivers…');
   try{
     const drivers=await client.listDrivers();
     const placeholder=document.createElement('option');
     placeholder.value='';placeholder.textContent='Select a driver';select.appendChild(placeholder);
     for(const driver of drivers){
       const option=document.createElement('option');
       option.value=String(driver.id);option.textContent=driver.name+' (#'+driver.id+')';
       select.appendChild(option);
     }
     select.disabled=false;button.disabled=false;
     showStatus(drivers.length ? 'Choose a driver to manage permissions.' : 'No drivers assigned to this company.');
   }catch{
     showStatus('Driver list unavailable. Check Company Admin access.','error');
   }
 }
 select.addEventListener('change',openSelected);
 button.addEventListener('click',reload);
 await reload();
}
if(typeof document!=='undefined') document.addEventListener('DOMContentLoaded',startAdminPage);
