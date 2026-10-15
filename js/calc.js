// منطق توزيع المبالغ على المواقع. دوال صافية بدون واجهة، سهلة الاختبار.
// المدخل: state = {company, contractor, staff, car, misc, sites, lists}
// المخرج: {lines, warn}
//   lines: أسطر موزّعة {src, id, site|null, date, amount, person?}
//   warn:  Set من معرّفات سجلات "حساب على الموقع" التي لا يوجد لها أيام حضور
(function () {
  const { KIND, SCOPE, CKIND, COMPANY_KIND } = window.SCHEMA;

  const round3 = n => Math.round(n * 1000) / 1000;

  // قسمة مبلغ على n بالتساوي بدقة 3 خانات، والباقي على آخر جزء ليبقى المجموع مطابقاً
  function split(amount, n) {
    if (n <= 0) return [];
    const base = Math.floor((amount * 1000) / n) / 1000;
    const parts = Array(n).fill(base);
    parts[n - 1] = round3(amount - base * (n - 1));
    return parts;
  }

  const ids = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

  function allocate(st) {
    const lines = [];
    const warn = new Set();
    const push = (src, rec, site, date, amount, extra) =>
      lines.push(Object.assign({ src, id: rec.id, site, date: date || '', amount }, extra || {}));
    const allSites = Array.from(new Set(st.sites.map(r => String(r.id))));
    const distributeGeneral = (src, rec, date, amount, extra) => {
      if (!allSites.length) return push(src, rec, null, date, amount, extra);
      split(amount, allSites.length).forEach((a, i) => push(src, rec, allSites[i], date, a, extra));
    };
    const distributeMonth = (src, rec, month, date, amount) => {
      const sites = Array.from(new Set(st.sites.filter(s => month && s.month === month).map(s => String(s.id))));
      if (sites.length) split(amount, sites.length).forEach((a, i) => push(src, rec, sites[i], date, a));
      else push(src, rec, null, date, amount, { unallocatedMonth: month || 'غير محدد' });
    };

    // خصومات الشركة تكلفة موجبة للمواقع التابعة لشهر تاريخ الخصم.
    // المستحقات والدفعات المستلمة تبقى ضمن رصيد الشركة فقط.
    (st.company || []).filter(r => r.kind === COMPANY_KIND.DEDUCT).forEach(r => {
      distributeMonth('company', r, String(r.date || '').slice(0, 7), r.date, Number(r.amount) || 0);
    });

    // 1) المقاول: الحساب موجب، والخصم والدفعة والسلفة تُطرح من رصيده.
    st.contractor.forEach(r => {
      const a = Number(r.amount) || 0;
      const amount = r.kind === CKIND.ACCOUNT ? a : -a;
      if (r.site) push('contractor', r, r.site, r.date, amount);
      else distributeGeneral('contractor', r, r.date, amount);
    });

    // 2) المهندس والفنيين
    // وحدات الحضور: (شخص، موقع، يوم) من سجلات "حضور" فقط
    const presence = {};
    st.staff.filter(r => r.kind === KIND.PRESENT).forEach(r => {
      ids(r.sites).forEach(site => {
        const key = r.person + '|' + site + '|' + r.date;
        (presence[r.person] = presence[r.person] || {})[key] = { site, date: r.date };
      });
    });

    st.staff.forEach(r => {
      const amount = Number(r.amount) || 0;
      const sites = ids(r.sites);
      // السلفة/الدفعة تسدّد من رصيد الشخص ولا تضيف تكلفة جديدة على الموقع.
      if (r.kind === KIND.PRESENT || r.kind === KIND.PAYMENT || !amount) return;
      // مواد دفعها الشخص من جيبه: مصروف على المواقع ومستحق له، بدون ربطها بأيام الحضور.
      if (r.kind === KIND.MATERIAL) {
        if (!sites.length) {
          distributeGeneral('staff', r, r.date, amount, { person: r.person, material: true });
          return;
        }
        split(amount, sites.length).forEach((a, i) => push('staff', r, sites[i], r.date, a, { person: r.person, material: true }));
        return;
      }
      if (r.kind === KIND.DAY) {
        // حساب يومي: يقسم على المواقع التي عمل بها في ذلك اليوم
        split(amount, sites.length).forEach((a, i) => push('staff', r, sites[i], r.date, a, { person: r.person }));
        return;
      }
      // حساب على الموقع: يتوزع على أيام الحضور المسجلة لنفس الشخص في هذه المواقع
      const units = Object.values(presence[r.person] || {}).filter(u => sites.indexOf(u.site) !== -1);
      if (!units.length) {
        warn.add(r.id);
        split(amount, sites.length).forEach((a, i) => push('staff', r, sites[i], r.date, a, { person: r.person, noDays: true }));
        return;
      }
      split(amount, units.length).forEach((a, i) => push('staff', r, units[i].site, units[i].date, a, { person: r.person }));
    });

    // 3) السيارة + الدفعات العشوائية: عام / شهر / مواقع
    ['car', 'misc'].forEach(src => {
      st[src].forEach(r => {
        const amount = Number(r.amount) || 0;
        if (r.scopeType === SCOPE.SITES) {
          const sites = ids(r.sites);
          if (sites.length) {
            split(amount, sites.length).forEach((a, i) => push(src, r, sites[i], r.date, a));
            return;
          }
        }
        const date = r.scopeType === SCOPE.MONTH && r.month ? r.month + '-01' : r.date;
        if (r.scopeType === SCOPE.MONTH) {
          distributeMonth(src, r, r.month, date, amount);
        }
        else distributeGeneral(src, r, date, amount);
      });
    });

    return { lines, warn };
  }

  // حركة النقد والمبالغ المستحقة حتى تاريخ محدد، مستقلة عن توزيع تكلفة المواقع.
  function cashSummary(st, asOf) {
    const throughToday = r => !r.date || r.date <= asOf;
    const amount = r => Number(r.amount) || 0;
    let paid = 0, contractorDue = 0;
    const people = new Map();
    const person = name => {
      if (!people.has(name)) people.set(name, { earned: 0, paid: 0 });
      return people.get(name);
    };
    st.contractor.filter(throughToday).forEach(r => {
      const a = amount(r);
      contractorDue += r.kind === CKIND.ACCOUNT ? a : -a;
      if (r.kind === CKIND.PAYMENT || r.kind === CKIND.ADVANCE) paid += a;
    });
    st.staff.filter(throughToday).forEach(r => {
      const p = person(r.person), a = amount(r);
      if (r.kind === KIND.PAYMENT) { p.paid += a; paid += a; }
      else if (r.kind === KIND.DAY || r.kind === KIND.SITE || r.kind === KIND.MATERIAL) p.earned += a;
    });
    st.car.filter(throughToday).forEach(r => {
      if (r.person) person(r.person).earned += amount(r);
      else paid += amount(r);
    });
    st.misc.filter(throughToday).forEach(r => { paid += amount(r); });
    // الزيادة المدفوعة لشخص لا تسدد مستحقات شخص آخر.
    const remaining = Math.max(0, round3(contractorDue)) + Array.from(people.values())
      .reduce((sum, p) => sum + Math.max(0, round3(p.earned - p.paid)), 0);
    const allocated = allocate(st).lines;
    const sources = ['company', 'contractor', 'staff', 'car', 'misc'];
    const records = new Map(sources.flatMap(src => (st[src] || []).map(r => [src + '|' + r.id, r])));
    const recordedExpense = allocated.filter(line => {
      const rec = records.get(line.src + '|' + line.id);
      return !rec || throughToday(rec);
    }).reduce((sum, line) => sum + line.amount, 0);
    const paidTotal = round3(paid), remainingTotal = round3(remaining);
    return {
      paid: paidTotal,
      remaining: remainingTotal,
      companyDue: round3(recordedExpense - paidTotal - remainingTotal)
    };
  }

  window.Calc = { allocate, cashSummary, split, ids, round3 };
})();

