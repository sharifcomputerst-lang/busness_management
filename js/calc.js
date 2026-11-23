/* ===== আমার হিসাব — বিল্ট-ইন ক্যালকুলেটর (Windows স্ট্যান্ডার্ড লে-আউট) ===== */
/* .calc-field ক্লাসের যেকোনো ইনপুটে ফোকাস করলে এই কিবোর্ড খোলে; টাইপিংয়ের সময় ঘর হাইলাইট হয় */

const Calc = (() => {
  let activeInput = null;
  let expr = '';

  function lastOperand() {
    return expr.split(/[+\-*/]/).pop();
  }
  function replaceOperand(val) {
    const op = lastOperand();
    expr = expr.slice(0, expr.length - op.length) + val;
  }

  function evaluate(raw) {
    const s = String(raw).replace(/[^\d+\-*/.() ]/g, '');
    if (!s) return null;
    try {
      const r = Function('"use strict";return (' + s + ')')();
      if (typeof r !== 'number' || !isFinite(r)) return null;
      return Math.round(r * 100) / 100;
    } catch (e) { return null; }
  }

  function render() {
    const el = $('#calc-expr');
    if (el) el.textContent = toBn(expr || '0');
    if (activeInput) activeInput.value = expr;
  }

  function press(k) {
    const endsOp = /[+\-*/]$/.test(expr);
    if (k === 'C') expr = '';
    else if (k === 'CE') expr = expr.slice(0, expr.length - lastOperand().length);
    else if (k === 'B') expr = expr.slice(0, -1);
    else if (k === '=') {
      const r = evaluate(expr);
      expr = r === null ? expr : String(r);
    } else if (k === 'OK') {
      const r = evaluate(expr);
      if (activeInput) activeInput.value = r === null ? expr : String(r);
      if (activeInput) activeInput.dispatchEvent(new Event('input', { bubbles: true }));
      close();
      return;
    } else if (['+', '-', '*', '/'].includes(k)) {
      if (!expr) { if (k === '-') expr = '-'; }
      else if (endsOp) expr = expr.slice(0, -1) + k;
      else expr += k;
    } else if (k === '.') {
      const last = lastOperand();
      if (!last.includes('.')) expr += (endsOp || !last) ? '0.' : '.';
    } else if (k === 'pm') {
      const last = lastOperand();
      const head = expr.slice(0, expr.length - last.length);
      if (last) expr = last.startsWith('-') ? head + last.slice(1) : head + '-' + last;
      else if (endsOp) expr = expr.slice(0, -1) + (expr.slice(-1) === '-' ? '+' : '-');
    } else if (k === 'pct') {
      const m = expr.match(/^(.+[)\d])\s*([+\-])$/);
      if (m) {
        const base = evaluate(m[1]);
        const op = lastOperand();
        expr = base === null ? expr + '/100' : expr + '(' + base + '*' + op + '/100)';
      } else {
        const last = lastOperand();
        const v = last ? evaluate(last) : null;
        if (v !== null && v !== 0) replaceOperand(String(v / 100));
      }
    } else if (k === 'inv') {
      const v = evaluate(lastOperand());
      if (v !== null && v !== 0) replaceOperand(String(Math.round(1 / v * 100) / 100));
      else toast('শূন্য দিয়ে ভাগ করা যায় না', false);
    } else if (k === 'sqr') {
      const v = evaluate(lastOperand());
      if (v !== null) replaceOperand(String(Math.round(v * v * 100) / 100));
    } else if (k === 'sqrt') {
      const v = evaluate(lastOperand());
      if (v !== null && v >= 0) replaceOperand(String(Math.round(Math.sqrt(v) * 100) / 100));
      else toast('ঋণাত্মক সংখ্যার বর্গমূল নেই', false);
    } else {
      const last = lastOperand();
      if (last === '0') replaceOperand(k);
      else expr += k;
    }
    render();
  }

  function build() {
    if ($('#calc-sheet')) return;
    const sheet = document.createElement('div');
    sheet.id = 'calc-sheet';
    sheet.innerHTML = `
      <div class="calc-head">
        <span class="calc-title">ক্যালকুলেটর</span>
        <span id="calc-expr">০</span>
      </div>
      <div class="calc-grid">
        <button type="button" class="calc-fn" data-k="pct">%</button>
        <button type="button" class="calc-fn" data-k="ce">CE</button>
        <button type="button" class="calc-c" data-k="C">C</button>
        <button type="button" class="calc-fn" data-k="B">⌫</button>

        <button type="button" class="calc-fn" data-k="inv">¹⁄ₓ</button>
        <button type="button" class="calc-fn" data-k="sqr">x²</button>
        <button type="button" class="calc-fn" data-k="sqrt">√x</button>
        <button type="button" class="calc-op" data-k="/">÷</button>

        <button type="button" data-k="7">7</button>
        <button type="button" data-k="8">8</button>
        <button type="button" data-k="9">9</button>
        <button type="button" class="calc-op" data-k="*">×</button>

        <button type="button" data-k="4">4</button>
        <button type="button" data-k="5">5</button>
        <button type="button" data-k="6">6</button>
        <button type="button" class="calc-op" data-k="-">−</button>

        <button type="button" data-k="1">1</button>
        <button type="button" data-k="2">2</button>
        <button type="button" data-k="3">3</button>
        <button type="button" class="calc-op" data-k="+">+</button>

        <button type="button" class="calc-fn" data-k="pm">±</button>
        <button type="button" data-k="0">0</button>
        <button type="button" data-k=".">.</button>
        <button type="button" class="calc-eq" data-k="=">=</button>
      </div>
      <button type="button" class="calc-ok" id="calc-ok">প্রয়োগ করুন ✓</button>`;
    document.body.appendChild(sheet);

    sheet.addEventListener('click', e => {
      const btn = e.target.closest('button[data-k]');
      if (!btn) return;
      press(btn.dataset.k);
    });
    $('#calc-ok', sheet).addEventListener('click', () => press('OK'));
  }

  function open(input) {
    build();
    if (activeInput && activeInput !== input) activeInput.classList.remove('calc-focus');
    activeInput = input;
    expr = input.value || '';
    input.classList.add('calc-focus');
    render();
    $('#calc-sheet').classList.add('open');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function close() {
    if (activeInput) activeInput.classList.remove('calc-focus');
    activeInput = null;
    const s = $('#calc-sheet');
    if (s) s.classList.remove('open');
  }

  document.addEventListener('focusin', e => {
    if (e.target.matches && e.target.matches('input.calc-field')) open(e.target);
  });
  document.addEventListener('click', e => {
    if (e.target.matches && e.target.matches('input.calc-field')) open(e.target);
  });
  document.addEventListener('click', e => {
    const sheet = $('#calc-sheet');
    if (sheet && sheet.classList.contains('open') &&
        !sheet.contains(e.target) &&
        !(e.target.matches && e.target.matches('input.calc-field'))) close();
  });

  return { open, close };
})();
