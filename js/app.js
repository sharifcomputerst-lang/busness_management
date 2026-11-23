/* ===== আমার হিসাব — মূল অ্যাপ্লিকেশন (অংশ ১: ডেটা, রাউটিং, ড্যাশবোর্ড, সার্চ) ===== */

const App = (() => {
  let products = [];
  let customers = [];
  let sales = [];
  let purchases = [];
  let entries = [];
  let payments = [];

  let editing = {};
  let cart = [];
  let entryTab = 'ledger';
  let deferredPrompt = null;

  async function refreshData() {
    products = (await DB.all('products')).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'bn'));
    customers = (await DB.all('customers')).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'bn'));
    sales = (await DB.all('sales')).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
    purchases = (await DB.all('purchases')).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
    entries = (await DB.all('entries')).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
    payments = (await DB.all('payments')).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  }

  const productById = id => products.find(p => p.id === id);
  const customerById = id => customers.find(c => c.id === id);
  const productByName = name => products.find(p => (p.name || '').toLowerCase() === (name || '').toLowerCase());

  function salesDueOf(cid) {
    return sales.filter(s => s.customerId === cid).reduce((a, s) => a + (s.due || 0), 0);
  }
  function paymentsSumOf(cid) {
    return payments.filter(p => p.customerId === cid).reduce((a, p) => a + (p.amount || 0), 0);
  }
  function dueOf(cid) {
    return salesDueOf(cid) - paymentsSumOf(cid);
  }

  /* ---------- কাস্টম কনফার্ম ডায়ালগ (WebView-safe) ---------- */
  function confirmBox(msg) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML = `
        <div class="modal-card">
          <p class="cf-msg">${esc(msg)}</p>
          <div class="btn-row">
            <button class="btn cancel" id="cf-no">না</button>
            <button class="btn save" id="cf-yes">হ্যাঁ</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const done = ok => { wrap.remove(); resolve(ok); };
      $('#cf-no', wrap).onclick = () => done(false);
      $('#cf-yes', wrap).onclick = () => done(true);
    });
  }

  /* ---------- ছবি আপলোড (রিসাইজসহ) ---------- */
  function pickImage(cb) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement('canvas');
          const size = 320;
          const scale = Math.min(size / img.width, size / img.height, 1);
          cv.width = Math.max(1, Math.round(img.width * scale));
          cv.height = Math.max(1, Math.round(img.height * scale));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          cb(cv.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => toast('ছবিটি খোলা যায়নি', false);
        img.src = r.result;
      };
      r.readAsDataURL(f);
    };
    inp.click();
  }

  /* ---------- হেডারে দোকানের নাম ও ছবি ---------- */
  function renderHeader() {
    const name = Shop.name || 'আমার হিসাব';
    const t = $('.app-title');
    if (t) t.textContent = name;
    document.title = name + ' — অফলাইন ব্যবসা ম্যানেজমেন্ট';
    const lg = $('.app-logo');
    if (lg) lg.innerHTML = Shop.logo ? '<img src="' + Shop.logo + '" alt="">' : 'হি';
    const hd = $('#header-date');
    if (hd) hd.textContent = dateBn(todayStr());
  }

  function go(route, opts) {
    opts = opts || {};
    editing = {};
    if (opts.editSaleId) editing.saleId = opts.editSaleId;
    if (opts.editPurchaseId) editing.purchaseId = opts.editPurchaseId;
    if (opts.editEntryId) editing.entryId = opts.editEntryId;
    if (opts.editProductId) editing.productId = opts.editProductId;
    if (opts.editCustomerId) editing.customerId = opts.editCustomerId;
    if (opts.customerId) editing.openCustomerId = opts.customerId;
    if (opts.saleId) editing.openSaleId = opts.saleId;
    const h = '#/' + route;
    if (location.hash === h) route();
    else location.hash = h;
  }

  window.addEventListener('hashchange', () => route());

  function route() {
    const name = (location.hash.replace('#/', '') || 'home').split('?')[0];
    const v = $('#view');
    v.innerHTML = '';
    window.scrollTo(0, 0);
    try {
      ({
        home: renderHome,
        sale: renderSaleForm,
        purchase: renderPurchaseForm,
        products: renderProducts,
        productForm: renderProductForm,
        customers: renderCustomers,
        customerForm: renderCustomerForm,
        customer: renderCustomerDetail,
        entries: renderEntries,
        alltx: renderAllTx,
        receipt: renderReceipt,
        settings: renderSettings
      }[name] || renderHome)(v);
    } catch (err) {
      v.innerHTML = '<div class="card"><p>কিছু একটা সমস্যা হয়েছে: ' + esc(err.message) + '</p></div>';
    }
    setActiveNav(name);
  }

  function setActiveNav(name) {
    const map = {
      home: 'home', products: 'products', productForm: 'products',
      customers: 'customers', customerForm: 'customers', customer: 'customers',
      entries: 'entries', purchase: 'entries'
    };
    const cur = map[name] || '';
    $$('#bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.route === cur));
  }

  function renderHome(v) {
    const t = todayStr();
    const ms = monthStartStr();
    const inDay = s => s.date === t;
    const inMonth = s => s.date >= ms;
    const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);

    const daySales = sales.filter(inDay);
    const monthSales = sales.filter(inMonth);
    const dayProfit = sum(daySales, s => s.profit);
    const monthProfit = sum(monthSales, s => s.profit);
    const dayIncome = sum(entries.filter(e => inDay(e) && e.type === 'income'), e => e.amount);
    const dayExpense = sum(entries.filter(e => inDay(e) && e.type === 'expense'), e => e.amount);
    const monthIncome = sum(entries.filter(e => inMonth(e) && e.type === 'income'), e => e.amount);
    const monthExpense = sum(entries.filter(e => inMonth(e) && e.type === 'expense'), e => e.amount);
    const dayPurchase = sum(purchases.filter(inDay), p => p.total);
    const monthPurchase = sum(purchases.filter(inMonth), p => p.total);
    const dayCashIn = sum(daySales, s => s.paid) + sum(payments.filter(inDay), p => p.amount) + dayIncome;
    const totalDue = customers.reduce((a, c) => a + Math.max(0, dueOf(c.id)), 0);
    const totalDayDue = sum(daySales.filter(s => s.customerId), s => s.due);
    const stockValue = sum(products, p => (p.stock || 0) * (p.buyPrice || 0));

    v.innerHTML = `
      <div class="card hero-card">
        <div class="search-wrap">
          <input id="global-search" placeholder="🔍 পণ্য, কাস্টমার, মোবাইল নম্বর খুঁজুন...">
          <div id="search-results"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>আজকের সারসংক্ষেপ</h3>
          <button class="link-btn" id="share-day">↗ শেয়ার</button>
        </div>
        <div class="stat-grid">
          <div class="stat green"><span class="stat-l">মোট বিক্রয়</span><b>${fmtMoney(sum(daySales, s => s.total))}</b><small>${toBn(daySales.length)}টি বিল</small></div>
          <div class="stat blue"><span class="stat-l">পণ্য ক্রয়</span><b>${fmtMoney(dayPurchase)}</b><small>মোট কেনাকাটা</small></div>
          <div class="stat teal"><span class="stat-l">বিক্রয় লাভ</span><b>${fmtMoney(dayProfit)}</b><small>বিক্রয় থেকে</small></div>
          <div class="stat amber"><span class="stat-l">অন্যান্য আয়</span><b>${fmtMoney(dayIncome)}</b><small>বিক্রয় বাহিরে</small></div>
          <div class="stat red"><span class="stat-l">মোট ব্যয়</span><b>${fmtMoney(dayExpense)}</b><small>মোট খরচ</small></div>
          <div class="stat green"><span class="stat-l">হাতে নগদ</span><b>${fmtMoney(dayCashIn - dayPurchase - dayExpense)}</b><small>আয় − ব্যয়</small></div>
          <div class="stat red"><span class="stat-l">আজকের বাকির বিল</span><b>${fmtMoney(totalDayDue)}</b><small>মোট বাকি ${fmtMoney(totalDue)}</small></div>
          <div class="stat blue"><span class="stat-l">স্টকের মূল্য</span><b>${fmtMoney(stockValue)}</b><small>${toBn(products.length)}টি পণ্য</small></div>
        </div>
        <div class="mini-note">চলতি মাসে — বিক্রয় ${fmtMoney(sum(monthSales, s => s.total))} · লাভ ${fmtMoney(monthProfit)} · আয় ${fmtMoney(monthIncome)} · ব্যয় ${fmtMoney(monthExpense + monthPurchase)}</div>
      </div>

      <div class="quick-grid">
        <button class="quick" data-go="sale"><span>🛒</span>নতুন বিক্রয়</button>
        <button class="quick" data-go="purchase"><span>📥</span>পণ্য ক্রয়</button>
        <button class="quick" data-go="entries"><span>💰</span>আয়-ব্যয়</button>
        <button class="quick" data-go="products"><span>📦</span>স্টক</button>
      </div>

      <div class="card">
        <div class="card-head"><h3>সর্বশেষ ২০টি লেনদেন</h3><button class="link-btn" data-go="alltx">সব দেখুন (৩ মাস)</button></div>
        <div class="list" id="home-tx"></div>
      </div>`;

    bindGlobalSearch(v);
    const tx20 = txItems().slice(0, 20);
    $('#home-tx', v).innerHTML = txRows(tx20);
    bindTxRows(v, tx20);
    $('#share-day', v).onclick = shareDay;
    $$('[data-go]', v).forEach(b => b.onclick = () => go(b.dataset.go));
  }

  function monthsAgoStr(n) {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    const pad = v => String(v).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function txItems() {
    const items = [];
    sales.forEach(s => items.push({
      d: s.date, at: s.createdAt, icon: '🛒',
      title: 'বিক্রয় — ' + (s.customerName || 'নগদ'),
      sub: (s.items || []).map(i => i.name + ' ×' + toBn(fmtNum(i.qty))).join(', '),
      amt: s.total, cls: 'green',
      act: () => go('sale', { editSaleId: s.id })
    }));
    purchases.forEach(p => items.push({
      d: p.date, at: p.createdAt, icon: '📥',
      title: 'ক্রয় — ' + p.name,
      sub: toBn(fmtNum(p.qty)) + ' ' + (p.unit || '') + ' × ' + fmtMoney(p.price),
      amt: p.total, cls: 'blue',
      act: () => go('purchase', { editPurchaseId: p.id })
    }));
    entries.forEach(e => items.push({
      d: e.date, at: e.createdAt, icon: e.type === 'income' ? '➕' : '➖',
      title: (e.type === 'income' ? 'আয়' : 'ব্যয়') + (e.category ? ' — ' + e.category : ''),
      sub: e.note || '', amt: e.amount, cls: e.type === 'income' ? 'teal' : 'red',
      act: () => go('entries', { editEntryId: e.id })
    }));
    payments.forEach(p => {
      const c = customerById(p.customerId);
      items.push({
        d: p.date, at: p.createdAt, icon: '💵',
        title: (p.amount >= 0 ? 'বাকি পরিশোধ' : 'বাকি যোগ') + ' — ' + ((c || {}).name || ''),
        sub: p.note || '', amt: Math.abs(p.amount), cls: p.amount >= 0 ? 'green' : 'red',
        act: c ? () => { go('customer', { customerId: c.id }); setTimeout(() => openDueForm(c, p.amount >= 0 ? 1 : -1, p), 60); } : null
      });
    });
    items.sort((a, b) => (b.d + (b.at || 0)).localeCompare(a.d + (a.at || 0)));
    return items;
  }

  function txRows(items) {
    if (!items.length) return '<div class="empty">কোনো লেনদেন নেই</div>';
    return items.map((it, i) => `
      <div class="row" data-tx="${i}">
        <span class="row-ic">${it.icon}</span>
        <div class="row-main">
          <div class="row-t">${esc(it.title)}</div>
          <div class="row-s">${dateBn(it.d)}${it.sub ? ' · ' + esc(it.sub) : ''}</div>
        </div>
        <div class="row-amt ${it.cls}">${fmtMoney(it.amt)}</div>
      </div>`).join('');
  }

  function bindTxRows(root, items) {
    $$('[data-tx]', root).forEach(el => el.onclick = () => {
      const it = items[+el.dataset.tx];
      if (it && it.act) it.act();
    });
  }

  function renderAllTx(v) {
    const from = monthsAgoStr(3);
    const items = txItems().filter(it => it.d >= from);
    v.innerHTML = `
      <button class="back" id="at-back">← হোম</button>
      <div class="card">
        <div class="card-head"><h3>সর্বশেষ ৩ মাসের লেনদেন</h3><button class="link-btn" data-go="entries">সব হিসাব</button></div>
        <div class="mini-note">${dateBn(from)} থেকে এখন পর্যন্ত — মোট ${toBn(items.length)}টি লেনদেন</div>
        <div class="list" id="alltx-list"></div>
      </div>`;
    $('#alltx-list', v).innerHTML = txRows(items);
    bindTxRows(v, items);
    $('#at-back').onclick = () => go('home');
    $$('[data-go]', v).forEach(b => b.onclick = () => go(b.dataset.go));
  }

  function bindGlobalSearch(v) {
    const input = $('#global-search', v);
    const box = $('#search-results', v);
    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { box.innerHTML = ''; box.className = ''; return; }
      box.className = 'open';
      const pRes = products.filter(p => (p.name || '').toLowerCase().includes(q)).slice(0, 6);
      const cRes = customers.filter(c => (c.name || '').toLowerCase().includes(q) || (c.mobile || '').includes(q)).slice(0, 6);
      let html = '';
      if (pRes.length) html += '<div class="grp">পণ্য</div>' + pRes.map(p => `
        <div class="s-res" data-p="${p.id}"><b>${esc(p.name)}</b><span>স্টক ${toBn(fmtNum(p.stock))} ${esc(p.unit || '')} · বিক্রয়মূল্য ${fmtMoney(p.sellPrice)}</span></div>`).join('');
      if (cRes.length) html += '<div class="grp">মোট কেনাকাটা</div>' + cRes.map(c => {
        const d = dueOf(c.id);
        return `<div class="s-res" data-c="${c.id}"><b>${esc(c.name)}</b><span>${esc(c.mobile || '')}${d > 0 ? ' · বাকি <i class="due-red">' + fmtMoney(d) + '</i>' : ''}</span></div>`;
      }).join('');
      box.innerHTML = html || '<div class="s-res"><span>কিছু পাওয়া যায়নি</span></div>';
      $$('[data-p]', box).forEach(el => el.onclick = () => { input.value = ''; box.innerHTML = ''; box.className = ''; go('products'); });
      $$('[data-c]', box).forEach(el => el.onclick = () => { input.value = ''; box.innerHTML = ''; box.className = ''; go('customer', { customerId: el.dataset.c }); });
    };
  }
  /* ---------- পণ্য পিকার ---------- */
  function bindProductPicker(input, list, onPick) {
    const renderList = () => {
      const q = input.value.trim().toLowerCase();
      let items = q ? products.filter(p => (p.name || '').toLowerCase().includes(q)) : products;
      items = items.slice(0, 20);
      list.innerHTML = items.length ? items.map(p => `
        <div class="s-res" data-id="${p.id}">
          <b>${esc(p.name)}${(p.stock || 0) <= 0 ? ' <i class="due-red">(স্টক নেই)</i>' : ''}</b>
          <span>স্টক ${toBn(fmtNum(p.stock))} ${esc(p.unit || '')} · বিক্রয়মূল্য ${fmtMoney(p.sellPrice)}</span>
        </div>`).join('') : '';
      $$('[data-id]', list).forEach(el => el.onclick = () => {
        const p = productById(el.dataset.id);
        if (p) { onPick(p); input.value = ''; renderList(); }
      });
    };
    renderList();
    input.oninput = renderList;
  }

  /* ---------- বিক্রয় ফর্ম ---------- */
  function renderSaleForm(v) {
    const s = editing.saleId ? sales.find(x => x.id === editing.saleId) : null;
    cart = s ? JSON.parse(JSON.stringify(s.items)) : [];

    v.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>${s ? 'বিক্রয় সংশোধন' : 'নতুন বিক্রয়'}</h3>
          <button class="link-btn" data-go2="1">বিক্রয় তালিকা</button></div>

        <label class="f-l">তারিখ</label>
        <input id="s-date" type="date" value="${s ? s.date : todayStr()}">

        <label class="f-l">কাস্টমার</label>
        <select id="s-customer">
          <option value="">নগদ কাস্টমার (বাকি নয়)</option>
          ${customers.map(c => {
            const d = dueOf(c.id);
            return `<option value="${c.id}" ${s && s.customerId === c.id ? 'selected' : ''}>${esc(c.name)}${c.mobile ? ' — ' + esc(c.mobile) : ''}${d > 0 ? ' (পুরোনো বাকি ' + fmtMoney(d) + ')' : ''}</option>`;
          }).join('')}
        </select>
        <div id="new-cust-wrap" style="display:none">
          <input id="s-new-name" placeholder="নতুন কাস্টমারের নাম">
          <input id="s-new-mobile" class="mid" placeholder="মোবাইল (ঐচ্ছিক)">
        </div>

        <label class="f-l">পণ্য খুঁজুন</label>
        <input id="s-prod-search" placeholder="পণ্যের নাম লিখুন...">
        <div id="s-prod-list" class="pick-list"></div>

        <div class="card-head" style="margin-top:12px"><h3>বিক্রিত পণ্য</h3></div>
        <div id="s-cart" class="list"></div>

        <div class="totals">
          <div><span>মোট বিল</span><b id="s-total">৳০</b></div>
          <div class="tot-in"><span>নগদ পরিশোধ</span><input id="s-paid" class="calc-field amount" value="${s ? fmtNum(s.paid) : ''}" placeholder="০"></div>
          <div><span>বাকি</span><b id="s-due" class="due-red">৳০</b></div>
        </div>

        <input id="s-note" placeholder="নোট (ঐচ্ছিক)">
        <div class="btn-row">
          <button class="btn cancel" id="s-cancel">বাতিল</button>
          <button class="btn save" id="s-save">${s ? 'সংশোধন সংরক্ষণ' : 'বিক্রয় সংরক্ষণ'}</button>
        </div>
      </div>`;

    const custSel = $('#s-customer');
    const newOpt = document.createElement('option');
    newOpt.value = '__new';
    newOpt.textContent = '+ নতুন কাস্টমার';
    custSel.appendChild(newOpt);
    custSel.onchange = () => {
      $('#new-cust-wrap').style.display = custSel.value === '__new' ? 'block' : 'none';
    };

    renderCart();
    bindProductPicker($('#s-prod-search'), $('#s-prod-list'), p => addToCart(p));
    $$('[data-go2]', v).forEach(b => b.onclick = () => { entryTab = 'sales'; go('entries'); });

    $('#s-paid').addEventListener('input', updateTotals);
    $('#s-cancel').onclick = () => go('home');
    $('#s-save').onclick = () => saveSale(s);
  }

  function addToCart(p) {
    const ex = cart.find(i => i.productId === p.id);
    if (ex) ex.qty += 1;
    else cart.push({ productId: p.id, name: p.name, unit: p.unit, qty: 1, price: p.sellPrice || 0, buyPrice: p.buyPrice || 0 });
    renderCart();
  }

  function renderCart() {
    const el = $('#s-cart');
    el.innerHTML = cart.length ? cart.map((i, ix) => `
      <div class="cart-row">
        <div class="row-main">
          <div class="row-t">${esc(i.name)}</div>
          <input class="calc-field qty" data-ix="${ix}" data-f="qty" value="${fmtNum(i.qty)}" placeholder="পরিমাণ">
          <span class="x">×</span>
          <input class="calc-field price" data-ix="${ix}" data-f="price" value="${fmtNum(i.price)}" placeholder="মূল্য">
        </div>
        <div class="row-amt green">${fmtMoney(i.qty * i.price)}</div>
        <button class="del" data-rm="${ix}">✕</button>
      </div>`).join('') : '<div class="empty">পণ্য যোগ করুন</div>';
    $$('[data-ix]', el).forEach(inp => inp.addEventListener('input', () => {
      const i = cart[+inp.dataset.ix];
      i[inp.dataset.f] = Number(inp.value) || 0;
      updateTotals();
    }));
    $$('[data-rm]', el).forEach(b => b.onclick = () => { cart.splice(+b.dataset.rm, 1); renderCart(); });
    updateTotals();
  }

  function cartTotals() {
    const total = cart.reduce((a, i) => a + i.qty * i.price, 0);
    const paidEl = $('#s-paid');
    const paid = paidEl ? Number(paidEl.value) || 0 : 0;
    return { total: Math.round(total * 100) / 100, paid, due: Math.round((total - paid) * 100) / 100 };
  }

  function updateTotals() {
    const t = cartTotals();
    const el1 = $('#s-total'), el2 = $('#s-due');
    if (el1) el1.textContent = fmtMoney(t.total);
    if (el2) el2.textContent = fmtMoney(t.due);
  }

  async function saveSale(old) {
    if (!cart.length) return toast('কমপক্ষে একটি পণ্য যোগ করুন', false);
    let customerName = '';
    let customerId = $('#s-customer').value;
    if (customerId === '__new') {
      const name = $('#s-new-name').value.trim();
      if (!name) return toast('নতুন কাস্টমারের নাম দিন', false);
      const c = { id: uid(), name, mobile: $('#s-new-mobile').value.trim(), createdAt: Date.now() };
      await DB.put('customers', c);
      customers.push(c);
      customerId = c.id;
      customerName = c.name;
    } else if (customerId) {
      const c = customerById(customerId);
      customerName = c ? c.name : '';
    }
    const t = cartTotals();
    if (t.due > 0 && !customerId) return toast('বাকির জন্য কাস্টমার নির্বাচন করুন', false);
    const profit = cart.reduce((a, i) => a + (i.price - (i.buyPrice || 0)) * i.qty, 0);
    const sale = {
      id: old ? old.id : uid(),
      createdAt: old ? old.createdAt : Date.now(),
      date: $('#s-date').value || (old ? old.date : todayStr()),
      customerId, customerName,
      items: JSON.parse(JSON.stringify(cart)),
      total: t.total, paid: t.paid, due: Math.max(0, t.due),
      profit: Math.round(profit * 100) / 100,
      note: $('#s-note').value.trim()
    };

    if (old) {
      for (const it of old.items) {
        const p = productById(it.productId);
        if (p) { p.stock = (p.stock || 0) + it.qty; await DB.put('products', p); }
      }
    }
    for (const it of cart) {
      const p = productById(it.productId);
      if (p) { p.stock = (p.stock || 0) - it.qty; await DB.put('products', p); }
    }
    await DB.put('sales', sale);
    await refreshData();
    toast(old ? 'বিক্রয় সংশোধন হয়েছে ✓' : 'বিক্রয় সংরক্ষিত ✓');
    if (!old) return go('receipt', { saleId: sale.id });
    if (customerId) go('customer', { customerId });
    else go('entries');
  }

  function deleteSale(id) {
    const s = sales.find(x => x.id === id);
    if (!s) return;
    confirmBox('এই বিক্রয়টি ডিলিট করতে চান? স্টক ও বাকির হিসাব ফিরিয়ে আনা হবে।').then(async ok => {
      if (!ok) return;
      for (const it of s.items) {
        const p = productById(it.productId);
        if (p) { p.stock = (p.stock || 0) + it.qty; await DB.put('products', p); }
      }
      await DB.del('sales', id);
      await refreshData();
      toast('বিক্রয় ডিলিট হয়েছে');
      route();
    });
  }

  /* ---------- ক্রয় ফর্ম ---------- */
  function renderPurchaseForm(v) {
    const p = editing.purchaseId ? purchases.find(x => x.id === editing.purchaseId) : null;
    let selProduct = p ? productById(p.productId) : null;

    v.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>${p ? 'ক্রয় সংশোধন' : 'পণ্য ক্রয়'}</h3>
          <button class="link-btn" data-qpur>ক্রয় তালিকা</button></div>

        <label class="f-l">তারিখ</label>
        <input id="p-date" type="date" value="${p ? p.date : todayStr()}">

        <label class="f-l">পণ্য খুঁজুন বা নতুন পণ্যের নাম লিখুন</label>
        <input id="p-prod-search" placeholder="পণ্যের নাম লিখুন...">
        <div id="p-prod-list" class="pick-list"></div>

        <div id="p-prod-sel" style="margin-top:8px"></div>

        <div id="p-new-wrap" style="display:none">
          <label class="f-l">একক বিক্রয়মূল্য (লাভের হিসাবের জন্য)</label>
          <input id="p-sell" class="calc-field" placeholder="০">
        </div>

        <div class="grid2">
          <div>
            <label class="f-l">পরিমাণ *</label>
            <input id="p-qty" class="calc-field" value="${p ? fmtNum(p.qty) : ''}" placeholder="০">
          </div>
          <div>
            <label class="f-l">একক ক্রয়মূল্য *</label>
            <input id="p-price" class="calc-field" value="${p ? fmtNum(p.price) : ''}" placeholder="০">
          </div>
        </div>

        <div class="totals"><div><span>মোট ক্রয়</span><b id="p-total">৳০</b></div></div>
        <input id="p-note" placeholder="সরবরাহকারী / নোট (ঐচ্ছিক)">

        <div class="btn-row">
          <button class="btn cancel" id="p-cancel">বাতিল</button>
          <button class="btn save" id="p-save">${p ? 'সংশোধন সংরক্ষণ' : 'ক্রয় সংরক্ষণ'}</button>
        </div>
      </div>`;

    const selBox = $('#p-prod-sel');
    function renderSel() {
      if (selProduct) {
        selBox.innerHTML = `<div class="sel-chip">📦 <b>${esc(selProduct.name)}</b> — স্টক ${toBn(fmtNum(selProduct.stock))} ${esc(selProduct.unit || '')} <button id="p-clear" type="button">পরিবর্তন</button></div>`;
        $('#p-clear').onclick = () => { selProduct = null; renderSel(); };
        $('#p-new-wrap').style.display = 'none';
      } else {
        selBox.innerHTML = '';
        $('#p-new-wrap').style.display = 'block';
      }
    }

    bindProductPicker($('#p-prod-search'), $('#p-prod-list'), pr => {
      selProduct = pr;
      renderSel();
    });

    function update() {
      const q = Number($('#p-qty').value) || 0;
      const pr = Number($('#p-price').value) || 0;
      $('#p-total').textContent = fmtMoney(q * pr);
    }
    ['#p-qty', '#p-price'].forEach(s => $(s).addEventListener('input', update));

    $('#p-cancel').onclick = () => go('home');
    $('#p-save').onclick = async () => {
      const qty = Number($('#p-qty').value) || 0;
      const price = Number($('#p-price').value) || 0;
      if (qty <= 0 || price < 0) return toast('পরিমাণ ও মূল্য দিন', false);

      let prod = selProduct;
      if (!prod) {
        const name = $('#p-prod-search').value.trim();
        if (!name) return toast('পণ্য নির্বাচন বা নতুন পণ্যের নাম লিখুন', false);
        prod = productByName(name);
        if (!prod) {
          const sell = Number($('#p-sell').value) || 0;
          prod = { id: uid(), name, unit: 'পিস', buyPrice: price, sellPrice: sell, stock: 0, createdAt: Date.now() };
          await DB.put('products', prod);
        }
      }

      if (p) {
        const pp = productById(p.productId);
        if (pp) { pp.stock = (pp.stock || 0) - p.qty; await DB.put('products', pp); }
      }
      const prod2 = productById(prod.id);
      prod2.stock = (prod2.stock || 0) + qty;
      prod2.buyPrice = price;
      await DB.put('products', prod2);

      await DB.put('purchases', {
        id: p ? p.id : uid(),
        createdAt: p ? p.createdAt : Date.now(),
        date: $('#p-date').value || (p ? p.date : todayStr()),
        productId: prod2.id, name: prod2.name, unit: prod2.unit,
        qty, price, total: Math.round(qty * price * 100) / 100,
        note: $('#p-note').value.trim()
      });
      await refreshData();
      toast(p ? 'ক্রয় সংশোধন হয়েছে ✓' : 'ক্রয় সংরক্ষিত ✓');
      go('home');
    };

    renderSel();
    $('[data-qpur]', v).onclick = () => { entryTab = 'purchases'; go('entries'); };
    update();
  }

  function deletePurchase(id) {
    const p = purchases.find(x => x.id === id);
    if (!p) return;
    confirmBox('এই ক্রয়টি ডিলিট করতে চান? স্টক থেকে পরিমাণ বাদ দেওয়া হবে।').then(async ok => {
      if (!ok) return;
      const prod = productById(p.productId);
      if (prod) { prod.stock = (prod.stock || 0) - p.qty; await DB.put('products', prod); }
      await DB.del('purchases', id);
      await refreshData();
      toast('ক্রয় ডিলিট হয়েছে');
      route();
    });
  }
  /* ---------- পণ্য তালিকা ও ফর্ম ---------- */
  function renderProducts(v) {
    v.innerHTML = `
      <div class="toolbar"><input id="pr-search" placeholder="🔍 পণ্য খুঁজুন..."><button class="btn save sm" id="pr-add">+ নতুন পণ্য</button></div>
      <div id="pr-list" class="card"></div>`;
    const renderList = () => {
      const q = $('#pr-search').value.trim().toLowerCase();
      const list = products.filter(p => (p.name || '').toLowerCase().includes(q));
      $('#pr-list').innerHTML = list.length ? list.map(p => `
        <div class="row">
          <span class="row-ic">📦</span>
          <div class="row-main">
            <div class="row-t">${esc(p.name)}</div>
            <div class="row-s">ক্রয়মূল্য ${fmtMoney(p.buyPrice)} · বিক্রয়মূল্য ${fmtMoney(p.sellPrice)} · লাভ ${fmtMoney((p.sellPrice || 0) - (p.buyPrice || 0))}</div>
            <div class="row-s">স্টক <b class="${(p.stock || 0) <= 0 ? 'due-red' : ''}">${toBn(fmtNum(p.stock))} ${esc(p.unit || '')}</b></div>
          </div>
          <div class="row-actions">
            <button class="mini edit" data-ed="${p.id}">✎</button>
            <button class="mini del" data-dl="${p.id}">🗑</button>
          </div>
        </div>`).join('') : '<div class="empty">কোনো পণ্য নেই — নতুন পণ্য যোগ করুন</div>';
      $$('[data-ed]', $('#pr-list')).forEach(b => b.onclick = () => go('productForm', { editProductId: b.dataset.ed }));
      $$('[data-dl]', $('#pr-list')).forEach(b => b.onclick = () => {
        const p = productById(b.dataset.dl);
        if (!p) return;
        confirmBox('"' + p.name + '" পণ্যটি ডিলিট করতে চান?').then(async ok => {
          if (!ok) return;
          await DB.del('products', p.id);
          await refreshData();
          toast('পণ্য ডিলিট হয়েছে');
          renderProducts(v);
        });
      });
    };
    $('#pr-search').oninput = renderList;
    $('#pr-add').onclick = () => go('productForm');
    renderList();
  }

  function renderProductForm(v) {
    const p = editing.productId ? productById(editing.productId) : null;
    const units = ['পিস', 'কেজি', 'গ্রাম', 'লিটার', 'মিটার', 'প্যাকেট', 'ডজন', 'অন্য'];
    v.innerHTML = `
      <div class="card">
        <h3>${p ? 'পণ্য সংশোধন' : 'নতুন পণ্য / স্টক এন্ট্রি'}</h3>
        <label class="f-l">পণ্যের নাম *</label>
        <input id="pr-name" value="${p ? esc(p.name) : ''}" placeholder="যেমন: চাল (সোনামুগী)">
        <div class="grid2">
          <div><label class="f-l">একক</label>
            <select id="pr-unit">${units.map(u => `<option ${p && p.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
          <div><label class="f-l">স্টক (পরিমাণ)</label>
            <input id="pr-stock" class="calc-field" value="${p ? fmtNum(p.stock) : ''}" placeholder="০"></div>
        </div>
        <div class="grid2">
          <div><label class="f-l">ক্রয়মূল্য (একক) *</label>
            <input id="pr-buy" class="calc-field" value="${p ? fmtNum(p.buyPrice) : ''}" placeholder="০"></div>
          <div><label class="f-l">বিক্রয়মূল্য (একক) *</label>
            <input id="pr-sell" class="calc-field" value="${p ? fmtNum(p.sellPrice) : ''}" placeholder="০"></div>
        </div>
        <div class="profit-hint">একক প্রতি লাভ: <b id="pr-profit">৳০</b></div>
        <div class="btn-row">
          <button class="btn cancel" id="pr-cancel">বাতিল</button>
          <button class="btn save" id="pr-save">${p ? 'সংশোধন সংরক্ষণ' : 'পণ্য সংরক্ষণ'}</button>
        </div>
      </div>`;

    const upd = () => {
      const b = Number($('#pr-buy').value) || 0;
      const s = Number($('#pr-sell').value) || 0;
      $('#pr-profit').textContent = fmtMoney(s - b);
    };
    ['#pr-buy', '#pr-sell'].forEach(s => $(s).addEventListener('input', upd));

    $('#pr-cancel').onclick = () => go('products');
    $('#pr-save').onclick = async () => {
      const name = $('#pr-name').value.trim();
      if (!name) return toast('পণ্যের নাম দিন', false);
      await DB.put('products', {
        id: p ? p.id : uid(),
        createdAt: p ? p.createdAt : Date.now(),
        name, unit: $('#pr-unit').value,
        stock: Number($('#pr-stock').value) || 0,
        buyPrice: Number($('#pr-buy').value) || 0,
        sellPrice: Number($('#pr-sell').value) || 0
      });
      await refreshData();
      toast(p ? 'পণ্য সংশোধন হয়েছে ✓' : 'পণ্য যোগ হয়েছে ✓');
      go('products');
    };
    upd();
  }

  /* ---------- কাস্টমার ---------- */
  function renderCustomers(v) {
    v.innerHTML = `
      <div class="toolbar"><input id="c-search" placeholder="🔍 নাম বা মোবাইল নম্বর খুঁজুন..."><button class="btn save sm" id="c-add">+ নতুন</button></div>
      <div id="c-list" class="card"></div>`;
    const renderList = () => {
      const q = $('#c-search').value.trim().toLowerCase();
      const list = customers.filter(c => (c.name || '').toLowerCase().includes(q) || (c.mobile || '').includes(q));
      $('#c-list').innerHTML = list.length ? list.map(c => {
        const d = dueOf(c.id);
        return `<div class="row" data-cust="${c.id}">
          <span class="row-ic">${d > 0 ? '🧾' : '👤'}</span>
          <div class="row-main">
            <div class="row-t">${esc(c.name)}</div>
            <div class="row-s">${esc(c.mobile || 'মোবাইল নেই')}</div>
          </div>
          <div class="row-amt ${d > 0 ? 'due-red' : d < 0 ? 'teal' : ''}">${d > 0 ? 'বাকি ' + fmtMoney(d) : d < 0 ? 'অগ্রিম ' + fmtMoney(-d) : 'পরিশোধিত'}</div>
        </div>`;
      }).join('') : '<div class="empty">কোনো কাস্টমার নেই</div>';
      $$('[data-cust]').forEach(el => el.onclick = () => go('customer', { customerId: el.dataset.cust }));
    };
    $('#c-search').oninput = renderList;
    $('#c-add').onclick = () => go('customerForm');
    renderList();
  }

  function renderCustomerForm(v) {
    const c = editing.customerId ? customerById(editing.customerId) : null;
    let photo = (c && c.photo) || '';
    v.innerHTML = `
      <div class="card">
        <h3>${c ? 'কাস্টমার সংশোধন' : 'নতুন কাস্টমার'}</h3>
        <div class="avatar-row">
          <div class="avatar big" id="c-photo-box">${photo ? '<img src="' + photo + '">' : '👤'}</div>
          <div class="avatar-actions">
            <button class="btn blue sm" id="c-photo-btn" type="button">কাস্টমারের ছবি যোগ</button>
            <button class="btn cancel sm" id="c-photo-rm" type="button" style="display:${photo ? '' : 'none'}">মুছুন</button>
          </div>
        </div>
        <label class="f-l">নাম *</label>
        <input id="c-name" value="${c ? esc(c.name) : ''}" placeholder="কাস্টমারের নাম">
        <label class="f-l">মোবাইল</label>
        <input id="c-mobile" class="mid" value="${c ? esc(c.mobile || '') : ''}" placeholder="01XXXXXXXXX">
        <label class="f-l">ঠিকানা</label>
        <input id="c-addr" value="${c ? esc(c.address || '') : ''}" placeholder="ঠিকানা (ঐচ্ছিক)">
        <div class="btn-row">
          <button class="btn cancel" id="c-cancel">বাতিল</button>
          <button class="btn save" id="c-save">${c ? 'সংশোধন সংরক্ষণ' : 'সংরক্ষণ'}</button>
        </div>
      </div>`;
    $('#c-cancel').onclick = () => go('customers');
    $('#c-photo-btn').onclick = () => pickImage(u => {
      photo = u;
      $('#c-photo-box').innerHTML = '<img src="' + u + '">';
      $('#c-photo-rm').style.display = '';
    });
    $('#c-photo-rm').onclick = () => {
      photo = '';
      $('#c-photo-box').innerHTML = '👤';
      $('#c-photo-rm').style.display = 'none';
    };
    $('#c-save').onclick = async () => {
      const name = $('#c-name').value.trim();
      if (!name) return toast('কাস্টমারের নাম দিন', false);
      await DB.put('customers', {
        id: c ? c.id : uid(), createdAt: c ? c.createdAt : Date.now(),
        name, mobile: $('#c-mobile').value.trim(), address: $('#c-addr').value.trim(), photo
      });
      await refreshData();
      toast(c ? 'কাস্টমার সংশোধন হয়েছে ✓' : 'কাস্টমার যোগ হয়েছে ✓');
      go('customers');
    };
  }

  function renderCustomerDetail(v) {
    const c = customerById(editing.openCustomerId);
    if (!c) { v.innerHTML = '<div class="card"><p>কাস্টমার পাওয়া যায়নি</p></div>'; return; }

    const due = dueOf(c.id);
    const cSales = sales.filter(s => s.customerId === c.id);
    const cPays = payments.filter(p => p.customerId === c.id);
    const totalBuy = cSales.reduce((a, s) => a + s.total, 0);

    v.innerHTML = `
      <button class="back" id="c-back">← কাস্টমার তালিকা</button>
      <div class="card">
        <div class="card-head">
          <div class="avatar big">${c.photo ? `<img src="${c.photo}" alt="">` : esc((c.name || '?').slice(0, 1))}</div>
          <div>
            <h3>${esc(c.name)}</h3>
            <div class="row-s">${esc(c.mobile || '')}${c.address ? ' · ' + esc(c.address) : ''}</div>
          </div>
          <div class="row-actions">
            <button class="mini edit" id="c-edit">✎</button>
            <button class="mini del" id="c-del">🗑</button>
          </div>
        </div>
        <div class="stat-grid two">
          <div class="stat green"><span class="stat-l">মোট কেনাকাটা</span><b>${fmtMoney(totalBuy)}</b><small>${toBn(cSales.length)}টি বিল</small></div>
          <div class="stat ${due > 0 ? 'red' : due < 0 ? 'teal' : 'green'}"><span class="stat-l">${due > 0 ? 'মোট বাকি' : due < 0 ? 'অগ্রিম' : 'পরিশোধিত'}</span><b>${fmtMoney(Math.abs(due))}</b><small>বর্তমান হিসাব</small></div>
        </div>
        <div class="btn-row wrap">
          <button class="btn save sm" id="c-pay">💵 বাকি পরিশোধ</button>
          <button class="btn amber sm" id="c-due-add">➕ বাকি যোগ</button>
          <button class="btn blue sm" id="c-share">↗ হিসাব শেয়ার</button>
          <button class="btn cancel sm" id="c-stmt">🖨 প্রিন্ট/স্টেটমেন্ট</button>
        </div>
      </div>
      <div class="card"><div class="card-head"><h3>লেনদেনের বিবরণ</h3></div><div class="list" id="c-ledger"></div></div>`;

    $('#c-back').onclick = () => go('customers');
    $('#c-edit').onclick = () => go('customerForm', { editCustomerId: c.id });
    $('#c-del').onclick = () => {
      confirmBox('কাস্টমার ডিলিট করতে চান?').then(async ok => {
        if (!ok) return;
        await DB.del('customers', c.id);
        await refreshData();
        toast('কাস্টমার ডিলিট হয়েছে');
        go('customers');
      });
    };
    $('#c-pay').onclick = () => openDueForm(c, 1);
    $('#c-due-add').onclick = () => openDueForm(c, -1);
    $('#c-share').onclick = () => shareCustomer(c);
    $('#c-stmt').onclick = () => makeStatementCanvas(statementCfg(c), cv => openStatementModal(cv, 'কাস্টমার স্টেটমেন্ট', statementTextOf(c)));

    const ledger = []
      .concat(cSales.map(s => ({ d: s.date, createdAt: s.createdAt, t: 'sale', s })))
      .concat(cPays.map(p => ({ d: p.date, createdAt: p.createdAt, t: 'pay', p })))
      .sort((a, b) => (b.d + b.createdAt).localeCompare(a.d + a.createdAt));

    $('#c-ledger').innerHTML = ledger.length ? ledger.map(l => l.t === 'sale' ? `
      <div class="row">
        <span class="row-ic">🛒</span>
        <div class="row-main">
          <div class="row-t">${l.s.items.map(i => esc(i.name) + ' ×' + toBn(fmtNum(i.qty))).join(', ')}</div>
          <div class="row-s">${dateBn(l.d)}${l.s.note ? ' · ' + esc(l.s.note) : ''}</div>
        </div>
        <div class="row-amt ${l.s.due > 0 ? 'red' : 'green'}">${fmtMoney(l.s.total)}${l.s.due > 0 ? '<small class="due-red">বাকি ' + fmtMoney(l.s.due) + '</small>' : ''}</div>
        <div class="row-actions">
          <button class="mini edit" data-es="${l.s.id}">✎</button>
          <button class="mini del" data-ds="${l.s.id}">🗑</button>
        </div>
      </div>` : `
      <div class="row">
        <span class="row-ic">${l.p.amount >= 0 ? '💵' : '➕'}</span>
        <div class="row-main">
          <div class="row-t">${l.p.amount >= 0 ? 'মোট বাকি পরিশোধ' : 'মোট বাকি যোগ'}${l.p.note ? ' — ' + esc(l.p.note) : ''}</div>
          <div class="row-s">${dateBn(l.d)}</div>
        </div>
        <div class="row-amt ${l.p.amount >= 0 ? 'green' : 'red'}">${fmtMoney(Math.abs(l.p.amount))}</div>
        <div class="row-actions"><button class="mini edit" data-epay="${l.p.id}">✎</button><button class="mini del" data-dp="${l.p.id}">🗑</button></div>
      </div>`).join('') : '<div class="empty">কোনো লেনদেন নেই</div>';

    $$('[data-es]', v).forEach(b => b.onclick = () => go('sale', { editSaleId: b.dataset.es }));
    $$('[data-ds]', v).forEach(b => b.onclick = () => deleteSale(b.dataset.ds));
    $$('[data-epay]', v).forEach(b => b.onclick = () => {
      const p = cPays.find(x => x.id === b.dataset.epay);
      if (p) openDueForm(c, p.amount >= 0 ? 1 : -1, p);
    });
    $$('[data-dp]', v).forEach(b => b.onclick = () => {
      confirmBox('এই লেনদেন ডিলিট করতে চান?').then(async ok => {
        if (!ok) return;
        await DB.del('payments', b.dataset.dp);
        await refreshData();
        toast('ডিলিট হয়েছে');
        route();
      });
    });
  }

  function openDueForm(c, sign, existing) {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    const amt = existing ? Math.abs(existing.amount) : 0;
    wrap.innerHTML = `
      <div class="modal-card">
        <h3>${sign > 0 ? 'বাকি পরিশোধ' : 'বাকি যোগ'} — ${esc(c.name)}</h3>
        <label class="f-l">তারিখ</label>
        <input id="d-date" type="date" value="${existing ? existing.date : todayStr()}">
        <label class="f-l">পরিমাণ</label>
        <input id="d-amount" class="calc-field" value="${amt ? fmtNum(amt) : ''}" placeholder="৳০">
        <label class="f-l">নোট</label>
        <input id="d-note" value="${existing ? esc(existing.note || '') : ''}" placeholder="ঐচ্ছিক">
        <div class="btn-row">
          <button class="btn cancel" id="d-cancel">বাতিল</button>
          <button class="btn save" id="d-save">${existing ? 'সংশোধন সংরক্ষণ' : 'সংরক্ষণ'}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    $('#d-cancel', wrap).onclick = () => wrap.remove();
    $('#d-save', wrap).onclick = async () => {
      const save = async value => {
        await DB.put('payments', {
          id: existing ? existing.id : uid(),
          createdAt: existing ? existing.createdAt : Date.now(),
          date: $('#d-date', wrap).value || todayStr(),
          customerId: c.id, amount: sign * value, note: $('#d-note', wrap).value.trim()
        });
        await refreshData();
        wrap.remove();
        toast(existing ? 'সংশোধন হয়েছে ✓' : 'সংরক্ষিত ✓');
        route();
      };
      const v0 = Math.abs(Number($('#d-amount', wrap).value) || 0);
      if (!v0) return toast('পরিমাণ দিন', false);
      if (existing && v0 !== Math.abs(existing.amount)) {
        const dt = $('#d-date', wrap).value;
        await DB.put('payments', {
          id: uid(), createdAt: Date.now(), date: dt || todayStr(),
          customerId: c.id, amount: -existing.amount,
          note: 'সংশোধন — আগের ' + fmtMoney(Math.abs(existing.amount)) + ' বাতিল'
        });
      }
      if (sign > 0 && v0 > salesDueOf(c.id) - paymentsSumOf(c.id)) {
        toast('বাকির চেয়ে বেশি পরিশোধ — অতিরিক্তটি অগ্রিম হিসেবে থাকবে');
      }
      save(v0);
    };
  }
  /* ---------- হিসাব ট্যাব ---------- */
  function renderEntries(v) {
    v.innerHTML = `
      <div class="tabs">
        <button class="tab ${entryTab === 'ledger' ? 'on' : ''}" data-tab="ledger">আয়-ব্যয়</button>
        <button class="tab ${entryTab === 'sales' ? 'on' : ''}" data-tab="sales">বিক্রয় তালিকা</button>
        <button class="tab ${entryTab === 'purchases' ? 'on' : ''}" data-tab="purchases">ক্রয় তালিকা</button>
      </div>
      <div id="tab-body"></div>`;
    $$('[data-tab]', v).forEach(b => b.onclick = () => { entryTab = b.dataset.tab; renderEntries(v); });
    ({ ledger: renderLedgerTab, sales: renderSalesTab, purchases: renderPurchasesTab }[entryTab])(v);
  }

  function renderLedgerTab(v) {
    const ed = editing.entryId ? entries.find(e => e.id === editing.entryId) : null;
    const t = todayStr();
    v.innerHTML = `
      <div class="card">
        <h3>${ed ? 'এন্ট্রি সংশোধন' : 'আয় / ব্যয় এন্ট্রি'}</h3>
        <div class="seg">
          <button type="button" class="seg-btn ${(!ed || ed.type === 'income') ? 'on' : ''}" data-type="income">➕ আয়</button>
          <button type="button" class="seg-btn ${ed && ed.type === 'expense' ? 'on' : ''}" data-type="expense">➖ ব্যয়</button>
        </div>
        <div class="grid2">
          <div><label class="f-l">তারিখ</label><input id="e-date" type="date" value="${ed ? ed.date : t}"></div>
          <div><label class="f-l">খাত</label><input id="e-cat" value="${ed ? esc(ed.category || '') : ''}" placeholder="যেমন: বেতন, ভাড়া"></div>
        </div>
        <label class="f-l">পরিমাণ *</label>
        <input id="e-amount" class="calc-field" value="${ed ? fmtNum(ed.amount) : ''}" placeholder="৳০">
        <label class="f-l">নোট</label>
        <input id="e-note" value="${ed ? esc(ed.note || '') : ''}" placeholder="ঐচ্ছিক">
        <div class="btn-row">
          ${ed ? '<button class="btn cancel" id="e-del">ডিলিট</button>' : ''}
          <button class="btn save" id="e-save">${ed ? 'সংশোধন সংরক্ষণ' : 'এন্ট্রি সংরক্ষণ'}</button>
        </div>
      </div>
      <div class="card"><div class="card-head"><h3>আয়-ব্যয়ের তালিকা</h3></div><div class="list" id="e-list"></div></div>`;

    let type = ed ? ed.type : 'income';
    $$('.seg-btn', v).forEach(b => b.onclick = () => {
      type = b.dataset.type;
      $$('.seg-btn', v).forEach(x => x.classList.toggle('on', x === b));
    });

    $('#e-save').onclick = async () => {
      const amount = Number($('#e-amount').value) || 0;
      if (amount <= 0) return toast('পরিমাণ লিখুন', false);
      await DB.put('entries', {
        id: ed ? ed.id : uid(), createdAt: ed ? ed.createdAt : Date.now(),
        date: $('#e-date').value || t, type, amount,
        category: $('#e-cat').value.trim(), note: $('#e-note').value.trim()
      });
      await refreshData();
      toast('সংরক্ষিত ✓');
      go('entries');
    };
    if (ed) $('#e-del').onclick = () => {
      confirmBox('এই এন্ট্রি ডিলিট করতে চান?').then(async ok => {
        if (!ok) return;
        await DB.del('entries', ed.id);
        await refreshData();
        toast('ডিলিট হয়েছে');
        go('entries');
      });
    };

    $('#e-list').innerHTML = entries.length ? entries.map(e => `
      <div class="row">
        <span class="row-ic">${e.type === 'income' ? '➕' : '➖'}</span>
        <div class="row-main">
          <div class="row-t">${esc(e.category || (e.type === 'income' ? 'আয়' : 'ব্যয়'))}${e.note ? ' — ' + esc(e.note) : ''}</div>
          <div class="row-s">${dateBn(e.date)}</div>
        </div>
        <div class="row-amt ${e.type === 'income' ? 'green' : 'red'}">${fmtMoney(e.amount)}</div>
        <div class="row-actions"><button class="mini edit" data-ed="${e.id}">✎</button><button class="mini del" data-ddel="${e.id}">🗑</button></div>
      </div>`).join('') : '<div class="empty">কোনো এন্ট্রি নেই</div>';
    $$('[data-ed]', $('#e-list')).forEach(b => b.onclick = () => go('entries', { editEntryId: b.dataset.ed }));
    $$('[data-ddel]', $('#e-list')).forEach(b => b.onclick = () => {
      confirmBox('এই এন্ট্রিটি ডিলিট করতে চান?').then(async ok => {
        if (!ok) return;
        await DB.del('entries', b.dataset.ddel);
        await refreshData();
        toast('ডিলিট হয়েছে');
        renderLedgerTab(v);
      });
    });
  }

  function renderSalesTab(v) {
    v.innerHTML = `<div class="card"><div class="card-head"><h3>বিক্রয় তালিকা</h3>
      <button class="link-btn" data-qsale>নতুন বিক্রয়</button></div><div class="list" id="s-list"></div></div>`;
    $('[data-qsale]', v).onclick = () => go('sale');
    $('#s-list', v).innerHTML = sales.length ? sales.map(s => `
      <div class="row">
        <span class="row-ic">🛒</span>
        <div class="row-main">
          <div class="row-t">বিক্রয় — ${esc(s.customerName || 'নগদ')}</div>
          <div class="row-s">${dateBn(s.date)} · ${s.items.map(i => esc(i.name) + ' ×' + toBn(fmtNum(i.qty))).join(', ')}</div>
          <div class="row-s">লাভ ${fmtMoney(s.profit)}${s.due > 0 ? ' · <i class="due-red">বাকি ' + fmtMoney(s.due) + '</i>' : ''}</div>
        </div>
        <div class="row-amt green">${fmtMoney(s.total)}</div>
        <div class="row-actions">
          <button class="mini edit" data-es="${s.id}">✎</button>
          <button class="mini del" data-ds="${s.id}">🗑</button>
        </div>
      </div>`).join('') : '<div class="empty">কোনো বিক্রয় নেই</div>';
    $('#s-list', v).querySelectorAll('[data-es]').forEach(b => b.onclick = () => go('sale', { editSaleId: b.dataset.es }));
    $('#s-list', v).querySelectorAll('[data-ds]').forEach(b => b.onclick = () => deleteSale(b.dataset.ds));
  }

  function renderPurchasesTab(v) {
    v.innerHTML = `<div class="card"><div class="card-head"><h3>ক্রয় তালিকা</h3>
      <button class="link-btn" data-qpur>নতুন ক্রয়</button></div><div class="list" id="p-list"></div></div>`;
    $('[data-qpur]', v).onclick = () => go('purchase');
    $('#p-list', v).innerHTML = purchases.length ? purchases.map(p => `
      <div class="row">
        <span class="row-ic">📥</span>
        <div class="row-main">
          <div class="row-t">${esc(p.name)}</div>
          <div class="row-s">${dateBn(p.date)} · ${toBn(fmtNum(p.qty))} ${esc(p.unit || '')} × ${fmtMoney(p.price)}</div>
        </div>
        <div class="row-amt blue">${fmtMoney(p.total)}</div>
        <div class="row-actions">
          <button class="mini edit" data-ep="${p.id}">✎</button>
          <button class="mini del" data-dp2="${p.id}">🗑</button>
        </div>
      </div>`).join('') : '<div class="empty">কোনো ক্রয় নেই</div>';
    $('#p-list', v).querySelectorAll('[data-ep]').forEach(b => b.onclick = () => go('purchase', { editPurchaseId: b.dataset.ep }));
    $('#p-list', v).querySelectorAll('[data-dp2]').forEach(b => b.onclick = () => deletePurchase(b.dataset.dp2));
  }

  /* ---------- শেয়ার ---------- */
  const Shop = { name: 'আমার হিসাব', mobile: '', logo: '' };
  async function loadShop() {
    try {
      const s = JSON.parse(localStorage.getItem('amar-hishab-shop') || 'null');
      if (s) Object.assign(Shop, s);
    } catch (e) {}
  }

  function shareText(text) {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="modal-card">
        <h3>হিসাব শেয়ার করুন</h3>
        <textarea id="sh-text" rows="6" readonly></textarea>
        <div class="share-grid">
          <a class="share-btn wa" id="sh-wa"><span>💬</span>হোয়াটসঅ্যাপ</a>
          <a class="share-btn ms" id="sh-msgr"><span>✉️</span>মেসেঞ্জার</a>
          <a class="share-btn sms" id="sh-sms"><span>📩</span>মেসেজ (SMS)</a>
          <a class="share-btn" id="sh-sys"><span>↗</span>অন্যান্য অ্যাপ</a>
        </div>
        <div class="btn-row">
          <button class="btn cancel" id="sh-close">বন্ধ</button>
          <button class="btn blue" id="sh-copy">📋 কপি</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    $('#sh-text', wrap).value = text;
    const u = encodeURIComponent(text);
    const close = () => wrap.remove();

    $('#sh-wa', wrap).onclick = () => { close(); window.open('https://wa.me/?text=' + u, '_blank', 'noopener'); };

    $('#sh-msgr', wrap).onclick = async () => {
      try { await navigator.clipboard.writeText(text); toast('মেসেজ কপি হয়েছে — মেসেঞ্জারে পেস্ট করুন ✓'); } catch (e) {}
      close();
      try { window.open('fb-messenger://', '_blank'); } catch (e) { window.open('https://www.messenger.com/', '_blank', 'noopener'); }
    };

    $('#sh-sms', wrap).onclick = () => { close(); window.open('sms:?body=' + u, '_blank'); };

    $('#sh-sys', wrap).onclick = async () => {
      if (navigator.share) {
        try { await navigator.share({ title: Shop.name || 'আমার হিসাব', text }); close(); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      try { await navigator.clipboard.writeText(text); toast('কপি হয়েছে — যেকোনো অ্যাপে পেস্ট করুন ✓'); } catch (e) { toast('কপি করতে ব্যর্থ', false); }
    };

    $('#sh-copy', wrap).onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast('কপি হয়েছে ✓');
      } catch (e) {
        const ta = $('#sh-text', wrap);
        ta.removeAttribute('readonly');
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); toast('কপি হয়েছে ✓'); } catch (e2) { toast('টেক্সট ম্যানুয়ালি কপি করুন', false); }
      }
    };

    $('#sh-close', wrap).onclick = close;
  }

  function statementTextOf(c) {
    const due = dueOf(c.id);
    const cSales = sales.filter(s => s.customerId === c.id);
    const cPays = payments.filter(p => p.customerId === c.id);
    let text = `*হিসাব বিবরণী*\nকাস্টমার: ${c.name}\n`;
    if (c.mobile) text += `মোবাইল: ${c.mobile}\n`;
    text += `তারিখ: ${dateBn(todayStr())}\n\nলেনদেন:\n`;
    const ledger = []
      .concat(cSales.map(s => ({ d: s.date, t: 'sale', s })))
      .concat(cPays.map(p => ({ d: p.date, t: 'pay', p })))
      .sort((a, b) => a.d.localeCompare(b.d));
    ledger.forEach(l => {
      if (l.t === 'sale') text += `${dateBn(l.d)} — বিক্রয়: ${fmtMoney(l.s.total)}${l.s.due > 0 ? ' (বাকি ' + fmtMoney(l.s.due) + ')' : ''}\n`;
      else text += `${dateBn(l.d)} — ${l.p.amount >= 0 ? 'পরিশোধ' : 'বাকি যোগ'}: ${fmtMoney(Math.abs(l.p.amount))}\n`;
    });
    if (!ledger.length) text += '(কোনো লেনদেন নেই)\n';
    text += `\n${due > 0 ? 'মোট বাকির পরিমাণ: ' + fmtMoney(due) : due < 0 ? 'অগ্রিম: ' + fmtMoney(-due) : 'সব পরিশোধিত ✓'}\n— ${Shop.name}${Shop.mobile ? ' (' + Shop.mobile + ')' : ''}`;
    return text;
  }

  function shareCustomer(c) {
    shareText(statementTextOf(c));
  }

  function shareDay() {
    const t = todayStr();
    const ds = sales.filter(s => s.date === t);
    const total = ds.reduce((a, s) => a + s.total, 0);
    const profit = ds.reduce((a, s) => a + s.profit, 0);
    const inc = entries.filter(e => e.date === t && e.type === 'income').reduce((a, e) => a + e.amount, 0);
    const exp = entries.filter(e => e.date === t && e.type === 'expense').reduce((a, e) => a + e.amount, 0);
    const pur = purchases.filter(p => p.date === t).reduce((a, p) => a + p.total, 0);
    let text = `*দৈনিক হিসাব — ${dateBn(t)}*\n\nমোট বিক্রয়: ${fmtMoney(total)} (${toBn(ds.length)}টি বিল)\nমোট ক্রয়: ${fmtMoney(pur)}\nনিট লাভ: ${fmtMoney(profit)}\nআয় (বিক্রয় বাহিরে): ${fmtMoney(inc)}\nব্যয়: ${fmtMoney(exp)}\n`;
    if (ds.length) {
      text += '\nবিক্রয়ের বিবরণ:\n';
      ds.forEach(s => text += `• ${s.customerName || 'নগদ'}: ${fmtMoney(s.total)}${s.due > 0 ? ' (বাকি ' + fmtMoney(s.due) + ')' : ''}\n`);
    }
    text += `\n— ${Shop.name}`;
    shareText(text);
  }

  /* ---------- সেটিংস / ব্যাকআপ ---------- */
  function renderSettings(v) {
    v.innerHTML = `
      <button class="back" id="st-back">← হোম</button>
      <div class="card">
        <h3>দোকানের তথ্য (শেয়ারের জন্য)</h3>
        <div class="avatar-row">
          <div class="avatar big" id="st-logo-box">${Shop.logo ? '<img src="' + Shop.logo + '">' : '🏪'}</div>
          <div class="avatar-actions">
            <button class="btn blue sm" id="st-logo-btn" type="button">দোকানের ছবি/লোগো যোগ</button>
            <button class="btn cancel sm" id="st-logo-rm" type="button" style="display:${Shop.logo ? '' : 'none'}">মুছুন</button>
          </div>
        </div>
        <label class="f-l">দোকানের নাম</label>
        <input id="st-name" value="${esc(Shop.name)}">
        <label class="f-l">মোবাইল</label>
        <input id="st-mobile" class="mid" value="${esc(Shop.mobile || '')}" placeholder="01XXXXXXXXX">
        <button class="btn save" id="st-save">সংরক্ষণ</button>
      </div>
      <div class="card">
        <h3>ব্যাকআপ ও রিস্টোর</h3>
        <p class="row-s">সকল হিসাব একটি ফাইলে সংরক্ষণ করুন বা আগের ব্যাকআপ থেকে ফিরিয়ে আনুন।</p>
        <div class="btn-row wrap">
          <button class="btn blue sm" id="st-export">⬇ ব্যাকআপ ডাউনলোড</button>
          <button class="btn amber sm" id="st-import">⬆ রিস্টোর</button>
        </div>
        <input type="file" id="st-file" accept=".json" style="display:none">
      </div>
      <div class="card">
        <h3>থিম (ব্রাইট / ডার্ক)</h3>
        <div class="seg" id="theme-seg">
          <button type="button" class="seg-btn ${currentTheme() === 'dark' ? '' : 'on'}" data-theme-btn="light">☀️ ব্রাইট</button>
          <button type="button" class="seg-btn ${currentTheme() === 'dark' ? 'on' : ''}" data-theme-btn="dark">🌙 ডার্ক</button>
        </div>
      </div>
      <div class="card">
        <h3>অ্যাপ ইনস্টল</h3>
        <p class="row-s">এই অ্যাপটি সম্পূর্ণ অফলাইনে চলে। ফোনে স্থায়ীভাবে ইনস্টল করতে ব্রাউজার মেনু থেকে "অ্যাপ ইনস্টল / Add to Home Screen" নির্বাচন করুন।</p>
        ${deferredPrompt ? '<button class="btn save" id="st-install">📲 এখনই ইনস্টল করুন</button>' : ''}
      </div>
      <div class="card">
        <h3>ডেটা মুছুন</h3>
        <p class="row-s">সতর্কতা: সকল পণ্য, কাস্টমার ও হিসাব স্থায়ীভাবে মুছে যাবে। আগে ব্যাকআপ নিন।</p>
        <button class="btn cancel" id="st-clear">সব ডেটা মুছুন</button>
      </div>
      <div class="card"><p class="row-s">সংস্করণ ১.২.০ · সম্পূর্ণ অফলাইন অ্যাপ · স্টোরেজ: ${DB.usingFallback ? 'লোকাল স্টোরেজ' : 'IndexedDB'}</p></div>`;

    $('#st-back').onclick = () => go('home');
    $$('[data-theme-btn]', v).forEach(b => b.onclick = () => {
      applyTheme(b.dataset.themeBtn);
      renderSettings(v);
    });
    $('#st-save').onclick = () => {
      Shop.name = $('#st-name').value.trim() || 'আমার হিসাব';
      Shop.mobile = $('#st-mobile').value.trim();
      try { localStorage.setItem('amar-hishab-shop', JSON.stringify(Shop)); } catch (e) {}
      renderHeader();
      toast('সংরক্ষিত ✓');
    };

    $('#st-logo-btn').onclick = () => pickImage(u => {
      Shop.logo = u;
      try { localStorage.setItem('amar-hishab-shop', JSON.stringify(Shop)); } catch (e) {}
      renderHeader();
      renderSettings(v);
    });
    $('#st-logo-rm').onclick = () => {
      Shop.logo = '';
      try { localStorage.setItem('amar-hishab-shop', JSON.stringify(Shop)); } catch (e) {}
      renderHeader();
      renderSettings(v);
    };

    $('#st-export').onclick = async () => {
      const data = await DB.export();
      data.shop = Shop;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'amar-hishab-backup-' + todayStr() + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    };

    $('#st-import').onclick = () => $('#st-file').click();
    $('#st-file').onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        confirmBox('ব্যাকআপ রিস্টোর করলে বর্তমান ডেটা প্রতিস্থাপিত হবে। চালিয়ে যাবেন?').then(async ok => {
          if (!ok) return;
          try {
            const data = JSON.parse(r.result);
            if (data.shop) Object.assign(Shop, data.shop);
            try { localStorage.setItem('amar-hishab-shop', JSON.stringify(Shop)); } catch (e2) {}
            await DB.import(data);
            renderHeader();
            await refreshData();
            toast('ব্যাকআপ রিস্টোর সম্পন্ন ✓');
            go('home');
          } catch (err) { toast('ব্যাকআপ ফাইল পড়া যায়নি', false); }
        });
      };
      r.readAsText(f);
    };

    const instBtn = $('#st-install');
    if (instBtn) instBtn.onclick = async () => {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    };

    $('#st-clear').onclick = () => {
      confirmBox('সত্যিই সব ডেটা মুছে ফেলতে চান? (আগে ব্যাকআপ নিন)').then(async ok => {
        if (!ok) return;
        await DB.clearAll();
        await refreshData();
        toast('সব ডেটা মুছে ফেলা হয়েছে');
        go('home');
      });
    };
  }

  /* ---------- থিম (ডার্ক/ব্রাইট) ---------- */
  function currentTheme() {
    try { return localStorage.getItem('amar-hishab-theme') || 'light'; } catch (e) { return 'light'; }
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('amar-hishab-theme', theme); } catch (e) {}
  }

  /* ---------- সার্ভিস ওয়ার্কার / ইনস্টল ---------- */
  function registerSW() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
    });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  /* ---------- শুরু ---------- */
  async function boot() {
    applyTheme(currentTheme());
    registerSW();
    $('#btn-settings').onclick = () => go('settings');
    $$('#bottom-nav button').forEach(b => b.onclick = () => go(b.dataset.route));
    await DB.open();
    await loadShop();
    renderHeader();
    await refreshData();
    route();
  }

  /* ---------- রশিদ ও স্টেটমেন্ট (ছবি) ---------- */
  function fitText(x2, s, w) {
    s = String(s);
    if (x2.measureText(s).width <= w) return s;
    while (s.length && x2.measureText(s + '…').width > w) s = s.slice(0, -1);
    return s + '…';
  }

  function loadShopLogo() {
    return new Promise(res => {
      if (!Shop.logo) return res(null);
      const img = new Image();
      const t = setTimeout(() => res(null), 1500);
      img.onload = () => { clearTimeout(t); res(img); };
      img.onerror = () => { clearTimeout(t); res(null); };
      img.src = Shop.logo;
    });
  }

  function makeStatementCanvas(cfg, cb) {
    loadShopLogo().then(logo => {
      const W = 780, P = 40;
      const meta = cfg.meta || [];
      const H = 205 + meta.length * 24 + 38 + cfg.rows.length * 40 + 16 + cfg.totals.length * 34 + 110;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const x = cv.getContext('2d');

      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, W, H);
      x.fillStyle = '#15803d';
      x.fillRect(0, 0, W, 108);

      let centerX = W / 2;
      if (logo) {
        x.save();
        x.beginPath();
        x.arc(P + 30, 54, 29, 0, Math.PI * 2);
        x.clip();
        const ls = Math.min(58 / logo.width, 58 / logo.height);
        x.drawImage(logo, P + 30 - logo.width * ls / 2, 54 - logo.height * ls / 2, logo.width * ls, logo.height * ls);
        x.restore();
        centerX = (P + 64) / 2 + W / 2;
      }
      x.fillStyle = '#ffffff';
      x.font = 'bold 30px "Noto Sans Bengali", sans-serif';
      x.textAlign = 'center';
      x.fillText(fitText(x, Shop.name || 'আমার হিসাব', W - 160), centerX, 62);

      if (cfg.title) {
        x.fillStyle = '#15803d';
        x.font = 'bold 22px "Noto Sans Bengali", sans-serif';
        x.fillText(cfg.title, W / 2, 148);
      }
      x.fillStyle = '#6b7280';
      x.font = '15px "Noto Sans Bengali", sans-serif';
      x.fillText(dateBn(cfg.date || todayStr()), W / 2, 176);

      let y = 205;
      const BN = '"Noto Sans Bengali", sans-serif';
      meta.forEach(m => {
        x.fillStyle = '#374151';
        x.font = '15px ' + BN;
        x.textAlign = 'left';
        x.fillText(fitText(x, m.k + ': ' + m.v, W - P * 2), P, y);
        y += 24;
      });

      y += 6;
      x.fillStyle = '#f3f4f6';
      x.fillRect(P, y - 18, W - P * 2, 30);
      x.fillStyle = '#15803d';
      x.font = 'bold 15px ' + BN;
      cfg.cols.forEach(col => {
        x.textAlign = col.align || 'left';
        x.fillText(col.label, col.x, y);
      });
      y += 30;

      x.font = '15px ' + BN;
      cfg.rows.forEach((r, i) => {
        if (i % 2 === 0) {
          x.fillStyle = '#fafafa';
          x.fillRect(P, y - 16, W - P * 2, 30);
        }
        x.fillStyle = '#111827';
        r.c.forEach((cell, ci) => {
          const col = cfg.cols[ci];
          x.textAlign = col.align || 'left';
          x.fillText(fitText(x, cell, col.w || 200), col.x, y);
        });
        y += 40;
      });

      y += 12;
      x.textAlign = 'right';
      cfg.totals.forEach(tl => {
        x.font = (tl.bold ? 'bold 17px ' : '15px ') + BN;
        x.fillStyle = tl.color || '#111827';
        x.fillText(tl.label, W - P - 180, y);
        x.fillText(fitText(x, tl.value, 170), W - P, y);
        y += 34;
      });

      y += 14;
      x.textAlign = 'center';
      x.fillStyle = '#15803d';
      x.font = 'bold 17px ' + BN;
      x.fillText('ধন্যবাদ! আবার আসবেন', W / 2, Math.min(y + 24, H - 56));
      x.fillStyle = '#9ca3af';
      x.font = '13px ' + BN;
      x.fillText('— আমার হিসাব অ্যাপ দিয়ে তৈরি —', W / 2, Math.min(y + 50, H - 32));
      if (Shop.mobile) x.fillText('☎ ' + Shop.mobile, W / 2, Math.min(y + 72, H - 12));

      cb(cv);
    });
  }

  function receiptCfg(s, c) {
    const rows = (s.items || []).map(i => ({
      c: [i.name, toBn(fmtNum(i.qty)) + ' ' + (i.unit || ''), fmtMoney(i.price), fmtMoney(i.qty * i.price)]
    }));
    return {
      title: 'বিক্রয় রশিদ',
      date: s.date,
      meta: [
        { k: 'রশিদ নং', v: toBn(s.id.slice(-6).toUpperCase()) },
        { k: 'কাস্টমার', v: c ? c.name + (c.mobile ? ' — ' + c.mobile : '') : 'নগদ কাস্টমার' }
      ].concat(s.note ? [{ k: 'নোট', v: s.note }] : []),
      cols: [
        { label: 'পন্য', x: 40, align: 'left', w: 380 },
        { label: 'পরিমাণ', x: 440, align: 'left', w: 110 },
        { label: 'দাম', x: 570, align: 'left', w: 90 },
        { label: 'মোট', x: 740, align: 'right', w: 40 }
      ],
      rows,
      totals: [
        { label: 'মোট বিল', value: fmtMoney(s.total) },
        { label: 'নগদ পরিশোধ', value: fmtMoney(s.paid) },
        { label: 'বাকি', value: fmtMoney(s.due), bold: true, color: '#dc2626' }
      ]
    };
  }

  function statementCfg(c) {
    const due = dueOf(c.id);
    const cSales = sales.filter(s => s.customerId === c.id);
    const cPays = payments.filter(p => p.customerId === c.id);
    const ledger = []
      .concat(cSales.map(s => ({ d: s.date, createdAt: s.createdAt, t: 'sale', s })))
      .concat(cPays.map(p => ({ d: p.date, createdAt: p.createdAt, t: 'pay', p })))
      .sort((a, b) => (a.d + a.createdAt).localeCompare(b.d + b.createdAt));
    const rows = ledger.map(l => {
      const desc = l.t === 'sale'
        ? 'বিক্রয়' + (l.s.note ? ' — ' + l.s.note : '')
        : (l.p.amount >= 0 ? 'বাকি পরিশোধ' : 'বাকি যোগ') + (l.p.note ? ' — ' + l.p.note : '');
      const amt = l.t === 'sale' ? l.s.total : Math.abs(l.p.amount);
      return { c: [dateBn(l.d), desc, fmtMoney(amt)] };
    });
    if (!rows.length) rows.push({ c: ['—', '(কোনো লেনদেন নেই)', '—'] });
    return {
      title: 'কাস্টমার স্টেটমেন্ট',
      date: todayStr(),
      meta: [
        { k: 'কাস্টমার', v: c.name + (c.mobile ? ' — ' + c.mobile : '') },
        { k: 'ঠিকানা', v: c.address || '—' }
      ],
      cols: [
        { label: 'তারিখ', x: 40, align: 'left', w: 150 },
        { label: 'বিবরণ', x: 210, align: 'left', w: 380 },
        { label: 'মোট', x: 740, align: 'right', w: 100 }
      ],
      rows,
      totals: [
        { label: 'মোট বিক্রয়', value: fmtMoney(cSales.reduce((a, s) => a + s.total, 0)) },
        { label: 'মোট পরিশোধ', value: fmtMoney(cSales.reduce((a, s) => a + s.paid, 0) + cPays.filter(p => p.amount > 0).reduce((a, p) => a + p.amount, 0)) },
        { label: 'বকেয়া', value: fmtMoney(due), bold: true, color: due > 0 ? '#dc2626' : '#15803d' }
      ]
    };
  }

  function receiptTextOf(s) {
    let text = '*বিক্রয় রশিদ*\nতারিখ: ' + dateBn(s.date) + '\nরশিদ নং: ' + toBn(s.id.slice(-6).toUpperCase()) + '\n';
    text += 'কাস্টমার: ' + (s.customerName || 'নগদ') + '\n\n';
    (s.items || []).forEach(i => {
      text += '• ' + i.name + ' ×' + toBn(fmtNum(i.qty)) + ' = ' + fmtMoney(i.qty * i.price) + '\n';
    });
    text += '\nমোট বিল: ' + fmtMoney(s.total) + '\nনগদ পরিশোধ: ' + fmtMoney(s.paid) + '\nবাকি: ' + fmtMoney(s.due) + '\n\n— ' + Shop.name;
    return text;
  }

  function downloadCanvas(cv, name) {
    try {
      const a = document.createElement('a');
      a.href = cv.toDataURL('image/png');
      a.download = name;
      a.click();
      toast('ছবি সেভ হয়েছে ✓');
    } catch (e) { toast('সেভ করা যায়নি', false); }
  }

  function shareCanvas(cv, title, fallbackText) {
    try {
      if (cv.toBlob && navigator.canShare) {
        cv.toBlob(blob => {
          if (blob) {
            const file = new File([blob], title + '.png', { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
              navigator.share({ files: [file], title }).then(() => {}, () => {});
              return;
            }
          }
          shareText(fallbackText || '');
        }, 'image/png');
        return;
      }
    } catch (e) {}
    shareText(fallbackText || '');
  }

  function printCanvas(cv, name) {
    try {
      const w = window.open('', '_blank');
      if (!w) throw new Error('popup');
      w.document.write('<html><head><title>' + name + '</title></head><body style="margin:0;text-align:center"><img src="' + cv.toDataURL('image/png') + '" style="max-width:100%" onload="window.print()"></body></html>');
      w.document.close();
    } catch (e) {
      downloadCanvas(cv, name + '.png');
      toast('প্রিন্ট পেজ খোলা যায়নি — ছবি সেভ করা হয়েছে', false);
    }
  }

  function openStatementModal(cv, title, fallbackText) {
    const url = cv.toDataURL('image/png');
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="modal-card">
        <h3>${esc(title)}</h3>
        <img src="${url}" class="stmt-img">
        <div class="btn-row wrap">
          <button class="btn cancel sm" id="sm-close">বন্ধ</button>
          <button class="btn amber sm" id="sm-save">📥 সেভ</button>
          <button class="btn cancel sm" id="sm-print">🖨 প্রিন্ট</button>
          <button class="btn blue sm" id="sm-share">↗ শেয়ার</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    $('#sm-close', wrap).onclick = () => wrap.remove();
    $('#sm-save', wrap).onclick = () => downloadCanvas(cv, title + '-' + todayStr() + '.png');
    $('#sm-print', wrap).onclick = () => printCanvas(cv, title + '-' + todayStr());
    $('#sm-share', wrap).onclick = () => shareCanvas(cv, title, fallbackText || '');
  }

  function renderReceipt(v) {
    const s = sales.find(x => x.id === editing.openSaleId);
    if (!s) { v.innerHTML = '<div class="card"><p>রশিদ পাওয়া যায়নি</p><button class="btn save" id="rr-home">হোম</button></div>'; $('#rr-home', v).onclick = () => go('home'); return; }
    const c = s.customerId ? customerById(s.customerId) : null;
    v.innerHTML = `
      <button class="back" id="rc-back">← হোম</button>
      <div class="card">
        <div class="card-head"><h3>বিক্রয় রশিদ</h3><button class="link-btn" data-go="home">🏠 হোম</button></div>
        <canvas id="rc-img" class="rc-canvas"></canvas>
        <div class="btn-row wrap">
          <button class="btn blue sm" id="rc-share">↗ শেয়ার</button>
          <button class="btn amber sm" id="rc-save">📥 ফোনে সেভ</button>
          <button class="btn cancel sm" id="rc-print">🖨 প্রিন্ট</button>
        </div>
      </div>`;

    const rc = $('#rc-img', v);
    let rcv = null;
    makeStatementCanvas(receiptCfg(s, c), cv => {
      rcv = cv;
      rc.width = cv.width;
      rc.height = cv.height;
      rc.getContext('2d').drawImage(cv, 0, 0);
    });

    $('#rc-back').onclick = () => go('home');
    $$('[data-go]', v).forEach(b => b.onclick = () => go(b.dataset.go));
    $('#rc-share').onclick = () => shareCanvas(rcv || rc, 'বিক্রয় রশিদ', receiptTextOf(s));
    $('#rc-save').onclick = () => downloadCanvas(rcv || rc, 'rashid-' + todayStr() + '.png');
    $('#rc-print').onclick = () => printCanvas(rcv || rc, 'rashid-' + todayStr());
  }

  return { boot };
})();

window.addEventListener('DOMContentLoaded', App.boot);

