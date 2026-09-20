// طبقة الاتصال بالبيانات.
// - إذا API_URL موجود: تتصل بـ Google Apps Script (الشيتات).
// - إذا فارغ: "وضع تجريبي" يخزن في المتصفح (localStorage) مع بيانات مثال.
window.Api = (function () {
  const cfg = window.APP_CONFIG || {};
  const { KIND, SCOPE, CKIND, LIST_CATEGORY } = window.SCHEMA;
  const SHEETS = ['contractor', 'staff', 'car', 'misc', 'sites', 'lists'];
  const PASS_KEY = 'pt-password';
  const DEMO_KEY = 'pt-demo-v2';
  const isDemo = !cfg.API_URL;

  const uid = () => Math.random().toString(36).slice(2, 10);
  const nowISO = () => new Date().toISOString().slice(0, 19);

  /* ---------- كلمة السر ---------- */
  const getPassword = () => { try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } };
  const setPassword = p => { try { localStorage.setItem(PASS_KEY, p); } catch (e) { /* ignore */ } };

  /* ---------- الوضع البعيد (Apps Script) ---------- */
  async function call(action, payload) {
    // text/plain لتجنب طلب preflight (Apps Script لا يدعم OPTIONS)
    const res = await fetch(cfg.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, password: getPassword() }, payload || {}))
    });
    let json;
    try { json = await res.json(); } catch (e) { throw new Error('تعذّر قراءة رد الخادم. تأكد من رابط API_URL ومن نشر Apps Script للجميع (Anyone).'); }
    if (!json.ok) {
      const err = new Error(json.error === 'UNAUTHORIZED' ? 'كلمة السر غير صحيحة' : json.error);
      err.unauthorized = json.error === 'UNAUTHORIZED';
      throw err;
    }
    return json;
  }

  /* ---------- الوضع التجريبي ---------- */
  function iso(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function seed() {
    const ym = iso(0).slice(0, 7);
    let n = 0;
    const id = () => 'd' + (++n);
    return {
      sites: [{ id: '101', notes: '' }, { id: '152', notes: '' }, { id: '2103', notes: '' }],
      lists: [LIST_CATEGORY_ROW('محروقات'), LIST_CATEGORY_ROW('أدوات'), LIST_CATEGORY_ROW('نقل'), LIST_CATEGORY_ROW('ضيافة')],
      contractor: [
        { id: id(), date: iso(-9), kind: CKIND.ACCOUNT, site: '101', amount: 1800, label: '', notes: 'شامل الإضافة على الدرج', created: nowISO() },
        { id: id(), date: iso(-4), kind: CKIND.ACCOUNT, site: '152', amount: 950, label: '', notes: '', created: nowISO() },
        { id: id(), date: iso(-3), kind: CKIND.DEDUCT, site: '', amount: 120, label: 'ضمان اجتماعي', notes: 'لموظفي المقاول', created: nowISO() }
      ],
      staff: [
        { id: id(), person: 'أحمد', role: 'فني', kind: KIND.PRESENT, date: iso(-6), sites: '101', amount: '', notes: '', created: nowISO() },
        { id: id(), person: 'أحمد', role: 'فني', kind: KIND.PRESENT, date: iso(-5), sites: '101', amount: '', notes: '', created: nowISO() },
        { id: id(), person: 'أحمد', role: 'فني', kind: KIND.PRESENT, date: iso(-3), sites: '152', amount: '', notes: '', created: nowISO() },
        { id: id(), person: 'أحمد', role: 'فني', kind: KIND.SITE, date: iso(-2), sites: '101', amount: 70, notes: 'حساب الموقع 101 كامل', created: nowISO() },
        { id: id(), person: 'م. سامر', role: 'مهندس', kind: KIND.DAY, date: iso(-4), sites: '101,152', amount: 40, notes: 'زيارة موقعين', created: nowISO() }
      ],
      car: [
        { id: id(), date: iso(-7), amount: 25, scopeType: SCOPE.SITES, sites: '101', month: '', person: 'أحمد', notes: 'تحميل مواد', created: nowISO() },
        { id: id(), date: iso(-1), amount: 60, scopeType: SCOPE.GENERAL, sites: '', month: '', person: '', notes: 'صيانة', created: nowISO() }
      ],
      misc: [
        { id: id(), date: iso(-5), category: 'أدوات', amount: 45, scopeType: SCOPE.SITES, sites: '101,2103', month: '', notes: '', created: nowISO() },
        { id: id(), date: iso(-2), category: 'ضيافة', amount: 30, scopeType: SCOPE.MONTH, sites: '', month: ym, notes: '', created: nowISO() }
      ]
    };
    function LIST_CATEGORY_ROW(v) { return { id: id(), list: LIST_CATEGORY, value: v }; }
  }
  function demoLoad() {
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    const s = seed();
    demoSave(s);
    return s;
  }
  function demoSave(s) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }

  /* ---------- الواجهة العامة ---------- */
  return {
    isDemo,
    getPassword, setPassword,
    async load() {
      if (isDemo) return demoLoad();
      const out = await call('bootstrap');
      SHEETS.forEach(k => { out.data[k] = out.data[k] || []; });
      return out.data;
    },
    async add(sheet, rec) {
      if (isDemo) {
        const s = demoLoad();
        const r = Object.assign({}, rec, { id: rec.id || uid(), created: nowISO() });
        if (s[sheet].some(x => x.id === r.id)) throw new Error('موجود مسبقاً: ' + r.id);
        s[sheet].push(r); demoSave(s);
        return r;
      }
      return (await call('add', { sheet, record: rec })).record;
    },
    async update(sheet, rec) {
      if (isDemo) {
        const s = demoLoad();
        const i = s[sheet].findIndex(x => x.id === rec.id);
        if (i < 0) throw new Error('السجل غير موجود');
        s[sheet][i] = Object.assign({}, s[sheet][i], rec); demoSave(s);
        return s[sheet][i];
      }
      return (await call('update', { sheet, record: rec })).record;
    },
    async remove(sheet, id) {
      if (isDemo) {
        const s = demoLoad();
        s[sheet] = s[sheet].filter(x => x.id !== id); demoSave(s);
        return id;
      }
      await call('delete', { sheet, id });
      return id;
    },
    resetDemo() { try { localStorage.removeItem(DEMO_KEY); } catch (e) { /* ignore */ } }
  };
})();
