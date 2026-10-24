const $ = s => document.querySelector(s), app = $('#app');
const pad = n => String(n).padStart(3, '0');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = t => new Date(t).toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
const sum = o => o.items.map(i => `${esc(i.name)}×${i.qty}`).join('、');
const isReady = o => o.paid && !o.void && !o.picked && ['food', 'drink'].every(k => o[k] === 'done' || o[k] === 'none');
let S = { menu: [], orders: [], ready: [], discounts: {}, today: '' }, view = 'home', pin = sessionStorage.pin || '', cart = {}, sel = {}, adminDate = '';

async function api(m, u, b) {
  const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json', 'x-pin': pin }, body: b ? JSON.stringify(b) : undefined });
  if (r.status === 401 && u !== '/api/login') { logout(); return {}; }
  return r.json();
}
async function load() {
  S = await api('GET', '/api/state');
  if (view === 'order') ready(); else if (!['login', 'done', 'home'].includes(view)) render();
}
const ready = () => { const e = $('#ready'); if (e) e.innerHTML = S.ready.length ? '🔔 可取餐:' + S.ready.map(n => `<b>#${pad(n)}</b>`).join(' ') : ''; };
const go = v => { view = v; render(); };
function logout() { pin = ''; delete sessionStorage.pin; go('home'); }
const SYS = ['counter', 'new', 'drink', 'kitchen', 'admin'];

function render() {
  if (SYS.includes(view) && !pin) return go('login');
  const V = {
    home: () => `<div class="home"><h1>🌭 熱狗堡點餐</h1><button class="pri" onclick="go('order')">點餐</button><button onclick="go(pin?'counter':'login')">系統</button></div>`,
    order: () => `<button onclick="go('home')">← 返回</button><div id="ready"></div>${menuUI()}`,
    login: () => `<button onclick="go('home')">← 返回</button><div class="home"><h2>輸入系統密碼</h2><input id="pw" type="password" inputmode="numeric" autofocus onkeydown="if(event.key==='Enter')login()"><button class="pri" onclick="login()">進入系統</button><p id="err" style="color:var(--red)"></p></div>`,
    new: () => nav() + menuUI(true),
    counter: counterV, drink: () => stationV('drink'), kitchen: () => stationV('food'), admin: adminV,
  };
  app.innerHTML = V[view]();
  if (view === 'order') ready();
  if (view === 'counter') S.orders.filter(o => !o.paid && !o.void && (sel[o.id] || []).length).forEach(o => prev(o.id));
  if (view === 'login') $('#pw').focus();
}
const nav = () => `<nav>${[['counter', '櫃檯'], ['drink', '飲料'], ['kitchen', '後廚'], ['admin', '後台']].map(([v, t]) =>
  `<a tabindex="0" class="${view === v || (v === 'counter' && view === 'new') ? 'on' : ''}" onclick="go('${v}')">${t}</a>`).join('')}<a tabindex="0" onclick="logout()">登出</a></nav>`;

async function login() {
  const p = $('#pw').value, r = await fetch('/api/login', { method: 'POST', headers: { 'x-pin': p } });
  if (r.ok) { pin = p; sessionStorage.pin = p; await load(); go('counter'); } else $('#err').textContent = '密碼錯誤,請再試一次';
}

// —— 點餐(客人與櫃檯共用)——
const cartTotal = () => S.menu.reduce((s, m) => s + m.price * (cart[m.id] || 0), 0);
function menuUI(staff) {
  const grp = (cat, t) => `<h2>${t}</h2><div class="grid">` + S.menu.filter(m => m.cat === cat).map(m =>
    `<div class="card ${m.soldOut ? 'off' : ''}"><b>${esc(m.name)}</b><span>$${m.price}</span>${m.soldOut ? '<i>已售完</i>' :
      `<div class="qty"><button onclick="qty('${m.id}',-1)" aria-label="減少">−</button><em id="q-${m.id}">${cart[m.id] || 0}</em><button onclick="qty('${m.id}',1)" aria-label="增加">＋</button></div>`}</div>`).join('') + '</div>';
  return grp('food', '🌭 熟食') + grp('drink', '🥤 飲料') + `<textarea id="note" placeholder="備註(選填)"></textarea>
  <div class="bar"><span>合計 $<b id="sum">${cartTotal()}</b></span><button class="pri" onclick="submitOrder(${!!staff})">送出訂單</button></div>`;
}
function qty(id, d) { cart[id] = Math.max(0, Math.min(20, (cart[id] || 0) + d)); $('#q-' + id).textContent = cart[id]; $('#sum').textContent = cartTotal(); }
async function submitOrder(staff) {
  const items = Object.entries(cart).filter(([, q]) => q).map(([id, qty]) => ({ id, qty }));
  if (!items.length) return alert('請先選擇商品');
  const r = await api('POST', '/api/orders', { items, note: $('#note').value });
  if (!r.no) return alert(r.error || '送出失敗');
  cart = {};
  if (staff) return go('counter');
  app.innerHTML = `<div class="done"><p>你的單號</p><div class="n">${pad(r.no)}</div><h2>請記下號碼,到櫃檯結帳</h2><button class="pri" onclick="go('home')">完成</button></div>`;
  view = 'done'; setTimeout(() => view === 'done' && go('home'), 15000);
}

// —— 櫃檯 ——
async function prev(id) { const r = await api('POST', `/api/orders/${id}/preview`, { discounts: sel[id] || [] }); const e = $('#t-' + id); if (e && r.total != null) e.textContent = r.total; }
function tog(id, k) { const a = sel[id] = sel[id] || []; const i = a.indexOf(k); i < 0 ? a.push(k) : a.splice(i, 1); prev(id); }
async function pay(id) { await api('POST', `/api/orders/${id}/pay`, { discounts: sel[id] || [] }); delete sel[id]; }
const voidO = async id => { if (confirm('確定作廢這張訂單?')) await api('POST', `/api/orders/${id}/void`); };
const setO = (id, field, value) => api('POST', `/api/orders/${id}/set`, { field, value });
function counterV() {
  const os = S.orders.filter(o => o.date === S.today && !o.void);
  const un = os.filter(o => !o.paid), mk = os.filter(o => o.paid && !o.picked && !isReady(o)), rd = os.filter(isReady);
  const st = { wait: '等待', making: '製作中', done: '完成', none: '–' };
  const none = '<p class="mute">目前沒有</p>';
  return nav() + `<button class="pri" onclick="go('new')">＋ 櫃檯點單</button>
  <h2>待結帳(${un.length})</h2><div class="grid">${un.map(o => `<div class="card tk"><div class="no">#${pad(o.no)}<small>${hm(o.time)}</small></div><p>${sum(o)}</p>
    ${o.note ? `<p class="note">📝 ${esc(o.note)}</p>` : ''}<p>小計 $${o.subtotal}</p>
    ${Object.entries(S.discounts).map(([k, l]) => `<label><input type="checkbox" ${(sel[o.id] || []).includes(k) ? 'checked' : ''} onchange="tog('${o.id}','${k}')"> ${l}</label>`).join('')}
    <p class="due">應收 $<b id="t-${o.id}">${o.subtotal}</b></p><button class="pri" onclick="pay('${o.id}')">已收款,送去製作</button><button onclick="voidO('${o.id}')">作廢</button></div>`).join('') || none}</div>
  <h2>製作中(${mk.length})</h2><div class="grid">${mk.map(o => `<div class="card tk"><div class="no">#${pad(o.no)}</div><p>${sum(o)}</p><p>後廚:${st[o.food]}　飲料:${st[o.drink]}</p></div>`).join('') || none}</div>
  <h2>待取餐(${rd.length})</h2><div class="grid">${rd.map(o => `<div class="card tk making"><div class="no">#${pad(o.no)}</div><p>${sum(o)}</p>${o.note ? `<p class="note">📝 ${esc(o.note)}</p>` : ''}<button class="pri" onclick="setO('${o.id}','picked',true)">已取餐</button></div>`).join('') || none}</div>`;
}

// —— 後廚 / 飲料 ——
const step = (id, f, v) => setO(id, f, v);
function stationV(kind) {
  const list = S.orders.filter(o => o.paid && !o.void && !o.picked && o.date === S.today && ['wait', 'making'].includes(o[kind])).sort((a, b) => a.time - b.time);
  return nav() + `<h2>${kind === 'food' ? '後廚' : '飲料'}待製作(${list.length})</h2><div class="grid">${list.map(o => `<div class="card tk ${o[kind]}">
    <div class="no">#${pad(o.no)}<small>${hm(o.time)}</small></div>${o.items.filter(i => i.cat === kind).map(i => `<p class="big">${esc(i.name)} ×${i.qty}</p>`).join('')}
    ${o.note ? `<p class="note">📝 ${esc(o.note)}</p>` : ''}
    <button class="pri" onclick="step('${o.id}','${kind}','${o[kind] === 'wait' ? 'making' : 'done'}')">${o[kind] === 'wait' ? '開始製作' : '完成'}</button></div>`).join('') || '<p class="mute">目前沒有待製作的訂單</p>'}</div>`;
}

// —— 後台 ——
const statOf = o => o.void ? '已作廢' : !o.paid ? '待結帳' : o.picked ? '已取餐' : isReady(o) ? '待取餐' : '製作中';
const ordersOf = d => S.orders.filter(o => o.date === d);
function adminV() {
  const d = adminDate || S.today, all = ordersOf(d), ok = all.filter(o => o.paid && !o.void);
  const rev = ok.reduce((s, o) => s + o.total, 0), disc = ok.reduce((s, o) => s + o.subtotal - o.total, 0), cnt = {};
  ok.forEach(o => o.items.forEach(i => { const c = cnt[i.name] = cnt[i.name] || { q: 0, a: 0 }; c.q += i.qty; c.a += i.qty * i.price; }));
  return nav() + `<label>日期 <input type="date" value="${d}" onchange="adminDate=this.value;render()"></label> <button onclick="csv()">匯出 CSV</button>
  <div class="stats"><div class="card"><span>實收營收</span><strong>$${rev}</strong></div><div class="card"><span>成交單數</span><strong>${ok.length}</strong></div>
  <div class="card"><span>折扣總額</span><strong>$${disc}</strong></div><div class="card"><span>平均客單</span><strong>$${ok.length ? Math.round(rev / ok.length) : 0}</strong></div></div>
  <h2>品項銷量</h2><div class="tablewrap"><table><tr><th>品項</th><th>數量</th><th>原價小計</th></tr>${Object.entries(cnt).map(([n, c]) => `<tr><td>${esc(n)}</td><td>${c.q}</td><td>$${c.a}</td></tr>`).join('') || '<tr><td colspan=3>這天沒有成交</td></tr>'}</table></div>
  <h2>訂單紀錄(${all.length})</h2><div class="tablewrap"><table><tr><th>單號</th><th>時間</th><th>內容</th><th>小計</th><th>折扣</th><th>實收</th><th>狀態</th><th></th></tr>
  ${all.slice().reverse().map(o => `<tr class="${o.void ? 'void' : ''}"><td>#${pad(o.no)}</td><td>${hm(o.time)}</td><td>${sum(o)}${o.note ? '<br>📝' + esc(o.note) : ''}</td><td>$${o.subtotal}</td><td>${o.discounts.map(x => esc(x.label) + ' -' + x.amount).join('<br>')}</td><td>$${o.total}</td><td>${statOf(o)}</td>
  <td>${o.void ? '' : `<button onclick="voidO('${o.id}')">作廢</button>`}</td></tr>`).join('')}</table></div>
  <h2>菜單管理</h2><div class="tablewrap"><table><tr><th>品項</th><th>價格</th><th>供應</th></tr>${S.menu.map(m => `<tr><td>${esc(m.name)}</td>
  <td><input type="number" min="0" value="${m.price}" style="width:90px" onchange="api('PUT','/api/menu/${m.id}',{price:+this.value})"></td>
  <td><button onclick="api('PUT','/api/menu/${m.id}',{soldOut:${!m.soldOut}})">${m.soldOut ? '已售完(點此恢復)' : '供應中(點此設為售完)'}</button></td></tr>`).join('')}</table></div>
  <h2>新增品項</h2><input id="nn" placeholder="品名"> <select id="nc"><option value="food">熟食</option><option value="drink">飲料</option></select> <input id="np" type="number" min="0" placeholder="價格" style="width:90px"> <button class="pri" onclick="addItem()">新增</button>`;
}
async function addItem() { const r = await api('POST', '/api/menu', { name: $('#nn').value.trim(), cat: $('#nc').value, price: +$('#np').value }); if (r.error) alert(r.error); }
function csv() {
  const d = adminDate || S.today;
  const rows = [['單號', '日期', '時間', '內容', '小計', '折扣', '實收', '狀態', '備註']].concat(ordersOf(d).map(o => [pad(o.no), o.date, hm(o.time), o.items.map(i => `${i.name}x${i.qty}`).join(' '), o.subtotal, o.discounts.map(x => `${x.label}-${x.amount}`).join(' '), o.total, statOf(o), o.note]));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = `orders-${d}.csv`; a.click();
}

new EventSource('/api/events').onmessage = load;
load().then(render);
