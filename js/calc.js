/* ===== আমার হিসাব — বিল্ট-ইন ক্যালকুলেটর কিবোর্ড ===== */
/* .calc-field ক্লাসের যেকোনো ইনপুটে ফোকাস করলে এই ক্যালকুলেটর কিবোর্ড খোলে */

const Calc = (() => {
  let activeInput = null;
  let expr = '';

  const ROWS = [
    ['C','⌫','÷','×'],
    ['৭','৮','৯','−'],
    ['৪','৫','৬','+'],
    ['১','২','৩','='],
    ['০','.',' ',' '] // নিচে ✓ প্রয়োগ রাখা হবে
  ];

  const MAP = { '÷':'/', '×':'*', '−':'-', '৭':'7', '৮':'8', '৯':'9', '৪':'4', '৫':'5', '৬':'6', '১':'1', '২':'2', '৩':'3', '০':'0' };

  function build() {
    if ($('#calc-sheet')) return;
    const sheet = document.createElement('div');
    sheet.id = 'calc-sheet';
    sheet.innerHTML = `
      <div class="calc-head">
        <span class="calc-title">ক্যালকুলেটর</span>
        <span id="calc-expr">0</span>
      </div>
      <div class="calc-grid">
        <button type="button" data-k="C">C</button>
        <button type="button" data-k="B">⌫</button>
        <button type="button" data-k="/">÷</button>
        <button type="button" data-k="*">×</button>
        <button type="button" data-k="7">7</button>
        <button type="button" data-k="8">8</button>
        <button type="button" data-k="9">9</button>
        <button type="button" data-k="-">−</button>
        <button type="button" data-k="4">4</button>
        <button type="button" data-k="5">5</button>
        <button type="button" data-k="6">6</button>
        <button type="button" data-k="+">+</button>
        <button type="button" data-k="1">1</button>
        <button type="button" data-k="2">2</button>
        <button type="button" data-k="3">3</button>
        <button type="button" class="calc-eq" data-k="=">=</button>
        <button type="button" data-k="0">0</button>
        <button type="button" data-k=".">.</button>
        <button type="button" class="calc-ok" data-k="OK">প্রয়োগ</button>
      </div>`;
    document.body.appendChild(sheet);

    sheet.addEventListener('click', e => {
      const btn = e.target.closest('button[data-k]');
      if (!btn) return;
      press(btn.dataset.k);
    });
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
    $('#calc-expr').textContent = toBn(expr || '0');
    if (activeInput) activeInput.value = expr;
  }

  function press(k) {
    if (k === 'C') expr = '';
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
    } else if (['+','-','*','/'].includes(k)) {
      if (expr || expr === '0') expr += k;
    } else if (k === '.') {
      const last = expr.split(/[+\-*/]/).pop();
      if (!last.includes('.')) expr += expr && last ? '.' : '0.';
    } else {
      expr += k;
    }
    render();
  }

  function open(input) {
    build();
    activeInput = input;
    expr = input.value || '';
    render();
    $('#calc-sheet').classList.add('open');
    document.activeElement && document.activeElement.blur();
  }

  function close() {
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
