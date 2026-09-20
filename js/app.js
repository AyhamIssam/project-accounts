// الواجهة. لا توجد مكتبات خارجية ولا خطوات بناء: ملفات عادية تعمل مباشرة على GitHub Pages.
// الأقسام معرّفة في SECTIONS (الحقول + أعمدة الجدول). لإضافة حقل أو قسم عدّل هناك وفي Code.gs.
(function () {
  'use strict';
  const { KIND, ROLE, SCOPE, CKIND, LIST_CATEGORY } = window.SCHEMA;
  const CFG = window.APP_CONFIG || {};
  const CUR = CFG.CURRENCY || 'د.أ';

  const state = { contractor: [], staff: [], car: [], misc: [], sites: [], lists: [] };
  const ui = { tab: 'summary', filters: {}, dialogLocked: false };

  /* ---------- أدوات صغيرة ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const ids = Calc.ids;

  function h(tag, attrs) {
    const el = document.createElement(tag);
    let pending;
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'value') { if (tag === 'select') pending = v; else el.value = v; }
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(kid => {
        if (kid === null || kid === undefined || kid === false) return;
        el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      });
    }
    if (pending !== undefined) el.value = pending;
    return el;
  }

  const pad = n => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const thisMonth = () => todayISO().slice(0, 7);
  const fmt = n => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(Number(n) || 0);
  const money = n => h('span', { class: 'num' }, fmt(n));
  const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
  const monthLabel = ym => { const [y, m] = String(ym || '').split('-'); return MONTHS[Number(m) - 1] ? MONTHS[Number(m) - 1] + ' ' + y : ym || ''; };
  const dateEl = d => h('span', { class: 'num' }, d || '—');
  const siteExists = id => state.sites.some(s => s.id === id);
  const chip = id => h('span', { class: 'chip' + (siteExists(id) ? '' : ' gone') }, id || '—');
  const chipsFor = str => { const a = ids(str); return a.length ? a.map(chip) : '—'; };
  const sortSites = a => a.slice().sort((x, y) => String(x).localeCompare(String(y), 'en', { numeric: true }));
  const people = () => Array.from(new Set(state.staff.map(r => r.person).filter(Boolean)));
  const deductLabels = () => Array.from(new Set(['ضمان اجتماعي', 'سلفة', 'غرامة'].concat(state.contractor.map(r => r.label).filter(Boolean))));
  // رقم الموقع: 3 أو 4 أرقام فقط (نقبل الأرقام العربية ونحوّلها)
  const normSite = v => String(v || '').trim().replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const validSite = v => /^\d{3,4}$/.test(v);
  const SITE_ERR = 'رقم الموقع لازم يكون 3 أو 4 أرقام (مثل 101 أو 2103)';
  const categories = () => state.lists.filter(l => l.list === LIST_CATEGORY).map(l => l.value);

  let toastTimer;
  function toast(msg, bad) {
    const box = $('#toast');
    box.replaceChildren(h('div', { class: bad ? 'bad' : '' }, msg));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.replaceChildren(), bad ? 5000 : 2200);
  }

  /* ---------- الأقسام ---------- */
  const scopeField = {
    key: 'scopeType', label: 'الدفعة لـ', type: 'seg', def: SCOPE.GENERAL,
    options: [{ v: SCOPE.GENERAL, t: 'عام' }, { v: SCOPE.SITES, t: 'موقع أو أكثر' }, { v: SCOPE.MONTH, t: 'شهر كامل' }],
    hint: v => v.scopeType === SCOPE.SITES ? 'إذا اخترت أكثر من موقع يُقسم المبلغ بينهم بالتساوي.' : ''
  };
  const scopeExtra = [
    { key: 'sites', label: 'المواقع', type: 'sites', showIf: v => v.scopeType === SCOPE.SITES, required: true },
    { key: 'month', label: 'الشهر', type: 'month', showIf: v => v.scopeType === SCOPE.MONTH, required: true, def: thisMonth }
  ];
  const scopeCell = r => r.scopeType === SCOPE.SITES ? chipsFor(r.sites)
    : r.scopeType === SCOPE.MONTH ? h('span', { class: 'chip gray' }, monthLabel(r.month)) : h('span', { class: 'chip gray' }, 'عام');

  const SECTIONS = {
    contractor: {
      label: 'المقاول', addLabel: 'تسجيل حساب أو خصم',
      fields: [
        {
          key: 'kind', label: 'نوع التسجيل', type: 'seg', def: CKIND.ACCOUNT,
          options: [{ v: CKIND.ACCOUNT, t: 'حساب موقع' }, { v: CKIND.DEDUCT, t: 'خصم' }],
          hint: v => v.kind === CKIND.DEDUCT ? 'الخصم يُطرح من مستحقات المقاول (مثل الضمان الاجتماعي لموظفيه). اختر موقعاً أو اتركه عاماً.' : ''
        },
        { key: 'date', label: 'التاريخ', type: 'date', required: true, def: todayISO },
        { key: 'site', label: 'الموقع', type: 'site', required: v => v.kind !== CKIND.DEDUCT, placeholder: v => v.kind === CKIND.DEDUCT ? 'عام (بدون موقع)' : 'اختر الموقع' },
        { key: 'label', label: 'بند الخصم', type: 'text', required: true, list: deductLabels, showIf: v => v.kind === CKIND.DEDUCT },
        { key: 'amount', label: v => v.kind === CKIND.DEDUCT ? 'مبلغ الخصم (' + CUR + ')' : 'الحساب (' + CUR + ')', type: 'money', required: true },
        { key: 'notes', label: v => v.kind === CKIND.DEDUCT ? 'ملاحظات' : 'إضافة أو تبرير للحساب', type: 'textarea' }
      ],
      cols: [
        { label: 'التاريخ', r: r => dateEl(r.date) },
        { label: 'النوع', r: r => h('span', { class: 'chip ' + (r.kind === CKIND.DEDUCT ? 'warn' : 'gray') }, r.kind === CKIND.DEDUCT ? 'خصم' : 'حساب') },
        { label: 'الموقع', r: r => r.site ? chip(r.site) : h('span', { class: 'chip gray' }, 'عام') },
        { label: 'المبلغ', n: true, r: r => r.kind === CKIND.DEDUCT ? h('span', { class: 'num neg' }, '-' + fmt(r.amount)) : money(r.amount) },
        { label: 'البند / التبرير', r: r => [r.kind === CKIND.DEDUCT ? r.label : '', r.kind === CKIND.DEDUCT && r.notes ? ' — ' : '', r.notes || ''] }
      ]
    },
    staff: {
      label: 'المهندس والفنيين', addLabel: 'تسجيل جديد',
      fields: [
        { key: 'person', label: 'الاسم', type: 'text', required: true, list: people },
        { key: 'role', label: 'الصفة', type: 'seg', options: ROLE, def: ROLE[1] },
        {
          key: 'kind', label: 'نوع التسجيل', type: 'seg', def: KIND.DAY,
          options: [{ v: KIND.DAY, t: 'حساب على اليوم' }, { v: KIND.SITE, t: 'حساب على الموقع' }, { v: KIND.PRESENT, t: 'تسجيل حضور فقط' }],
          hint: v => v.kind === KIND.SITE
            ? 'المبلغ يتوزع بالتساوي على أيام الحضور المسجّلة لنفس الشخص في هذه المواقع. سجّل أيام الحضور من "تسجيل حضور فقط".'
            : v.kind === KIND.PRESENT ? 'حضور بدون مبلغ. يُستخدم لتوزيع "الحساب على الموقع" على الأيام.'
            : 'إذا اشتغل بأكثر من موقع في اليوم يُقسم المبلغ بين المواقع بالتساوي.'
        },
        { key: 'date', label: v => v.kind === KIND.SITE ? 'تاريخ التسجيل' : 'اليوم', type: 'date', required: true, def: todayISO },
        { key: 'sites', label: v => v.kind === KIND.SITE ? 'رقم الموقع أو المواقع' : 'الموقع أو المواقع', type: 'sites', required: true },
        { key: 'amount', label: 'المبلغ (' + CUR + ')', type: 'money', required: true, showIf: v => v.kind !== KIND.PRESENT },
        { key: 'notes', label: 'ملاحظات', type: 'textarea' }
      ],
      cols: [
        { label: 'التاريخ', r: r => dateEl(r.date) },
        { label: 'الاسم', r: r => h('span', null, r.person, ' ', h('span', { class: 'chip gray' }, r.role)) },
        { label: 'النوع', r: (r, x) => [r.kind, x.warn.has(r.id) ? h('span', { class: 'chip warn', title: 'لا توجد أيام حضور مسجّلة لهذا الشخص في هذا الموقع' }, 'بدون أيام حضور') : null] },
        { label: 'المواقع', r: r => chipsFor(r.sites) },
        { label: 'المبلغ', n: true, r: r => r.kind === KIND.PRESENT ? '—' : money(r.amount) },
        { label: 'ملاحظات', r: r => r.notes || '' }
      ]
    },
    car: {
      label: 'السيارة', addLabel: 'تسجيل دفعة',
      fields: [
        { key: 'date', label: 'تاريخ الدفعة', type: 'date', required: true, def: todayISO },
        { key: 'amount', label: 'المبلغ (' + CUR + ')', type: 'money', required: true },
        scopeField, scopeExtra[0], scopeExtra[1],
        { key: 'person', label: 'ربط الدفعة بشخص من الفريق (اختياري)', type: 'select', options: people, placeholder: 'بدون' },
        { key: 'notes', label: 'ملاحظات', type: 'textarea' }
      ],
      cols: [
        { label: 'التاريخ', r: r => dateEl(r.date) },
        { label: 'المبلغ', n: true, r: r => money(r.amount) },
        { label: 'لـ', r: scopeCell },
        { label: 'الشخص', r: r => r.person || '—' },
        { label: 'ملاحظات', r: r => r.notes || '' }
      ]
    },
    misc: {
      label: 'دفعات عشوائية', addLabel: 'تسجيل دفعة',
      fields: [
        { key: 'date', label: 'تاريخ الدفعة', type: 'date', required: true, def: todayISO },
        { key: 'category', label: 'البند', type: 'category', required: true },
        { key: 'amount', label: 'المبلغ (' + CUR + ')', type: 'money', required: true },
        scopeField, scopeExtra[0], scopeExtra[1],
        { key: 'notes', label: 'ملاحظات', type: 'textarea' }
      ],
      cols: [
        { label: 'التاريخ', r: r => dateEl(r.date) },
        { label: 'البند', r: r => r.category || '—' },
        { label: 'المبلغ', n: true, r: r => money(r.amount) },
        { label: 'لـ', r: scopeCell },
        { label: 'ملاحظات', r: r => r.notes || '' }
      ]
    }
  };
  const TABS = [{ id: 'summary', label: 'الملخص' }].concat(Object.keys(SECTIONS).map(k => ({ id: k, label: SECTIONS[k].label })));

  /* ---------- الفلاتر ---------- */
  const filtersFor = t => (ui.filters[t] = ui.filters[t] || { month: '', site: '', person: '' });
  const entryDate = (sec, r) => (sec !== 'contractor' && sec !== 'staff' && r.scopeType === SCOPE.MONTH && r.month) ? r.month + '-01' : (r.date || '');
  const entrySites = (sec, r) => sec === 'contractor' ? [r.site] : (sec === 'staff' || r.scopeType === SCOPE.SITES) ? ids(r.sites) : [];
  function matches(sec, r, f) {
    if (f.month && entryDate(sec, r).slice(0, 7) !== f.month) return false;
    if (f.site && entrySites(sec, r).indexOf(f.site) === -1) return false;
    if (f.person && r.person !== f.person) return false;
    return true;
  }

  /* ---------- الرسم العام ---------- */
  function renderTabs() {
    $('#tabs').replaceChildren(...TABS.map(t => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(ui.tab === t.id),
      onclick: () => { ui.tab = t.id; render(); window.scrollTo(0, 0); }
    }, t.label)));
  }
  function render() {
    renderTabs();
    $('#view').replaceChildren(ui.tab === 'summary' ? renderSummary() : renderSection(ui.tab));
  }

  function monthFilter(f) {
    return h('label', null, 'الشهر',
      h('span', { class: 'addrow' },
        h('input', { type: 'month', id: 'flt-month', value: f.month, onchange: e => { f.month = e.target.value; render(); } }),
        f.month ? h('button', { class: 'btn small', type: 'button', onclick: () => { f.month = ''; render(); } }, 'الكل') : null));
  }
  function siteFilter(f) {
    return h('label', null, 'الموقع',
      h('select', { id: 'flt-site', value: f.site, onchange: e => { f.site = e.target.value; render(); } },
        h('option', { value: '' }, 'كل المواقع'),
        sortSites(state.sites.map(s => s.id)).map(s => h('option', { value: s }, s))));
  }

  /* ---------- الملخص ---------- */
  function renderSummary() {
    const f = filtersFor('summary');
    const { lines, warn } = Calc.allocate(state);
    const L = lines.filter(l => !f.month || l.date.slice(0, 7) === f.month);
    const SRC = [['contractor', 'المقاول'], ['staff', 'المهندس والفنيين'], ['car', 'السيارة'], ['misc', 'دفعات عشوائية']];
    const by = {};
    const cell = k => (by[k] = by[k] || { contractor: 0, staff: 0, car: 0, misc: 0, total: 0 });
    L.forEach(l => { const c = cell(l.site || ''); c[l.src] += l.amount; c.total += l.amount; });
    const siteIds = sortSites(Array.from(new Set(state.sites.map(s => s.id).concat(Object.keys(by).filter(Boolean)))));
    const tot = { contractor: 0, staff: 0, car: 0, misc: 0, total: 0 };
    Object.values(by).forEach(c => Object.keys(tot).forEach(k => { tot[k] += c[k]; }));

    const root = h('div');
    if (Api.isDemo) root.append(h('div', { class: 'banner' }, 'الوضع التجريبي: البيانات المعروضة أمثلة محفوظة في هذا المتصفح فقط. لربط الموقع بالشيت ضع رابط Apps Script في js/config.js (الخطوات في README).'));
    if (warn.size) root.append(h('div', { class: 'banner info' }, warn.size + ' سجل "حساب على الموقع" ما إله أيام حضور مسجّلة، لذلك وُزّع مؤقتاً على الموقع مباشرة. ',
      h('button', { class: 'btn link', type: 'button', onclick: () => { ui.tab = 'staff'; render(); } }, 'افتح قسم الفنيين')));

    root.append(h('div', { class: 'toolbar' }, monthFilter(f)));
    root.append(h('div', { class: 'kpis' },
      h('div', { class: 'kpi main' }, h('span', null, 'إجمالي المصروف'), h('b', null, fmt(tot.total)), h('span', null, CUR)),
      SRC.map(([k, t]) => h('div', { class: 'kpi' }, h('span', null, t), h('b', null, fmt(tot[k]))))));

    const rows = siteIds.map(id => [id, cell(id)]);
    const g = by[''];
    root.append(h('h2', null, 'حساب كل موقع'));
    root.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl sum cards' },
      h('thead', null, h('tr', null, h('th', null, 'الموقع'), SRC.map(([, t]) => h('th', { class: 'n' }, t)), h('th', { class: 'n' }, 'الإجمالي'))),
      h('tbody', null,
        rows.map(([id, c]) => h('tr', null,
          h('td', { 'data-label': 'الموقع' }, chip(id)),
          SRC.map(([k, t]) => h('td', { class: 'n', 'data-label': t }, c[k] ? money(c[k]) : '—')),
          h('td', { class: 'n total', 'data-label': 'الإجمالي' }, money(c.total)))),
        g ? h('tr', null,
          h('td', { 'data-label': 'الموقع' }, h('span', { class: 'chip gray' }, 'عام / شهري')),
          SRC.map(([k, t]) => h('td', { class: 'n', 'data-label': t }, g[k] ? money(g[k]) : '—')),
          h('td', { class: 'n total', 'data-label': 'الإجمالي' }, money(g.total))) : null),
      h('tfoot', null, h('tr', null,
        h('td', { 'data-label': '' }, 'المجموع'),
        SRC.map(([k, t]) => h('td', { class: 'n', 'data-label': t }, money(tot[k]))),
        h('td', { class: 'n', 'data-label': 'الإجمالي' }, money(tot.total)))))));
    if (!rows.length && !g) root.append(h('div', { class: 'empty' }, 'لا توجد بيانات بعد.'));
    root.append(h('p', { class: 'note' }, '"عام / شهري" هي البنود غير المرتبطة بموقع معيّن (عام أو لشهر كامل). المقاول محسوب بعد الخصومات.'));
    return root;
  }

  /* ---------- قسم عادي (جدول + إضافة) ---------- */
  function renderSection(sec) {
    const S = SECTIONS[sec];
    const f = filtersFor(sec);
    const { warn } = Calc.allocate(state);
    const rows = state[sec].filter(r => matches(sec, r, f))
      .sort((a, b) => entryDate(sec, b).localeCompare(entryDate(sec, a)) || String(b.created).localeCompare(String(a.created)));
    const root = h('div');

    root.append(h('div', { class: 'toolbar' },
      monthFilter(f), siteFilter(f),
      (sec === 'staff' || sec === 'car') ? h('label', null, 'الشخص',
        h('select', { id: 'flt-person', value: f.person, onchange: e => { f.person = e.target.value; render(); } },
          h('option', { value: '' }, 'الكل'), people().map(p => h('option', { value: p }, p)))) : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => openForm(sec, null) }, '+ ' + S.addLabel)));

    if (sec === 'contractor' && rows.length) {
      const gross = rows.filter(r => r.kind !== CKIND.DEDUCT).reduce((a, r) => a + (Number(r.amount) || 0), 0);
      const ded = rows.filter(r => r.kind === CKIND.DEDUCT).reduce((a, r) => a + (Number(r.amount) || 0), 0);
      root.append(h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('span', null, 'إجمالي الحسابات'), h('b', null, fmt(gross))),
        h('div', { class: 'kpi' }, h('span', null, 'الخصومات'), h('b', { class: 'neg' }, '-' + fmt(ded))),
        h('div', { class: 'kpi main' }, h('span', null, 'الصافي المستحق للمقاول'), h('b', null, fmt(gross - ded)), h('span', null, CUR))));
    }

    if (sec === 'staff' && rows.length) {
      const per = {};
      rows.forEach(r => {
        const p = (per[r.person] = per[r.person] || { role: r.role, total: 0, days: new Set() });
        if (r.kind !== KIND.SITE) p.days.add(r.date);
        if (r.kind !== KIND.PRESENT) p.total += Number(r.amount) || 0;
      });
      root.append(h('h2', null, 'ملخص الأشخاص'));
      root.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl cards' },
        h('thead', null, h('tr', null, h('th', null, 'الاسم'), h('th', null, 'الصفة'), h('th', { class: 'n' }, 'أيام مسجّلة'), h('th', { class: 'n' }, 'المجموع'), h('th', { class: 'n' }, 'دفعات السيارة'))),
        h('tbody', null, Object.keys(per).map(n => h('tr', null,
          h('td', { 'data-label': 'الاسم' }, n),
          h('td', { 'data-label': 'الصفة' }, per[n].role),
          h('td', { class: 'n', 'data-label': 'أيام مسجّلة' }, h('span', { class: 'num' }, per[n].days.size)),
          h('td', { class: 'n', 'data-label': 'المجموع' }, money(per[n].total)),
          h('td', { class: 'n', 'data-label': 'دفعات السيارة' }, money(state.car.filter(c => c.person === n && (!f.month || entryDate('car', c).slice(0, 7) === f.month)).reduce((a, c) => a + (Number(c.amount) || 0), 0)))))))));
      root.append(h('h2', null, 'السجلات'));
    }

    if (!rows.length) {
      root.append(h('div', { class: 'tbl-wrap' }, h('div', { class: 'empty' }, 'لا توجد سجلات ضمن هذا الفلتر.')));
      return root;
    }
    const total = rows.reduce((s, r) => s + (r.kind === KIND.PRESENT ? 0 : (r.kind === CKIND.DEDUCT ? -1 : 1) * (Number(r.amount) || 0)), 0);
    root.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl cards' },
      h('thead', null, h('tr', null, S.cols.map(c => h('th', { class: c.n ? 'n' : '' }, c.label)), h('th', null, ''))),
      h('tbody', null, rows.map(r => h('tr', null,
        S.cols.map(c => h('td', { class: c.n ? 'n' : '', 'data-label': c.label }, c.r(r, { warn }))),
        h('td', { class: 'act' },
          h('button', { class: 'btn small', type: 'button', onclick: () => openForm(sec, r) }, 'تعديل'), ' ',
          h('button', { class: 'btn small danger', type: 'button', onclick: () => removeRecord(sec, r) }, 'حذف'))))),
      h('tfoot', null, h('tr', null, h('td', { colspan: S.cols.length + 1 },
        h('span', { class: 'addrow', style: 'justify-content:space-between' },
          h('span', null, (sec === 'contractor' ? 'الصافي (' : 'الإجمالي (') + rows.length + ' سجل)'), h('b', { class: 'num' }, fmt(total) + ' ' + CUR))))))));
    return root;
  }

  /* ---------- الحوارات ---------- */
  function openDialog(nodes, locked) {
    ui.dialogLocked = !!locked;
    $('#dlg-in').replaceChildren(...[].concat(nodes).flat(Infinity).filter(Boolean));
    const d = $('#dlg');
    if (!d.open) d.showModal();
  }
  function closeDialog() { ui.dialogLocked = false; const d = $('#dlg'); if (d.open) d.close(); }

  function fieldNode(f, vals, rerender) {
    const id = 'f-' + f.key;
    const label = typeof f.label === 'function' ? f.label(vals) : f.label;
    const hint = f.hint ? f.hint(vals) : '';
    let ctl;
    switch (f.type) {
      case 'text':
        ctl = [h('input', { id, type: 'text', value: vals[f.key] || '', autocomplete: 'off', list: f.list ? id + '-l' : null, oninput: e => { vals[f.key] = e.target.value; } }),
          f.list ? h('datalist', { id: id + '-l' }, f.list().map(v => h('option', { value: v }))) : null];
        break;
      case 'number': case 'money':
        ctl = h('input', { id, type: 'number', step: 'any', min: '0', inputmode: 'decimal', value: vals[f.key] === undefined ? '' : vals[f.key], oninput: e => { vals[f.key] = e.target.value; } });
        break;
      case 'date': case 'month':
        ctl = h('input', { id, type: f.type, value: vals[f.key] || '', oninput: e => { vals[f.key] = e.target.value; } });
        break;
      case 'textarea':
        ctl = h('textarea', { id, oninput: e => { vals[f.key] = e.target.value; } }, vals[f.key] || '');
        break;
      case 'site':
        ctl = h('select', { id, value: vals[f.key] || '', onchange: e => { vals[f.key] = e.target.value; } },
          h('option', { value: '' }, f.placeholder ? f.placeholder(vals) : 'اختر الموقع'),
          sortSites(state.sites.map(s => s.id).concat(vals[f.key] && !siteExists(vals[f.key]) ? [vals[f.key]] : [])).map(s => h('option', { value: s }, s)));
        break;
      case 'select': {
        const opts = f.options().concat(vals[f.key] && f.options().indexOf(vals[f.key]) === -1 ? [vals[f.key]] : []);
        ctl = h('select', { id, value: vals[f.key] || '', onchange: e => { vals[f.key] = e.target.value; } },
          h('option', { value: '' }, f.placeholder || 'اختر'), opts.map(o => h('option', { value: o }, o)));
        break;
      }
      case 'category': {
        const cats = categories().concat(vals[f.key] && categories().indexOf(vals[f.key]) === -1 ? [vals[f.key]] : []);
        ctl = h('div', { class: 'addrow' },
          h('select', { id, value: vals[f.key] || '', onchange: e => { vals[f.key] = e.target.value; } },
            h('option', { value: '' }, 'اختر البند'), cats.map(c => h('option', { value: c }, c))),
          h('button', { class: 'btn', type: 'button', onclick: async () => {
            const name = (prompt('اسم البند الجديد؟') || '').trim();
            if (!name) return;
            if (categories().indexOf(name) === -1) {
              try { state.lists.push(await Api.add('lists', { list: LIST_CATEGORY, value: name })); } catch (e) { return toast(e.message, true); }
            }
            vals[f.key] = name; rerender();
          } }, '+ بند'));
        break;
      }
      case 'seg': {
        const opts = f.options.map(o => typeof o === 'string' ? { v: o, t: o } : o);
        ctl = h('div', { class: 'seg', role: 'group', 'aria-label': label },
          opts.map(o => h('button', { type: 'button', 'aria-pressed': String(vals[f.key] === o.v), onclick: () => { vals[f.key] = o.v; rerender(); } }, o.t)));
        break;
      }
      case 'sites': {
        const sel = ids(vals[f.key]);
        const set = a => { vals[f.key] = a.join(','); rerender(); };
        const all = sortSites(state.sites.map(s => s.id).concat(sel.filter(s => !siteExists(s))));
        ctl = h('div', { class: 'chips' },
          all.map(s => h('button', { type: 'button', 'aria-pressed': String(sel.indexOf(s) !== -1),
            onclick: () => set(sel.indexOf(s) !== -1 ? sel.filter(x => x !== s) : sel.concat(s)) }, s)),
          h('button', { type: 'button', class: 'add', onclick: async () => {
            const name = normSite(prompt('رقم الموقع الجديد (3 أو 4 أرقام)؟'));
            if (!name) return;
            if (!validSite(name)) return toast(SITE_ERR, true);
            if (!siteExists(name)) {
              try { state.sites.push(await Api.add('sites', { id: name, notes: '' })); } catch (e) { return toast(e.message, true); }
            }
            set(sel.indexOf(name) === -1 ? sel.concat(name) : sel);
          } }, '+ موقع جديد'));
        break;
      }
      default: ctl = null;
    }
    return h('div', { class: 'field' }, h('label', { for: id }, label), ctl, hint ? h('div', { class: 'hint' }, hint) : null);
  }

  function openForm(sec, rec) {
    const S = SECTIONS[sec];
    const vals = {};
    S.fields.forEach(f => { vals[f.key] = f.def !== undefined ? (typeof f.def === 'function' ? f.def() : f.def) : ''; });
    if (rec) Object.assign(vals, rec);
    const visible = f => !f.showIf || f.showIf(vals);
    let error = '', busy = false;

    async function save() {
      const out = {};
      for (const f of S.fields) {
        const label = typeof f.label === 'function' ? f.label(vals) : f.label;
        if (!visible(f)) { out[f.key] = ''; continue; }
        let v = vals[f.key];
        const req = typeof f.required === 'function' ? f.required(vals) : f.required;
        if (f.type === 'number' || f.type === 'money') {
          if (v === '' || v === null || v === undefined) { if (req) { error = 'الحقل "' + label + '" مطلوب'; return draw(); } out[f.key] = ''; continue; }
          v = Number(v);
          if (!isFinite(v) || v < 0) { error = 'الحقل "' + label + '" يجب أن يكون رقماً صحيحاً'; return draw(); }
        } else if (req && !String(v || '').trim()) {
          error = f.type === 'sites' || f.type === 'site' ? 'اختر الموقع في "' + label + '"' : 'الحقل "' + label + '" مطلوب';
          return draw();
        }
        out[f.key] = typeof v === 'string' ? v.trim() : v;
      }
      if (rec) out.id = rec.id;
      busy = true; error = ''; draw();
      try {
        const saved = rec ? await Api.update(sec, out) : await Api.add(sec, out);
        const i = state[sec].findIndex(x => x.id === saved.id);
        if (i >= 0) state[sec][i] = saved; else state[sec].push(saved);
        closeDialog(); render(); toast('تم الحفظ');
      } catch (e) {
        busy = false; error = e.message; draw();
      }
    }
    function draw() {
      const keep = document.activeElement && document.activeElement.id;
      openDialog([
        h('h3', null, (rec ? 'تعديل: ' : '') + S.label),
        S.fields.filter(visible).map(f => fieldNode(f, vals, draw)),
        h('div', { class: 'err', role: 'alert' }, error),
        h('div', { class: 'dlg-foot' },
          h('button', { class: 'btn primary', type: 'button', disabled: busy, onclick: save }, busy ? 'جاري الحفظ...' : 'حفظ'),
          h('button', { class: 'btn', type: 'button', disabled: busy, onclick: closeDialog }, 'إلغاء'))
      ]);
      const again = keep && document.getElementById(keep);
      if (again && again.tagName !== 'BUTTON') again.focus();
    }
    draw();
  }

  async function removeRecord(sec, r) {
    if (!confirm('حذف هذا السجل نهائياً؟')) return;
    try {
      await Api.remove(sec, r.id);
      state[sec] = state[sec].filter(x => x.id !== r.id);
      render(); toast('تم الحذف');
    } catch (e) { toast(e.message, true); }
  }

  /* ---------- المواقع والقوائم ---------- */
  function openSettings() {
    function listBlock(title, items, addFn, delFn, placeholder, extra) {
      const input = h('input', Object.assign({ type: 'text', placeholder, 'aria-label': placeholder }, extra || {}));
      const add = async () => { const v = input.value.trim(); if (!v) return; await addFn(v); };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      return h('div', { class: 'field' }, h('label', null, title),
        h('div', { class: 'list-edit' },
          items.length ? items.map(it => h('div', { class: 'li' }, h('span', null, it.label),
            h('button', { class: 'btn small danger', type: 'button', onclick: () => delFn(it) }, 'حذف'))) : h('div', { class: 'note' }, 'لا يوجد شيء بعد'),
          h('div', { class: 'addrow' }, input, h('button', { class: 'btn', type: 'button', onclick: add }, 'إضافة'))));
    }
    function draw() {
      openDialog([
        h('h3', null, 'المواقع والقوائم'),
        listBlock('المواقع', sortSites(state.sites.map(s => s.id)).map(id => ({ id, label: id })),
          async v => {
            v = normSite(v);
            if (!validSite(v)) return toast(SITE_ERR, true);
            if (siteExists(v)) return toast('الموقع موجود مسبقاً', true);
            try { state.sites.push(await Api.add('sites', { id: v, notes: '' })); draw(); render(); } catch (e) { toast(e.message, true); }
          },
          async it => {
            if (!confirm('حذف الموقع "' + it.id + '" من القائمة؟ السجلات القديمة تبقى كما هي.')) return;
            try { await Api.remove('sites', it.id); state.sites = state.sites.filter(s => s.id !== it.id); draw(); render(); } catch (e) { toast(e.message, true); }
          }, 'رقم موقع جديد (3 أو 4 أرقام)', { inputmode: 'numeric', maxlength: '4' }),
        listBlock('بنود الدفعات العشوائية', state.lists.filter(l => l.list === LIST_CATEGORY).map(l => ({ id: l.id, label: l.value })),
          async v => {
            if (categories().indexOf(v) !== -1) return toast('البند موجود مسبقاً', true);
            try { state.lists.push(await Api.add('lists', { list: LIST_CATEGORY, value: v })); draw(); } catch (e) { toast(e.message, true); }
          },
          async it => {
            try { await Api.remove('lists', it.id); state.lists = state.lists.filter(l => l.id !== it.id); draw(); } catch (e) { toast(e.message, true); }
          }, 'بند جديد'),
        Api.isDemo ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!confirm('إعادة البيانات التجريبية إلى وضعها الأصلي؟')) return;
          Api.resetDemo(); await load(); closeDialog();
        } }, 'إعادة ضبط البيانات التجريبية') : null,
        h('div', { class: 'dlg-foot' }, h('button', { class: 'btn primary', type: 'button', onclick: closeDialog }, 'تم'))
      ]);
    }
    draw();
  }

  /* ---------- كلمة السر + التحميل ---------- */
  function askPassword(msg) {
    return new Promise(resolve => {
      const input = h('input', { id: 'pw', type: 'password', autocomplete: 'current-password' });
      const go = () => { if (!input.value) return; Api.setPassword(input.value); closeDialog(); resolve(); };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      openDialog([
        h('h3', null, 'كلمة السر'),
        h('div', { class: 'field' }, h('label', { for: 'pw' }, 'أدخل كلمة السر المضبوطة في Apps Script'), input),
        h('div', { class: 'err' }, msg || ''),
        h('div', { class: 'dlg-foot' }, h('button', { class: 'btn primary', type: 'button', onclick: go }, 'دخول'))
      ], true);
      input.focus();
    });
  }

  async function load() {
    $('#status').textContent = Api.isDemo ? 'وضع تجريبي' : 'متصل بالشيت';
    $('#status').className = 'pill' + (Api.isDemo ? ' demo' : '');
    if (!Api.isDemo && !Api.getPassword()) await askPassword();
    for (;;) {
      try {
        const data = await Api.load();
        Object.keys(state).forEach(k => { state[k] = data[k] || []; });
        break;
      } catch (e) {
        if (e.unauthorized) { Api.setPassword(''); await askPassword('كلمة السر غير صحيحة'); continue; }
        $('#view').replaceChildren(h('div', { class: 'banner' }, 'تعذّر تحميل البيانات: ' + e.message + ' '),
          h('button', { class: 'btn', type: 'button', onclick: load }, 'إعادة المحاولة'));
        return;
      }
    }
    render();
  }

  $('#dlg').addEventListener('cancel', e => { if (ui.dialogLocked) e.preventDefault(); });
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-refresh').addEventListener('click', async () => { await load(); toast('تم التحديث'); });
  document.title = CFG.TITLE || document.title;
  $('#title').textContent = CFG.TITLE || 'حسابات المواقع';
  load();
})();
