import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {extractPinnedErpBaseDdl,createDisposableErpSchema} from '../services/d1-erp-full-schema-preflight.mjs';
const root=new URL('../',import.meta.url);
test('Preview config explicitly binds only the approved QA database and mode',()=>{
 const c=JSON.parse(readFileSync(new URL('wrangler.preview.jsonc',root),'utf8'));
 assert.equal(c.name,'temo-erp-qa-api');
 assert.equal(c.main,'worker/erp-d1-stage1-qa.mjs');
 assert.equal(c.workers_dev,false);
 assert.equal(c.previews.vars.TEMO_ERP_D1_QA_MODE,'1');
 assert.deepEqual(c.previews.d1_databases,[{binding:'DB',database_name:'temo_erp_qa_db',database_id:'30f7fa07-1053-4fe3-8a3f-8089b146a271'}]);
 assert.equal(c.previews.routes,undefined);
 assert.equal(c.previews.services,undefined);
});
function parity(t,kind){
 const temp=mkdtempSync(join(tmpdir(),'temo-preview-test-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
 mkdirSync(join(temp,'temo-d1'));
 const db=new DatabaseSync(join(temp,'temo-d1/restored.sqlite'));
 createDisposableErpSchema(db,extractPinnedErpBaseDdl(readFileSync(new URL('server.js',root),'utf8')));
 if(kind==='drift')db.exec('ALTER TABLE users ADD COLUMN unexpected TEXT');
 if(kind==='missing')db.exec('DROP TABLE warehouses');
 db.close();
 const workflow=readFileSync(new URL('.github/workflows/qa-d1-encrypted-backup-restore.yml',root),'utf8');
 const script=workflow.match(/node --experimental-sqlite --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/);
 assert.ok(script,'actual workflow parity script is present');
 const code=script[1].split('\n').map(x=>x.replace(/^          /,'')).join('\n');
 return spawnSync(process.execPath,['--experimental-sqlite','--input-type=module'],{
  cwd:root,input:code,encoding:'utf8',env:{...process.env,RUNNER_TEMP:temp}
 });
}
test('Integration: actual backup workflow fails closed on column drift',t=>{const r=parity(t,'drift');assert.equal(r.status,1,r.stdout+r.stderr)});
test('Integration: actual backup workflow fails closed on missing tables',t=>{const r=parity(t,'missing');assert.equal(r.status,1,r.stdout+r.stderr)});
test('Integration: actual backup workflow accepts exact pinned schema',t=>{const r=parity(t,'exact');assert.equal(r.status,0,r.stdout+r.stderr)});
