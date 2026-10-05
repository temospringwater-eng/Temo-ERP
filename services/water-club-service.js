const sqlite3 = require('sqlite3');
const crypto = require('crypto');

// Uses the existing ERP database/entities. A private connection serializes club
// transactions without interleaving BEGIN/COMMIT with legacy route queries.
function createWaterClubService({ dbPath }) {
  const db = new sqlite3.Database(dbPath);
  db.configure('busyTimeout', 10000);
  const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve({ id: this.lastID, changes: this.changes }); }));
  const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
  const one = async (sql, params = []) => (await all(sql, params))[0];
  const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
  const date = () => new Date().toISOString().slice(0, 10);
  const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const phone = value => String(value || '').replace(/\D/g, '').replace(/^0092/, '92').replace(/^0(?=3)/, '92');
  const roles = ['super_admin', 'company_admin', 'manager'];
  let queue = Promise.resolve();
  const ready = (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS water_club_members (company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, plan TEXT NOT NULL DEFAULT 'home', rewards_enabled INTEGER NOT NULL DEFAULT 1, first_order_id INTEGER, joined_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(company_id,customer_id))`,
      `CREATE TABLE IF NOT EXISTS water_club_products (company_id INTEGER NOT NULL, product_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('refill_19l','carton_15l','carton_500ml')), points INTEGER NOT NULL DEFAULT 5 CHECK(points >= 0), units_per_reward INTEGER NOT NULL DEFAULT 1 CHECK(units_per_reward > 0), active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(company_id,product_id))`,
      `CREATE TABLE IF NOT EXISTS water_club_settings (company_id INTEGER PRIMARY KEY, first_bonus INTEGER NOT NULL DEFAULT 5, referral_points INTEGER NOT NULL DEFAULT 20, redemption_points INTEGER NOT NULL DEFAULT 100)`,
      `CREATE TABLE IF NOT EXISTS water_club_orders (company_id INTEGER NOT NULL, order_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, reward INTEGER NOT NULL DEFAULT 0, stock_posted INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending', earned INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(company_id,order_id))`,
      `CREATE TABLE IF NOT EXISTS water_club_lots (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, transaction_id INTEGER NOT NULL UNIQUE, order_id INTEGER NOT NULL, points INTEGER NOT NULL, remaining INTEGER NOT NULL, expired INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL, reversed INTEGER NOT NULL DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS water_club_requests (company_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, kind TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(company_id,customer_id,kind,request_key))`,
      `CREATE TABLE IF NOT EXISTS water_club_referrals (company_id INTEGER NOT NULL, referral_id INTEGER NOT NULL, order_id INTEGER, PRIMARY KEY(company_id,referral_id))`
      ,`CREATE TABLE IF NOT EXISTS water_club_redemptions (company_id INTEGER NOT NULL, order_id INTEGER NOT NULL, lot_id INTEGER NOT NULL, points INTEGER NOT NULL, PRIMARY KEY(company_id,order_id,lot_id))`
    ];
    for (const sql of statements) await run(sql);
    await run(`CREATE TABLE IF NOT EXISTS water_club_commercial_terms (
      company_id INTEGER PRIMARY KEY, security_amount REAL, delivery_terms TEXT NOT NULL DEFAULT '',
      security_terms TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  })();
  ready.catch(() => {});
  function transaction(fn) {
    const result = queue.then(async () => {
      await ready;
      await run('BEGIN IMMEDIATE');
      try { const value = await fn(); await run('COMMIT'); return value; }
      catch (error) { await run('ROLLBACK'); throw error; }
    });
    queue = result.catch(() => {});
    return result;
  }
  const settings = async company => {
    await run('INSERT OR IGNORE INTO water_club_settings(company_id) VALUES(?)', [company]);
    return one('SELECT * FROM water_club_settings WHERE company_id = ?', [company]);
  };
  const audit = (req, action, entity, id, detail) => run('INSERT INTO audit_logs(company_id,user_id,action,entity_type,entity_id,new_value) VALUES(?,?,?,?,?,?)', [req.companyId, req.user.id, action, entity, id, JSON.stringify(detail)]);
  async function member(req) {
    const row = await one('SELECT * FROM water_club_members WHERE company_id = ? AND customer_id = ?', [req.companyId, req.user.customer_id]);
    if (!row) fail('Join Water Club before using this feature.', 409);
    return row;
  }
  async function account(company, customer) {
    await run('INSERT OR IGNORE INTO loyalty_accounts(company_id,customer_id) VALUES(?,?)', [company, customer]);
    return one('SELECT * FROM loyalty_accounts WHERE company_id = ? AND customer_id = ?', [company, customer]);
  }
  async function post(req, customer, order, type, points, key, description, earn = false) {
    const acc = await account(req.companyId, customer);
    const inserted = await run('INSERT OR IGNORE INTO loyalty_transactions(company_id,customer_id,account_id,order_id,type,points,description,idempotency_key,created_by) VALUES(?,?,?,?,?,?,?,?,?)', [req.companyId, customer, acc.id, order, type, points, description, key, req.user.id]);
    if (!inserted.changes) return;
    await run('UPDATE loyalty_accounts SET points_balance = MAX(0,points_balance + ?), lifetime_points = lifetime_points + ?, last_earned_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_earned_at END WHERE id = ?', [points, earn ? Math.max(0, points) : 0, points, acc.id]);
    if (earn && points > 0) await run("INSERT INTO water_club_lots(company_id,customer_id,transaction_id,order_id,points,remaining,expires_at) VALUES(?,?,?,?,?,?,datetime('now','+12 months'))", [req.companyId, customer, inserted.id, order || 0, points, points]);
  }
  async function expire(req, customer) {
    const lots = await all("SELECT * FROM water_club_lots WHERE company_id = ? AND customer_id = ? AND reversed = 0 AND remaining > 0 AND datetime(expires_at) <= datetime('now')", [req.companyId, customer]);
    for (const lot of lots) {
      await post(req, customer, lot.order_id, 'adjust', -lot.remaining, `wc:expiry:${lot.id}:${lot.expired}`, 'Water Club points expired');
      await run('UPDATE water_club_lots SET expired = expired + remaining, remaining = 0 WHERE id = ?', [lot.id]);
    }
  }
  const balance = async (company, customer) => Number((await one("SELECT COALESCE(SUM(points),0) AS balance FROM loyalty_transactions WHERE company_id = ? AND customer_id = ? AND idempotency_key LIKE 'wc:%'", [company, customer])).balance);
  async function reverse(req, order) {
    const lots = await all('SELECT * FROM water_club_lots WHERE company_id = ? AND order_id = ? AND reversed = 0', [req.companyId, order]);
    for (const lot of lots) {
      await post(req, lot.customer_id, order, 'refund', -(lot.points - lot.expired), `wc:reverse:${lot.id}`, 'Water Club order/referral points reversed');
      await run('UPDATE water_club_lots SET reversed = 1, remaining = 0 WHERE id = ?', [lot.id]);
    }
    await run("UPDATE referrals SET status = 'cancelled' WHERE company_id = ? AND id IN (SELECT referral_id FROM water_club_referrals WHERE company_id = ? AND order_id = ?)", [req.companyId, req.companyId, order]);
  }
  async function sync(req, customer) {
    await expire(req, customer);
    const orders = await all('SELECT w.*,o.status,o.total_amount FROM water_club_orders w JOIN orders o ON o.id = w.order_id AND o.company_id = w.company_id WHERE w.company_id = ? AND w.customer_id = ? ORDER BY w.order_id', [req.companyId, customer]);
    const m = await one('SELECT * FROM water_club_members WHERE company_id = ? AND customer_id = ?', [req.companyId, customer]);
    const cfg = await settings(req.companyId);
    for (const order of orders) {
      if (order.status === 'cancelled' || order.status === 'failed') {
        if (order.reward && !order.stock_posted && order.state !== 'cancelled') {
          // Use the stored debit, since a lot's original points can exceed its allocation.
          const debit = await one('SELECT points FROM loyalty_transactions WHERE company_id = ? AND idempotency_key = ?', [req.companyId,`wc:redeem:${order.order_id}`]);
          if (debit) {
            await post(req,customer,order.order_id,'adjust',-debit.points,`wc:redeem-cancel:${order.order_id}`,'Cancelled free refill points restored');
            for (const a of await all('SELECT a.points AS spent,l.id,l.reversed FROM water_club_redemptions a JOIN water_club_lots l ON l.id = a.lot_id WHERE a.company_id = ? AND a.order_id = ?', [req.companyId,order.order_id])) {
              if (!a.reversed) await run('UPDATE water_club_lots SET remaining = remaining + ? WHERE id = ?', [a.spent,a.id]);
            }
            await expire(req,customer);
          }
        }
        if (order.state === 'earned') await reverse(req, order.order_id);
        await run("UPDATE water_club_orders SET state = 'cancelled' WHERE company_id = ? AND order_id = ?", [req.companyId, order.order_id]);
        continue;
      }
      if (order.status !== 'delivered') continue;
      // ERP administrators/drivers confirm delivery. Post inventory only once.
      if (!order.stock_posted) {
        const items = await all('SELECT * FROM order_items WHERE company_id = ? AND order_id = ?', [req.companyId, order.order_id]);
        for (const item of items) {
          const changed = await run('UPDATE products SET stock = stock - ? WHERE id = ? AND company_id = ? AND stock >= ?', [item.quantity, item.product_id, req.companyId, item.quantity]);
          if (!changed.changes) fail('Insufficient stock to post delivered Water Club order.', 409);
          await run("INSERT INTO stock_movements(company_id,product_id,customer_id,movement_type,quantity,reference,created_by) VALUES(?,?,?,'stock_out',?,?,?)", [req.companyId, item.product_id, customer, -item.quantity, `WC-ORDER-${order.order_id}`, req.user.id]);
          await run('UPDATE order_items SET delivered_quantity = quantity WHERE id = ?', [item.id]);
        }
        await run('UPDATE water_club_orders SET stock_posted = 1 WHERE company_id = ? AND order_id = ?', [req.companyId, order.order_id]);
      }
      if (order.reward || order.state === 'cancelled' || order.state === 'reversed') continue;
      const paid = Number((await one("SELECT COALESCE(SUM(CASE WHEN direction = 'receipt' THEN amount WHEN direction = 'payment' THEN -amount ELSE 0 END),0) AS paid FROM payments WHERE company_id = ? AND order_id = ? AND party_type = 'customer'", [req.companyId, order.order_id])).paid);
      if (paid + 0.001 < order.total_amount || order.total_amount <= 0) {
        if (order.state === 'earned') {
          await reverse(req, order.order_id);
          await run("UPDATE water_club_orders SET state = 'reversed' WHERE company_id = ? AND order_id = ?", [req.companyId, order.order_id]);
        }
        continue;
      }
      if (order.state === 'earned' || !m?.rewards_enabled) continue;
      const items = await all('SELECT i.quantity,p.points,p.units_per_reward FROM order_items i JOIN water_club_products p ON p.product_id = i.product_id AND p.company_id = i.company_id WHERE i.company_id = ? AND i.order_id = ? AND p.active = 1', [req.companyId, order.order_id]);
      const points = items.reduce((sum, item) => sum + Math.floor(item.quantity / item.units_per_reward) * item.points, 0);
      if (!points) continue;
      await post(req, customer, order.order_id, 'earn', points, `wc:order:${order.order_id}`, 'Verified paid Water Club delivery', true);
      if (!m.first_order_id) {
        await post(req, customer, order.order_id, 'earn', cfg.first_bonus, `wc:first:${customer}`, 'First Water Club delivery bonus', true);
        await run('UPDATE water_club_members SET first_order_id = ? WHERE company_id = ? AND customer_id = ?', [order.order_id, req.companyId, customer]);
        m.first_order_id = order.order_id;
      }
      const referral = await one("SELECT r.* FROM referrals r JOIN water_club_referrals w ON w.referral_id = r.id AND w.company_id = r.company_id WHERE r.company_id = ? AND r.referred_customer_id = ? AND r.status = 'pending'", [req.companyId, customer]);
      if (referral && m.first_order_id === order.order_id) {
        const eligible = await one('SELECT rewards_enabled FROM water_club_members WHERE company_id = ? AND customer_id = ?', [req.companyId, referral.referrer_customer_id]);
        if (eligible?.rewards_enabled) {
          await post(req, referral.referrer_customer_id, order.order_id, 'referral_reward', cfg.referral_points, `wc:referral:${referral.id}`, 'First paid delivery referral reward', true);
          await run("UPDATE referrals SET status = 'rewarded',rewarded_at = CURRENT_TIMESTAMP WHERE id = ?", [referral.id]);
          await run('UPDATE water_club_referrals SET order_id = ? WHERE company_id = ? AND referral_id = ?', [order.order_id, req.companyId, referral.id]);
        }
      }
      await run("UPDATE water_club_orders SET state = 'earned',earned = ? WHERE company_id = ? AND order_id = ?", [points, req.companyId, order.order_id]);
      await audit(req, 'water_club_reward', 'order', order.order_id, { points });
    }
  }
  async function reconcile(req, customer) {
    const referrals = await all('SELECT r.referred_customer_id FROM referrals r JOIN water_club_referrals w ON w.company_id = r.company_id AND w.referral_id = r.id WHERE r.company_id = ? AND r.referrer_customer_id = ?', [req.companyId,customer]);
    for (const r of referrals) await sync(req,r.referred_customer_id);
    await sync(req,customer);
  }
  async function idempotent(req, kind, fn) {
    const key = String(req.body?.requestKey || '');
    if (!/^[A-Za-z0-9:_-]{8,100}$/.test(key)) fail('A unique requestKey of 8–100 characters is required.');
    const hash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    const previous = await one('SELECT * FROM water_club_requests WHERE company_id = ? AND customer_id = ? AND kind = ? AND request_key = ?', [req.companyId, req.user.customer_id, kind, key]);
    if (previous) { if (previous.request_hash !== hash) fail('This request key was used with different details.', 409); return JSON.parse(previous.response); }
    const response = await fn();
    await run('INSERT INTO water_club_requests VALUES(?,?,?,?,?,?)', [req.companyId, req.user.customer_id, kind, key, hash, JSON.stringify(response)]);
    return response;
  }
  async function createOrder(req, items, reward = false) {
    const customer = await one('SELECT * FROM customers WHERE id = ? AND company_id = ?', [req.user.customer_id, req.companyId]);
    if (!customer) fail('Customer not found.', 404);
    let total = 0; const rows = []; const seen = new Set();
    if (!Array.isArray(items) || !items.length || items.length > 20) fail('Select between 1 and 20 products.');
    for (const item of items) {
      const quantity = Number(item.quantity), id = Number(item.productId);
      const product = await one('SELECT p.*,w.kind FROM products p JOIN water_club_products w ON w.product_id = p.id AND w.company_id = p.company_id WHERE p.company_id = ? AND p.id = ? AND w.active = 1', [req.companyId, id]);
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000 || seen.has(id)) fail('Product/quantity invalid or repeated.');
      if (product.stock < quantity) fail('Insufficient product stock.', 409);
      seen.add(id); const price = reward ? 0 : Number(product.sale_price); total += price * quantity; rows.push({ product, quantity, price });
    }
    const order = await run('INSERT INTO orders(company_id,customer_id,customer_name,delivery_address,notes,total_amount,created_by) VALUES(?,?,?,?,?,?,?)', [req.companyId, customer.id, customer.name, String(req.body?.deliveryAddress || customer.address || '').slice(0, 500), reward ? 'Water Club reward: free 19L refill' : 'Water Club order', total, req.user.id]);
    for (const row of rows) await run('INSERT INTO order_items(company_id,order_id,product_id,quantity,unit_price,total_price) VALUES(?,?,?,?,?,?)', [req.companyId, order.id, row.product.id, row.quantity, row.price, row.quantity * row.price]);
    await run('INSERT INTO water_club_orders(company_id,order_id,customer_id,reward) VALUES(?,?,?,?)', [req.companyId, order.id, customer.id, reward ? 1 : 0]);
    await audit(req, 'water_club_order', 'order', order.id, { total, reward });
    return { id: order.id, total_amount: total, status: 'pending', reward };
  }
  function registerRoutes(app, requireCustomer, requireRole) {
    const route = (method, url, guard, fn) => app[method](url, guard, async (req, res) => {
      try { res.json(await transaction(() => fn(req))); } catch (e) { res.status(e.status || 500).json({ message: e.status ? e.message : 'Water Club request could not be completed.' }); }
    });
    route('post', '/api/customer/water-club/membership', requireCustomer, async req => {
      const plan = String(req.body?.plan || 'home');
      if (!['home', 'family', 'office', 'business'].includes(plan)) fail('Choose a valid plan.');
      await run('INSERT OR IGNORE INTO water_club_members(company_id,customer_id,plan,rewards_enabled) VALUES(?,?,?,?)', [req.companyId, req.user.customer_id, plan, plan === 'business' ? 0 : 1]);
      await audit(req, 'water_club_join', 'customer', req.user.customer_id, { plan });
      return member(req);
    });
    route('get', '/api/customer/water-club/catalog', requireCustomer, req => all('SELECT p.id,p.name,p.sale_price,p.stock,w.kind,w.points,w.units_per_reward FROM products p JOIN water_club_products w ON w.company_id = p.company_id AND w.product_id = p.id WHERE p.company_id = ? AND w.active = 1 ORDER BY p.id', [req.companyId]));
    route('post', '/api/customer/water-club/orders', requireCustomer, async req => { await member(req); return idempotent(req, 'order', () => createOrder(req, req.body?.items)); });
    route('get', '/api/customer/water-club/rewards', requireCustomer, async req => {
      const m = await member(req); await reconcile(req, m.customer_id); const cfg = await settings(req.companyId); const net = await balance(req.companyId, m.customer_id);
      return { member: m, points: Math.max(0, net), pointsDebt: Math.max(0, -net), redemptionPoints: cfg.redemption_points, transactions: await all("SELECT type,points,description,created_at,order_id FROM loyalty_transactions WHERE company_id = ? AND customer_id = ? AND idempotency_key LIKE 'wc:%' ORDER BY id DESC LIMIT 100", [req.companyId, m.customer_id]) };
    });
    route('post', '/api/customer/water-club/rewards/redeem', requireCustomer, async req => {
      const m = await member(req); await reconcile(req, m.customer_id);
      return idempotent(req, 'redeem', async () => {
        const cfg = await settings(req.companyId);
        if (!m.rewards_enabled || await balance(req.companyId, m.customer_id) < cfg.redemption_points) fail('Not enough eligible points.', 409);
        const product = await one("SELECT product_id FROM water_club_products WHERE company_id = ? AND kind = 'refill_19l' AND active = 1 ORDER BY product_id LIMIT 1", [req.companyId]);
        if (!product) fail('19L refill reward product is not configured.', 409);
        const order = await createOrder(req, [{ productId: product.product_id, quantity: 1 }], true);
        let remaining = cfg.redemption_points;
        const lots = await all("SELECT * FROM water_club_lots WHERE company_id = ? AND customer_id = ? AND remaining > 0 AND reversed = 0 AND datetime(expires_at) > datetime('now') ORDER BY expires_at,id", [req.companyId, m.customer_id]);
        for (const lot of lots) { const spent = Math.min(remaining, lot.remaining); await run('UPDATE water_club_lots SET remaining = remaining - ? WHERE id = ?', [spent, lot.id]); await run('INSERT INTO water_club_redemptions VALUES(?,?,?,?)', [req.companyId,order.id,lot.id,spent]); remaining -= spent; if (!remaining) break; }
        if (remaining) fail('Eligible points are unavailable.', 409);
        await post(req, m.customer_id, order.id, 'redeem', -cfg.redemption_points, `wc:redeem:${order.id}`, 'Free 19L refill redemption');
        return order;
      });
    });
    route('get', '/api/customer/water-club/referrals', requireCustomer, async req => {
      const m = await member(req);
      await reconcile(req,m.customer_id);
      await run('INSERT OR IGNORE INTO referral_codes(company_id,customer_id,code,reward_points) VALUES(?,?,?,20)', [req.companyId, m.customer_id, `TEMO-${crypto.randomBytes(8).toString('hex').toUpperCase()}`]);
      const code = await one('SELECT code,status FROM referral_codes WHERE company_id = ? AND customer_id = ?', [req.companyId, m.customer_id]);
      return { ...code, referrals: await all('SELECT r.status,r.rewarded_at,r.created_at FROM referrals r JOIN water_club_referrals w ON w.referral_id = r.id AND w.company_id = r.company_id WHERE r.company_id = ? AND r.referrer_customer_id = ?', [req.companyId, m.customer_id]) };
    });
    route('post', '/api/customer/water-club/referrals', requireCustomer, async req => {
      const m = await member(req);
      const code = await one("SELECT * FROM referral_codes WHERE company_id = ? AND UPPER(code) = UPPER(?) AND status = 'active'", [req.companyId, String(req.body?.code || '').trim()]);
      if (!code || code.customer_id === m.customer_id) fail('Invalid referral code or self-referral.');
      const people = await all('SELECT id,phone FROM customers WHERE company_id = ? AND id IN (?,?)', [req.companyId, m.customer_id, code.customer_id]);
      if (people.length !== 2 || !phone(people[0].phone) || !phone(people[1].phone) || phone(people[0].phone) === phone(people[1].phone)) fail('Referral requires two different customer phone numbers.');
      if (m.first_order_id || await one("SELECT id FROM orders WHERE company_id = ? AND customer_id = ? AND status = 'delivered' LIMIT 1", [req.companyId, m.customer_id])) fail('Referral must be linked before the first completed delivery.', 409);
      if (await one('SELECT id FROM referrals WHERE company_id = ? AND referred_customer_id = ?', [req.companyId, m.customer_id])) fail('A referral is already linked.', 409);
      const r = await run('INSERT INTO referrals(company_id,referral_code_id,referrer_customer_id,referred_customer_id) VALUES(?,?,?,?)', [req.companyId, code.id, code.customer_id, m.customer_id]);
      await run('INSERT INTO water_club_referrals(company_id,referral_id) VALUES(?,?)', [req.companyId, r.id]);
      await audit(req, 'water_club_referral', 'referral', r.id, { status: 'pending' });
      return { status: 'pending' };
    });
    route('post', '/api/customer/water-club/subscriptions', requireCustomer, async req => {
      await member(req);
      return idempotent(req, 'subscription', async () => {
        const b = req.body || {}, quantity = Number(b.quantity);
        const product = await one('SELECT p.* FROM products p JOIN water_club_products w ON w.product_id = p.id AND w.company_id = p.company_id WHERE p.id = ? AND p.company_id = ? AND w.active = 1', [Number(b.productId), req.companyId]);
        if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 10000) fail('Choose a valid product and quantity.');
        if (!['daily','alternate_days','weekly','monthly','custom'].includes(b.frequency) || !iso(b.startDate) || b.startDate < date() || (b.endDate && (!iso(b.endDate) || b.endDate < b.startDate))) fail('Invalid frequency or dates.');
        if (b.frequency === 'custom' && (!Number.isInteger(Number(b.customInterval)) || Number(b.customInterval) < 1 || Number(b.customInterval) > 365 || !['days','weeks','months'].includes(b.customUnit))) fail('Invalid custom interval.');
        const customer = await one('SELECT address FROM customers WHERE id = ? AND company_id = ?', [req.user.customer_id, req.companyId]);
        const result = await run('INSERT INTO delivery_subscriptions(company_id,customer_id,product_id,quantity,unit_price,frequency,custom_interval,custom_unit,start_date,end_date,next_due_date,delivery_address,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', [req.companyId, req.user.customer_id, product.id, quantity, product.sale_price, b.frequency, b.frequency === 'custom' ? Number(b.customInterval) : null, b.frequency === 'custom' ? b.customUnit : null, b.startDate, b.endDate || null, b.startDate, String(b.deliveryAddress || customer.address || '').slice(0, 500), req.user.id]);
        await audit(req, 'water_club_schedule', 'delivery_subscription', result.id, { frequency: b.frequency, quantity });
        return one('SELECT * FROM delivery_subscriptions WHERE id = ?', [result.id]);
      });
    });
    route('post', '/api/customer/water-club/subscriptions/:id/:action', requireCustomer, async req => {
      return idempotent(req,`schedule:${req.params.id}:${req.params.action}`,async () => {
      const s = await one('SELECT * FROM delivery_subscriptions WHERE company_id = ? AND customer_id = ? AND id = ?', [req.companyId, req.user.customer_id, Number(req.params.id)]);
      if (!s) fail('Schedule not found.', 404);
      const action = req.params.action;
      if (!['pause','resume','skip','cancel'].includes(action) || ['completed','cancelled'].includes(s.status)) fail('Schedule action not allowed.');
      if (action === 'skip') {
        if (s.status !== 'active') fail('Only active schedules can be skipped.');
        await run("INSERT OR IGNORE INTO delivery_subscription_occurrences(company_id,delivery_subscription_id,due_date,status) VALUES(?,?,?,'skipped')", [req.companyId, s.id, s.next_due_date]);
        const next = nextDate(s.next_due_date, s);
        await run('UPDATE delivery_subscriptions SET next_due_date = ?,status = ? WHERE id = ?', [next, s.end_date && next > s.end_date ? 'completed' : 'active', s.id]);
      } else {
        if (action === 'resume' && s.end_date && s.end_date < date()) fail('Schedule has ended.');
        await run('UPDATE delivery_subscriptions SET status = ?,next_due_date = CASE WHEN ? = 1 AND next_due_date < ? THEN ? ELSE next_due_date END WHERE id = ?', [action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'active', action === 'resume' ? 1 : 0, date(), date(), s.id]);
      }
      await audit(req, 'water_club_schedule_action', 'delivery_subscription', s.id, { action });
      return one('SELECT * FROM delivery_subscriptions WHERE id = ?', [s.id]);
      });
    });
    route('get', '/api/customer/water-club/deliveries', requireCustomer, async req => { await sync(req, req.user.customer_id); return all('SELECT d.id,d.order_id,d.status,d.scheduled_date,d.delivered_at FROM deliveries d JOIN orders o ON o.id = d.order_id AND o.company_id = d.company_id WHERE o.company_id = ? AND o.customer_id = ? ORDER BY d.id DESC LIMIT 100', [req.companyId, req.user.customer_id]); });
    route('get', '/api/water-club/admin', requireRole(...roles), req => all('SELECT m.*,c.name,c.phone FROM water_club_members m JOIN customers c ON c.id = m.customer_id AND c.company_id = m.company_id WHERE m.company_id = ? ORDER BY m.joined_at DESC', [req.companyId]));
    route('get', '/api/water-club/admin/config', requireRole(...roles), async req => ({ settings: await settings(req.companyId), products: await all('SELECT * FROM water_club_products WHERE company_id = ?', [req.companyId]) }));
    // Commercial terms are company-owned preparation records. They do not
    // rewrite historical payments, deposits or order totals.
    route('get', '/api/water-club/admin/commercial', requireRole(...roles), async req =>
      await one('SELECT * FROM water_club_commercial_terms WHERE company_id = ?', [req.companyId]) ||
      { company_id: req.companyId, security_amount: null, security_terms: '', delivery_terms: '' });
    route('post', '/api/water-club/admin/commercial', requireRole('super_admin','company_admin'), async req => {
      const b = req.body || {};
      const amount = b.securityAmount;
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 10000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) fail('Enter a non-negative security amount with at most two decimals.');
      if (typeof b.securityTerms !== 'string' || typeof b.deliveryTerms !== 'string' || !b.securityTerms.trim() || !b.deliveryTerms.trim() || b.securityTerms.length > 2000 || b.deliveryTerms.length > 2000) fail('Security and delivery terms are required (maximum 2000 characters each).');
      await run(`INSERT INTO water_club_commercial_terms(company_id,security_amount,security_terms,delivery_terms) VALUES(?,?,?,?)
        ON CONFLICT(company_id) DO UPDATE SET security_amount=excluded.security_amount,security_terms=excluded.security_terms,delivery_terms=excluded.delivery_terms,updated_at=CURRENT_TIMESTAMP`,
        [req.companyId,amount,b.securityTerms.trim(),b.deliveryTerms.trim()]);
      await audit(req,'water_club_commercial_terms','company',req.companyId,{ securityAmount:amount,securityTerms:b.securityTerms,deliveryTerms:b.deliveryTerms });
      return { success:true };
    });
    route('post', '/api/water-club/admin/prices', requireRole('super_admin','company_admin'), async req => {
      const b = req.body || {}, price = b.salePrice;
      if (!Number.isInteger(b.productId) || typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > 10000000 || Math.abs(price * 100 - Math.round(price * 100)) > 0.000001) fail('Choose a product and a positive price with at most two decimals.');
      const before = await one('SELECT sale_price FROM products WHERE id = ? AND company_id = ?', [b.productId,req.companyId]);
      if (!before) fail('Company product not found.',404);
      await run('UPDATE products SET sale_price = ? WHERE id = ? AND company_id = ?', [price,b.productId,req.companyId]);
      await audit(req,'water_club_price','product',b.productId,{ previous:before.sale_price,salePrice:price });
      return { success:true };
    });
    route('post', '/api/water-club/admin/settings', requireRole(...roles), async req => {
      const b = req.body || {}, values = [Number(b.firstBonus),Number(b.referralPoints),Number(b.redemptionPoints)];
      if (values.some(v => !Number.isInteger(v) || v < 0 || v > 10000) || !values[2]) fail('Invalid point settings.');
      await settings(req.companyId);
      await run('UPDATE water_club_settings SET first_bonus = ?,referral_points = ?,redemption_points = ? WHERE company_id = ?', [...values,req.companyId]);
      await audit(req,'water_club_rules','company',req.companyId,b);
      return settings(req.companyId);
    });
    route('get', '/api/water-club/admin/orders', requireRole(...roles), async req => {
      const members = await all('SELECT customer_id FROM water_club_members WHERE company_id = ?', [req.companyId]);
      for (const m of members) await sync(req,m.customer_id);
      return all("SELECT w.*,o.customer_name,o.total_amount,o.status,(SELECT COALESCE(SUM(CASE WHEN p.direction = 'receipt' THEN p.amount ELSE -p.amount END),0) FROM payments p WHERE p.company_id = o.company_id AND p.order_id = o.id AND p.party_type = 'customer') AS paid FROM water_club_orders w JOIN orders o ON o.id = w.order_id AND o.company_id = w.company_id WHERE w.company_id = ? ORDER BY o.id DESC LIMIT 200", [req.companyId]);
    });
    route('post', '/api/water-club/admin/orders/:id/payment', requireRole(...roles), async req => {
      const order = await one('SELECT o.* FROM orders o JOIN water_club_orders w ON w.order_id = o.id AND w.company_id = o.company_id WHERE o.id = ? AND o.company_id = ?', [Number(req.params.id),req.companyId]);
      if (!order || order.total_amount <= 0) fail('Paid Water Club order not found.',404);
      const scope = { ...req,user:{ ...req.user,customer_id:order.customer_id } };
      return idempotent(scope,'payment',async () => {
        const b = req.body || {}, amount = Number(b.amount), direction = b.direction || 'receipt';
        if (!Number.isFinite(amount) || amount <= 0 || !['receipt','payment'].includes(direction) || !String(b.method || '').trim() || !String(b.reference || '').trim()) fail('Amount, method and confirmation reference are required.');
        const net = Number((await one("SELECT COALESCE(SUM(CASE WHEN direction = 'receipt' THEN amount ELSE -amount END),0) AS paid FROM payments WHERE company_id = ? AND order_id = ? AND party_type = 'customer'", [req.companyId,order.id])).paid);
        if (direction === 'receipt' && net + amount > order.total_amount + .001 || direction === 'payment' && amount > net + .001) fail('Payment/refund exceeds outstanding or paid amount.');
        const result = await run('INSERT INTO payments(company_id,customer_id,customer_name,amount,method,note,direction,party_type,reference,created_by,order_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [req.companyId,order.customer_id,order.customer_name,amount,String(b.method).slice(0,40),direction === 'receipt' ? 'Water Club verified payment' : 'Water Club refund',direction,'customer',String(b.reference).slice(0,160),req.user.id,order.id]);
        await audit(req,'water_club_payment','payment',result.id,{ amount,direction,reference:b.reference });
        await sync(req,order.customer_id);
        return { id:result.id,amount,direction };
      });
    });
    route('post', '/api/water-club/admin/products', requireRole(...roles), async req => {
      const b = req.body || {};
      if (!['refill_19l','carton_15l','carton_500ml'].includes(b.kind) || !await one('SELECT id FROM products WHERE id = ? AND company_id = ?', [Number(b.productId), req.companyId])) fail('Choose an existing company product and valid reward kind.');
      const points = Number(b.points ?? 5), units = Number(b.unitsPerReward ?? 1);
      if (!Number.isInteger(points) || points < 0 || points > 1000 || !Number.isInteger(units) || units < 1 || units > 1000 || (b.kind === 'refill_19l' && units !== 1)) fail('Invalid reward configuration.');
      await run('INSERT INTO water_club_products(company_id,product_id,kind,points,units_per_reward,active) VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,product_id) DO UPDATE SET kind=excluded.kind,points=excluded.points,units_per_reward=excluded.units_per_reward,active=excluded.active', [req.companyId, Number(b.productId), b.kind, points, units, b.active === false ? 0 : 1]);
      await audit(req, 'water_club_catalog', 'product', b.productId, { kind: b.kind, points, units });
      return { success: true };
    });
    route('post', '/api/water-club/admin/members/:id', requireRole(...roles), async req => {
      if (typeof req.body?.rewardsEnabled !== 'boolean') fail('rewardsEnabled must be true or false.');
      const changed = await run('UPDATE water_club_members SET rewards_enabled = ? WHERE company_id = ? AND customer_id = ?', [req.body.rewardsEnabled ? 1 : 0, req.companyId, Number(req.params.id)]);
      if (!changed.changes) fail('Member not found.', 404);
      await audit(req, 'water_club_rewards_access', 'customer', req.params.id, req.body);
      return { success: true };
    });
    route('post', '/api/water-club/admin/members/:id/points', requireRole(...roles), async req => {
      const customer = Number(req.params.id), b = req.body || {}, points = Number(b.points);
      if (!await one('SELECT customer_id FROM water_club_members WHERE company_id = ? AND customer_id = ?', [req.companyId,customer])) fail('Member not found.',404);
      if (!Number.isInteger(points) || !points || Math.abs(points) > 1000000 || !String(b.reason || '').trim()) fail('A whole-number adjustment and reason are required.');
      return idempotent({ ...req,user:{ ...req.user,customer_id:customer } },'adjust',async () => {
        await reconcile(req,customer);await expire(req,customer);
        if (points < 0 && await balance(req.companyId,customer) + points < 0) fail('Adjustment exceeds available points.',409);
        if (points < 0) {
          let remaining = -points;
          for (const lot of await all("SELECT * FROM water_club_lots WHERE company_id = ? AND customer_id = ? AND remaining > 0 AND reversed = 0 AND datetime(expires_at) > datetime('now') ORDER BY expires_at,id", [req.companyId,customer])) {
            const used = Math.min(remaining,lot.remaining);await run('UPDATE water_club_lots SET remaining = remaining - ? WHERE id = ?', [used,lot.id]);remaining -= used;if(!remaining)break;
          }
        }
        await post(req,customer,null,'adjust',points,`wc:manual:${customer}:${b.requestKey}`,String(b.reason).slice(0,240),points > 0);
        await audit(req,'water_club_points_adjust','customer',customer,{ points,reason:b.reason });
        return { points:Math.max(0,await balance(req.companyId,customer)) };
      });
    });
  }
  function nextDate(value, s) {
    const d = new Date(value + 'T00:00:00Z');
    const months = s.frequency === 'monthly' ? 1 : s.frequency === 'custom' && s.custom_unit === 'months' ? s.custom_interval : 0;
    if (months) { const day = Number(s.start_date.slice(8,10)); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + Number(months)); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1,0)).getUTCDate(); d.setUTCDate(Math.min(day,last)); }
    else d.setUTCDate(d.getUTCDate() + (s.frequency === 'daily' ? 1 : s.frequency === 'alternate_days' ? 2 : s.frequency === 'weekly' ? 7 : s.custom_unit === 'weeks' ? Number(s.custom_interval)*7 : Number(s.custom_interval)));
    return d.toISOString().slice(0,10);
  }
  function generateDue(req, upToDate, clubOnly = false) {
    return transaction(async () => {
      if (!iso(upToDate)) fail('Invalid upToDate.');
      const schedules = await all("SELECT * FROM delivery_subscriptions WHERE company_id = ? AND status = 'active' AND next_due_date <= ? AND (? = 0 OR EXISTS (SELECT 1 FROM water_club_members m WHERE m.company_id = delivery_subscriptions.company_id AND m.customer_id = delivery_subscriptions.customer_id)) ORDER BY id", [req.companyId, upToDate,clubOnly ? 1 : 0]);
      const generated = [];
      for (const s of schedules) {
        let due = s.next_due_date, guard = 0;
        while (due <= upToDate && (!s.end_date || due <= s.end_date) && guard++ < 366) {
          await run("INSERT OR IGNORE INTO delivery_subscription_occurrences(company_id,delivery_subscription_id,due_date,status) VALUES(?,?,?,'pending')", [req.companyId,s.id,due]);
          const occurrence = await one('SELECT * FROM delivery_subscription_occurrences WHERE company_id = ? AND delivery_subscription_id = ? AND due_date = ?', [req.companyId,s.id,due]);
          if (occurrence.status === 'pending') {
            const customer = await one('SELECT * FROM customers WHERE company_id = ? AND id = ?', [req.companyId,s.customer_id]);
            const order = await run('INSERT INTO orders(company_id,customer_id,customer_name,delivery_address,notes,total_amount,created_by,delivery_subscription_id,subscription_occurrence_id) VALUES(?,?,?,?,?,?,?,?,?)', [req.companyId,s.customer_id,customer.name,s.delivery_address,`Recurring delivery ${due}`,s.unit_price*s.quantity,req.user.id,s.id,occurrence.id]);
            await run('INSERT INTO order_items(company_id,order_id,product_id,quantity,unit_price,total_price) VALUES(?,?,?,?,?,?)', [req.companyId,order.id,s.product_id,s.quantity,s.unit_price,s.quantity*s.unit_price]);
            if (await one('SELECT customer_id FROM water_club_members WHERE company_id = ? AND customer_id = ?', [req.companyId,s.customer_id])) await run('INSERT INTO water_club_orders(company_id,order_id,customer_id) VALUES(?,?,?)', [req.companyId,order.id,s.customer_id]);
            await run("UPDATE delivery_subscription_occurrences SET status = 'generated',order_id = ? WHERE id = ?", [order.id,occurrence.id]);
            generated.push({ orderId:order.id,subscriptionId:s.id,dueDate:due });
          }
          due = nextDate(due,s);
        }
        await run('UPDATE delivery_subscriptions SET next_due_date = ?,status = ? WHERE id = ?', [due,s.end_date && due > s.end_date ? 'completed' : 'active',s.id]);
      }
      if(generated.length) await audit(req,'water_club_generate','company',req.companyId,{ count:generated.length,upToDate });
      return { generated,count:generated.length };
    });
  }
  const setOrderStatus = (req,id,status) => transaction(async () => {
    const order = await one('SELECT * FROM orders WHERE company_id = ? AND id = ?', [req.companyId,id]);
    if (!order) fail('Order not found.',404);
    if (['driver','delivery_driver'].includes(req.user.role) && !await one('SELECT id FROM deliveries WHERE company_id = ? AND order_id = ? AND driver_id = ?', [req.companyId,id,req.user.id])) fail('Only assigned driver may update delivery.',403);
    if (order.status === 'delivered' && !['delivered','cancelled'].includes(status)) fail('Delivered orders cannot return to an earlier status.',409);
    if (['cancelled','failed'].includes(order.status) && status !== order.status) fail('Terminal Water Club orders cannot be reopened.',409);
    await run('UPDATE orders SET status = ?,updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND id = ?', [status,req.companyId,id]);
    await sync(req,order.customer_id);
    await audit(req,'water_club_status','order',id,{ status });
  });
  return { registerRoutes, generateDue, nextDate, setOrderStatus, syncCustomer: req => transaction(() => sync(req, req.user.customer_id)), syncOrder: (req, id) => transaction(async () => { const o = await one('SELECT customer_id FROM water_club_orders WHERE company_id = ? AND order_id = ?', [req.companyId,id]); if(o) await sync(req,o.customer_id); }), isClubOrder: async (company,id) => { await ready; return Boolean(await one('SELECT order_id FROM water_club_orders WHERE company_id = ? AND order_id = ?', [company,id])); } };
}
module.exports = { createWaterClubService };

