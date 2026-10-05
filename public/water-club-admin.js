(() => {
  const $=id=>document.getElementById(id),token=localStorage.getItem('temo_aquaflow_token');
  if(!token){location.replace('/');return;}
  const message=value=>{$('message').textContent=value;};
  async function api(path,method='GET',body){const r=await fetch('/api/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.message||'Request failed');return data;}
  function row(target,values,action){const tr=document.createElement('tr');for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}const td=document.createElement('td');action(td);tr.append(td);target.append(tr);}
  function button(target,label,fn){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await fn();message('Saved.');await load();}catch(e){message(e.message);b.disabled=false;}};target.append(b);}
  async function load(){
    const [products,members,orders,config]=await Promise.all([api('products'),api('water-club/admin'),api('water-club/admin/orders'),api('water-club/admin/config')]);
    const selected=$('products').value;$('products').replaceChildren();for(const p of products){const o=document.createElement('option');o.value=p.id;o.textContent=p.name+' · '+p.sale_price+' PKR';$('products').append(o);}if([...$('products').options].some(o=>o.value===selected))$('products').value=selected;
    $('configured').replaceChildren();for(const p of config.products){const line=document.createElement('p');line.textContent=`Product #${p.product_id}: ${p.kind}, ${p.points} points per ${p.units_per_reward} units`;button(line,p.active?'Disable':'Enable',()=>api('water-club/admin/products','POST',{productId:p.product_id,kind:p.kind,points:p.points,unitsPerReward:p.units_per_reward,active:!p.active}));$('configured').append(line);}
    for(const [key,col] of [['firstBonus','first_bonus'],['referralPoints','referral_points'],['redemptionPoints','redemption_points']])$('settings').elements[key].value=config.settings[col];
    $('members').replaceChildren();for(const m of members)row($('members'),[m.name+' (#'+m.customer_id+')',m.plan,m.rewards_enabled?'Enabled':'Disabled'],td=>button(td,m.rewards_enabled?'Disable rewards':'Enable rewards',()=>api('water-club/admin/members/'+m.customer_id,'POST',{rewardsEnabled:!m.rewards_enabled})));
    $('orders').replaceChildren();for(const o of orders)row($('orders'),['#'+o.order_id,o.customer_name,o.status,`${o.total_amount} / ${o.paid} PKR`],td=>{if(!['cancelled','failed','delivered'].includes(o.status))button(td,'Confirm delivered',()=>api('orders/'+o.order_id+'/status','PATCH',{status:'delivered'}));if(!['cancelled','failed'].includes(o.status))button(td,'Cancel',()=>api('orders/'+o.order_id+'/status','PATCH',{status:'cancelled'}));});
  }
  function form(id,path,transform=b=>b){let retry;$(id).onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;const body=transform(Object.fromEntries(new FormData(e.currentTarget))),signature=JSON.stringify(body);if(!retry||retry.signature!==signature)retry={signature,key:crypto.randomUUID()};try{await api(typeof path==='function'?path(body):path,'POST',{...body,requestKey:retry.key});retry=null;message('Saved.');await load();}catch(e){message(e.message);}finally{b.disabled=false;}};}
  form('catalog','water-club/admin/products',b=>({...b,productId:Number(b.productId),points:Number(b.points),unitsPerReward:Number(b.unitsPerReward)}));
  form('settings','water-club/admin/settings',b=>Object.fromEntries(Object.entries(b).map(([k,v])=>[k,Number(v)])));
  form('payment',b=>'water-club/admin/orders/'+b.orderId+'/payment',b=>({...b,amount:Number(b.amount)}));
  form('adjust',b=>'water-club/admin/members/'+b.customerId+'/points',b=>({...b,points:Number(b.points)}));
  $('generate').onclick=async()=>{$('generate').disabled=true;try{const r=await api('delivery-subscriptions/generate-due','POST',{});message(r.count+' orders generated.');await load();}catch(e){message(e.message);}finally{$('generate').disabled=false;}};
  load().catch(e=>message(e.message));
})();
