/**
 * الخلفية (Backend) لموقع "حسابات المواقع".
 * هذا الملف يُلصق داخل Google Apps Script، ويستخدم ملف Google Sheets المحدد أدناه.
 *
 * الفكرة: كل قسم = شيت. الموقع يرسل طلبات POST بصيغة JSON،
 * وهذا الكود يقرأ ويكتب في الشيتات. لا توجد بيانات مخزنة في الموقع نفسه.
 *
 * الإعداد المطلوب مرة واحدة:
 *   1) Project Settings > Script properties > أضف APP_PASSWORD = كلمة سر من اختيارك
 *   2) شغّل الدالة setup() مرة واحدة (تنشئ الشيتات والعناوين)
 *   3) Deploy > New deployment > Web app
 *        Execute as: Me | Who has access: Anyone
 *   4) انسخ رابط الـ Web app إلى js/config.js في الموقع (API_URL)
 *
 * ملاحظة: بعد أي تعديل على هذا الكود لازم تعمل Deploy > Manage deployments > Edit > New version.
 */

// تعريف الشيتات. الترتيب هو ترتيب الأعمدة. [المفتاح، عنوان العمود بالعربي]
// المفاتيح (بالإنجليزي) هي نفسها المستخدمة في js/app.js، لا تغيّرها بدون تعديل الموقع.
const SCHEMA = {
  contractor: {
    name: 'Contractor',
    // kind: حساب أو خصم (مثل الضمان الاجتماعي لموظفي المقاول). الخصم قد يكون بدون موقع (عام).
    cols: [['id', 'ID'], ['date', 'Date'], ['kind', 'Type'], ['site', 'Site'],
           ['amount', 'Amount'], ['label', 'Deduction Item'], ['notes', 'Details / Notes'], ['created', 'Created At']],
    text: ['id', 'date', 'kind', 'site', 'label', 'notes', 'created'],
    hideId: true
  },
  staff: {
    name: 'Staff',
    cols: [['id', 'ID'], ['person', 'Name'], ['role', 'Role'], ['kind', 'Entry Type'],
           ['date', 'Date'], ['sites', 'Sites'], ['amount', 'Amount'], ['notes', 'Notes'],
           ['created', 'Created At']],
    text: ['id', 'person', 'role', 'kind', 'date', 'sites', 'notes', 'created'],
    hideId: true
  },
  car: {
    name: 'Car',
    cols: [['id', 'ID'], ['date', 'Date'], ['amount', 'Amount'], ['scopeType', 'Scope'],
           ['sites', 'Sites'], ['month', 'Month'], ['person', 'Linked Person'],
           ['notes', 'Notes'], ['created', 'Created At']],
    text: ['id', 'date', 'scopeType', 'sites', 'month', 'person', 'notes', 'created'],
    hideId: true
  },
  misc: {
    name: 'Misc Payments',
    cols: [['id', 'ID'], ['date', 'Date'], ['category', 'Category'], ['amount', 'Amount'],
           ['scopeType', 'Scope'], ['sites', 'Sites'], ['month', 'Month'], ['notes', 'Notes'],
           ['created', 'Created At']],
    text: ['id', 'date', 'category', 'scopeType', 'sites', 'month', 'notes', 'created'],
    hideId: true
  },
  // المواقع: عمود id هنا هو اسم/رقم الموقع نفسه (يظهر للمستخدم).
  sites: {
    name: 'Sites',
    cols: [['id', 'Site Number'], ['notes', 'Notes']],
    text: ['id', 'notes']
  },
  // قوائم الاختيار (مثلاً بنود الدفعات العشوائية). list = اسم القائمة، value = القيمة.
  lists: {
    name: 'Lists',
    cols: [['id', 'ID'], ['list', 'List'], ['value', 'Value']],
    text: ['id', 'list', 'value'],
    hideId: true
  }
};

// Translate only fixed values at the Sheets boundary. The Arabic site UI keeps its current values.
const STORED_VALUES = {
  kind: { 'حساب': 'Account', 'خصم': 'Deduction', 'يومي': 'Daily', 'على الموقع': 'By Site', 'حضور': 'Attendance' },
  role: { 'مهندس': 'Engineer', 'فني': 'Technician' },
  scopeType: { 'عام': 'General', 'مواقع': 'Sites', 'شهر': 'Month' },
  list: { 'بند': 'Category' }
};
const UI_VALUES = {};
Object.keys(STORED_VALUES).forEach(key => {
  UI_VALUES[key] = {};
  Object.keys(STORED_VALUES[key]).forEach(ar => { UI_VALUES[key][STORED_VALUES[key][ar]] = ar; });
});

// ملف حسابات المواقع في Google Sheets. لا يمنح المعرّف وحده صلاحية الوصول إلى الملف.
const SPREADSHEET_ID = '1MRrG4-SrkXPEGqSUNizcfEC9_wOqxNGHuZS7_fDS6C0';
function spreadsheet_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

const DATE_KEYS = ['date'];
const MONTH_KEYS = ['month'];
const NUM_KEYS = ['amount'];

/* ---------- نقاط الدخول ---------- */

function doGet() {
  return json_({ ok: true, message: 'API is running' });
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    checkPassword_(req.password);
    switch (req.action) {
      case 'ping':
        out = { ok: true };
        break;
      case 'bootstrap':
        out = { ok: true, data: readAll_() };
        break;
      case 'add':
        out = { ok: true, record: withLock_(() => add_(req.sheet, req.record)) };
        break;
      case 'update':
        out = { ok: true, record: withLock_(() => update_(req.sheet, req.record)) };
        break;
      case 'delete':
        out = { ok: true, id: withLock_(() => remove_(req.sheet, req.id)) };
        break;
      default:
        throw new Error('إجراء غير معروف: ' + req.action);
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return json_(out);
}

/** شغّلها مرة واحدة من المحرر لإنشاء الشيتات. */
function setup() {
  Object.keys(SCHEMA).forEach(sheetFor_);
}

/* ---------- أدوات داخلية ---------- */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkPassword_(pw) {
  const real = PropertiesService.getScriptProperties().getProperty('APP_PASSWORD');
  if (!real) throw new Error('لم يتم ضبط APP_PASSWORD في Script properties');
  if (String(pw || '') !== real) throw new Error('UNAUTHORIZED');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function sheetFor_(key) {
  const def = SCHEMA[key];
  if (!def) throw new Error('قسم غير معروف: ' + key);
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(def.name);
  if (!sh) sh = ss.insertSheet(def.name);
  const labels = def.cols.map(c => c[1]);
  sh.getRange(1, 1, 1, labels.length).setValues([labels]).setFontWeight('bold').setBackground('#e8eef0');
  sh.setFrozenRows(1);
  sh.setRightToLeft(false);
  def.cols.forEach((c, i) => {
    if (def.text.indexOf(c[0]) !== -1) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  if (def.hideId && !sh.isColumnHiddenByUser(1)) sh.hideColumns(1);
  return sh;
}

function tz_() { return spreadsheet_().getSpreadsheetTimeZone(); }

function fromCell_(key, v) {
  if (v instanceof Date) {
    if (MONTH_KEYS.indexOf(key) !== -1) return Utilities.formatDate(v, tz_(), 'yyyy-MM');
    if (DATE_KEYS.indexOf(key) !== -1) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
    return Utilities.formatDate(v, tz_(), "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (NUM_KEYS.indexOf(key) !== -1) return v === '' || v === null ? '' : Number(v);
  const value = v === null || v === undefined ? '' : String(v);
  return UI_VALUES[key] && UI_VALUES[key][value] || value;
}

function rowToRec_(def, row) {
  const rec = {};
  def.cols.forEach((c, i) => { rec[c[0]] = fromCell_(c[0], row[i]); });
  return rec;
}

function recToRow_(def, rec) {
  return def.cols.map(c => {
    const v = rec[c[0]];
    if (v === undefined || v === null) return '';
    if (NUM_KEYS.indexOf(c[0]) !== -1 && v !== '') return Number(v);
    return STORED_VALUES[c[0]] && STORED_VALUES[c[0]][v] || v;
  });
}

function readAll_() {
  const data = {};
  Object.keys(SCHEMA).forEach(key => {
    const def = SCHEMA[key];
    const sh = sheetFor_(key);
    const last = sh.getLastRow();
    data[key] = [];
    if (last < 2) return;
    sh.getRange(2, 1, last - 1, def.cols.length).getValues().forEach(row => {
      if (String(row[0]) === '') return;
      data[key].push(rowToRec_(def, row));
    });
  });
  return data;
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function add_(key, rec) {
  const def = SCHEMA[key];
  const sh = sheetFor_(key);
  rec = rec || {};
  // رقم الموقع: 3 أو 4 أرقام فقط
  if (key === 'sites' && !/^\d{3,4}$/.test(String(rec.id || ''))) throw new Error('رقم الموقع لازم يكون 3 أو 4 أرقام');
  rec.id = rec.id ? String(rec.id) : Utilities.getUuid().slice(0, 8);
  if (findRow_(sh, rec.id) !== -1) throw new Error('موجود مسبقاً: ' + rec.id);
  if (def.cols.some(c => c[0] === 'created')) rec.created = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd'T'HH:mm:ss");
  sh.appendRow(recToRow_(def, rec));
  return rec;
}

function update_(key, rec) {
  const def = SCHEMA[key];
  const sh = sheetFor_(key);
  const r = findRow_(sh, rec && rec.id);
  if (r === -1) throw new Error('السجل غير موجود (ربما حُذف من الشيت)');
  const existing = rowToRec_(def, sh.getRange(r, 1, 1, def.cols.length).getValues()[0]);
  const merged = Object.assign({}, existing, rec, { id: existing.id, created: existing.created });
  sh.getRange(r, 1, 1, def.cols.length).setValues([recToRow_(def, merged)]);
  return merged;
}

function remove_(key, id) {
  const sh = sheetFor_(key);
  const r = findRow_(sh, id);
  if (r !== -1) sh.deleteRow(r);
  return id;
}
