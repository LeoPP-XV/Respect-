// 熱狗堡點餐系統 — 零依賴,Node.js >= 16。資料存在 data/db.json
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000, PIN = process.env.PIN || '103103';
const DATA = path.join(__dirname, 'data', 'db.json'), PUB = path.join(__dirname, 'public');

let db = {
  menu: [
    { id: 'hd1', name: '原味熱狗堡', cat: 'food', price: 55 },
    { id: 'hd2', name: '起司玉米熱狗堡', cat: 'food', price: 70 },
    { id: 'dr1', name: '紅茶', cat: 'drink', price: 35 },
    { id: 'dr2', name: '冬瓜茶', cat: 'drink', price: 35 },
    { id: 'dr3', name: '冬瓜檸檬', cat: 'drink', price: 45 },
  ], orders: [], seq: 0, seqDate: '',
};
try { db = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch {}
const save = () => { fs.mkdirSync(path.dirname(DATA), { recursive: true }); fs.writeFileSync(DATA, JSON.stringify(db, null, 1)); };
const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD

// 折扣(依此順序套用,每項套用在剩餘金額上)。抽籤系統另外處理,櫃檯收款時勾選即可
const DISCOUNTS = {
  social: { label: '追班帳+發限動 折5', fn: t => Math.min(5, t) },
  p2: { label: '二獎 67折(最高折40)', fn: t => Math.min(Math.round(t * 0.33), 40) },
  sp: { label: '特獎 5折(最高折50)', fn: t => Math.min(Math.floor(t * 0.5), 50) },
  p6: { label: '六獎 折25', fn: t => Math.min(25, t) },
  p4: { label: '四獎 飲料一瓶(折最便宜的一杯)', fn: (t, o) => { const d = o.items.filter(i => i.cat === 'drink').map(i => i.price); return d.length ? Math.min(...d, t) : 0; } },
};
function applyDiscount(o, keys = []) {
  let rem = o.subtotal; o.discounts = [];
  for (const k of Object.keys(DISCOUNTS).filter(k => keys.includes(k))) {
    const a = Math.min(DISCOUNTS[k].fn(rem, o), rem);
    if (a > 0) { rem -= a; o.discounts.push({ key: k, label: DISCOUNTS[k].label, amount: a }); }
  }
  o.total = rem;
}
const isReady = o => o.paid && !o.void && !o.picked && ['food', 'drink'].every(k => o[k] === 'done' || o[k] === 'none');

function makeOrder(body) {
  const items = [];
  for (const r of body.items || []) {
    const m = db.menu.find(x => x.id === r.id), q = Math.min(Math.max(parseInt(r.qty) || 0, 0), 20);
    if (m && !m.soldOut && q) items.push({ id: m.id, name: m.name, cat: m.cat, price: m.price, qty: q });
  }
  if (!items.length) return null;
  const d = today(); if (db.seqDate !== d) { db.seqDate = d; db.seq = 0; } // 單號每日從 001 重新開始
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const o = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), no: ++db.seq, date: d, time: Date.now(),
    items, subtotal, discounts: [], total: subtotal, note: String(body.note || '').slice(0, 100),
    paid: false, void: false, picked: false,
    food: items.some(i => i.cat === 'food') ? 'wait' : 'none', drink: items.some(i => i.cat === 'drink') ? 'wait' : 'none',
  };
  db.orders.push(o); return o;
}

const clients = new Set();
const push = () => { save(); clients.forEach(r => r.write('data: u\n\n')); };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const types = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8' };

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (!url.startsWith('/api/')) {
    const f = path.join(PUB, url === '/' ? 'index.html' : url);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(res);
  }
  let buf = ''; req.on('data', c => (buf += c));
  req.on('end', () => {
    let b = {}; try { b = JSON.parse(buf || '{}'); } catch {}
    const auth = req.headers['x-pin'] === PIN, m = req.method;
    const labels = Object.fromEntries(Object.entries(DISCOUNTS).map(([k, v]) => [k, v.label]));
    // —— 公開 API(客人點餐用)——
    if (url === '/api/state') {
      const t = today();
      return send(res, 200, {
        menu: db.menu, discounts: labels, today: t,
        ready: db.orders.filter(o => o.date === t && isReady(o)).map(o => o.no),
        orders: auth ? db.orders : [],
      });
    }
    if (url === '/api/login') return send(res, auth ? 200 : 401, { ok: auth });
    if (url === '/api/orders' && m === 'POST') {
      const o = makeOrder(b); if (!o) return send(res, 400, { error: '沒有可點的商品' });
      push(); return send(res, 200, { no: o.no, id: o.id });
    }
    // —— 以下需要系統密碼 ——
    if (!auth) return send(res, 401, { error: '需要密碼' });
    const om = url.match(/^\/api\/orders\/(\w+)\/(\w+)$/);
    if (om && m === 'POST') {
      const o = db.orders.find(x => x.id === om[1]); if (!o) return send(res, 404, { error: '找不到訂單' });
      const act = om[2];
      if (act === 'preview') { const c = { ...o }; applyDiscount(c, b.discounts); return send(res, 200, { total: c.total, discounts: c.discounts }); }
      if (act === 'pay') {
        if (o.void || o.paid) return send(res, 400, { error: '訂單狀態不可收款' });
        applyDiscount(o, b.discounts); o.paid = true; o.paidAt = Date.now();
      } else if (act === 'void') { o.void = true; o.voidAt = Date.now(); }
      else if (act === 'set') {
        if (['food', 'drink'].includes(b.field) && o[b.field] !== 'none' && ['wait', 'making', 'done'].includes(b.value)) o[b.field] = b.value;
        else if (b.field === 'picked') o.picked = !!b.value;
        else return send(res, 400, { error: '參數錯誤' });
      } else return send(res, 404, { error: 'unknown' });
      push(); return send(res, 200, { ok: true });
    }
    if (url === '/api/menu' && m === 'POST') {
      if (!b.name || !['food', 'drink'].includes(b.cat) || !(b.price >= 0)) return send(res, 400, { error: '資料不完整' });
      db.menu.push({ id: 'm' + Date.now().toString(36), name: String(b.name).slice(0, 30), cat: b.cat, price: Math.round(b.price) });
      push(); return send(res, 200, { ok: true });
    }
    const mm = url.match(/^\/api\/menu\/(\w+)$/);
    if (mm && m === 'PUT') {
      const it = db.menu.find(x => x.id === mm[1]); if (!it) return send(res, 404, { error: '找不到品項' });
      if (b.price >= 0) it.price = Math.round(b.price);
      if (typeof b.soldOut === 'boolean') it.soldOut = b.soldOut;
      push(); return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'unknown' });
  });
}).listen(PORT, '0.0.0.0', () => console.log(`點餐系統啟動:http://localhost:${PORT}  (系統密碼 ${PIN})`));
