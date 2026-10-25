'use strict';

// QA-only module. Never expose an administrative route inside the native driver APK.
// All authorisation and driver-scoping decisions are made on the server.
const permissionKeys=Object.freeze([
  'create_customer','create_order','view_balance','change_qty','change_price','edit_notes',
  'manage_customer_schedule','gps_delivery_override','refund_security_deposit',
  'sale_quotation','stock_negative_override','view_customer_ledger'
]);
const allowedKeys=new Set(permissionKeys);
const driverPermissionsSchema=`CREATE TABLE IF NOT EXISTS driver_permission_settings (
  company_id INTEGER NOT NULL,
  driver_id INTEGER NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '{}',
  updated_by INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id,driver_id)
)`;
const validId=id=>Number.isSafeInteger(Number(id))&&Number(id)>0&&String(id??'').trim()!=='';
const normalizePermissions=(source)=>Object.fromEntries(
  permissionKeys.map(k=>[k,source!=null && typeof source==='object' && source[k]===true])
);
const failure=(status,message)=>Object.assign(new Error(message),{status});
const fail=(status,message)=>{throw failure(status,message);};

function createDriverPermissionRoutes({app,query,insert,writeAudit}){
  if(!app||typeof query!=='function'||typeof insert!=='function'||typeof writeAudit!=='function')
    throw Error('Driver permission backend dependencies must be provided');

  async function actor(req,allowedRoles) {
    if(!req.user)fail(401,'Authentication required');
    const id=req.user.id, companyId=req.companyId;
    if(!validId(id)||!validId(companyId)||!allowedRoles.includes(req.user.role))
      fail(403,'Driver permission access denied');
    // Do not trust a still-valid but revoked session or a forged tenant claim.
    const rows=await query(`
      SELECT u.id,u.role FROM users u JOIN companies c ON c.id=u.company_id
      WHERE u.id=? AND u.company_id=? AND u.active=1 AND c.active=1
        AND u.status='active' AND c.status='active'
        AND u.role=?
    `,[Number(id),Number(companyId),req.user.role]);
    if(!rows.length)fail(403,'Company or account inactive');
    return {id:Number(id),companyId:Number(companyId),role:req.user.role};
  }
  async function target(companyId,driverId){
    if(!validId(driverId))fail(400,'Invalid driver ID');
    const rows=await query(`
      SELECT u.id FROM users u JOIN companies c ON c.id=u.company_id
      WHERE u.id=? AND u.company_id=? AND u.active=1 AND c.active=1
        AND u.status='active' AND c.status='active'
        AND u.role IN ('driver','delivery_driver')
    `,[Number(driverId),companyId]);
    if(!rows.length)fail(404,'Assigned company driver not found');
    return Number(driverId);
  }
  async function readPermissions(companyId,driverId) {
    const rows=await query('SELECT permissions_json FROM driver_permission_settings WHERE company_id=? AND driver_id=?',
      [companyId,driverId]);
    if(!rows.length)return normalizePermissions({});
    let data;
    try{data=JSON.parse(rows[0].permissions_json);}
    catch{fail(503,'Driver permission settings unavailable');}
    if(!data||typeof data!=='object'||Array.isArray(data))
      fail(503,'Driver permission settings unavailable');
    return normalizePermissions(data);
  }
  async function driverRead(req){
    const caller=await actor(req,['driver','delivery_driver']);
    await target(caller.companyId,caller.id);
    return {driverId:caller.id,permissions:await readPermissions(caller.companyId,caller.id)};
  }
  async function adminRead(req){
    const caller=await actor(req,['company_admin']);
    const driverId=await target(caller.companyId,req.params.id);
    return {driverId,permissions:await readPermissions(caller.companyId,driverId)};
  }
  async function adminUpdate(req){
    const caller=await actor(req,['company_admin']);
    const driverId=await target(caller.companyId,req.params.id);
    const payload=req.body;
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||
      Object.keys(payload).length!==1||!Object.hasOwn(payload,'permissions'))
      fail(400,'Invalid permission request');
    const patch=payload.permissions;
    if(!patch||typeof patch!=='object'||Array.isArray(patch))
      fail(400,'Expected permission flags');
    const keys=Object.keys(patch);
    if(keys.length<1||keys.length>permissionKeys.length||
       keys.some(k=>!allowedKeys.has(k)||typeof patch[k]!=='boolean'))
      fail(400,'Only approved Boolean driver permissions are allowed');
    const previous=await readPermissions(caller.companyId,driverId);
    const merged=normalizePermissions({...previous,...patch});
    await insert(`
      INSERT INTO driver_permission_settings(company_id,driver_id,permissions_json,updated_by)
      VALUES(?,?,?,?)
      ON CONFLICT(company_id,driver_id) DO UPDATE SET
        permissions_json=excluded.permissions_json,
        updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP
    `,[caller.companyId,driverId,JSON.stringify(merged),caller.id]);
    await writeAudit(req,'driver_permissions_update','user',driverId,previous,merged);
    return {driverId,permissions:await readPermissions(caller.companyId,driverId)};
  }
  function endpoint(fn){
    return async(req,res)=>{
      try{return res.json(await fn(req));}
      catch(error){
        const status=Number.isInteger(error?.status)?error.status:503;
        const message=status<500?error.message:'Driver permission service unavailable';
        return res.status(status).json({message});
      }
    };
  }
  app.get('/api/driver/permissions',endpoint(driverRead));
  app.get('/api/admin/drivers/:id/permissions',endpoint(adminRead));
  app.put('/api/admin/drivers/:id/permissions',endpoint(adminUpdate));
  return {driverRead,adminRead,adminUpdate};
}

module.exports={permissionKeys,normalizePermissions,driverPermissionsSchema,createDriverPermissionRoutes};
