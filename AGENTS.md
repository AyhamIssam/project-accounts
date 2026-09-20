# AGENTS.md — دليل للـ AI الذي يعدّل هذا المشروع

Arabic (RTL) static site for construction-project accounting. Data lives in Google Sheets, reached through a Google Apps Script web app. No build step, no dependencies. Hosted on GitHub Pages. The owner is not a developer: keep changes small, explain them in Arabic, and never add a build tool or framework unless asked.

## Layout

| Path | Role |
|---|---|
| `index.html` | Shell: header, tab nav, `#view`, `<dialog id="dlg">`. Loads scripts in order. |
| `css/style.css` | Tokens on `:root` (light + dark), RTL layout, mobile "card" tables (`table.tbl.cards`). |
| `js/config.js` | `API_URL` (empty = demo mode on localStorage), `CURRENCY`, `TITLE`. |
| `js/schema.js` | Shared constants stored verbatim in the sheets (`KIND`, `ROLE`, `SCOPE`). Arabic strings on purpose. |
| `js/calc.js` | Pure allocation logic (`Calc.allocate(state)`), split with 3-decimal rounding (JOD fils). |
| `js/api.js` | `Api.load/add/update/remove`. Remote = POST `text/plain` JSON to Apps Script; demo = localStorage. |
| `js/app.js` | UI. `SECTIONS` defines each tab's form fields and table columns. |
| `apps-script/Code.gs` | Backend. `SPREADSHEET_ID` identifies the workbook; `SCHEMA` defines sheets + column order. Must stay in sync with the record keys used in `app.js`. |

## Data model (record keys)

- `contractor`: id, date, kind (`حساب`/`خصم`), site (empty allowed for a deduction = general), amount, label (deduction item), notes, created. Deductions are stored positive and counted negative in `calc.js`.
- `staff`: id, person, role, kind (`يومي`/`على الموقع`/`حضور`), date, sites (comma list), amount, notes, created
- `car`: id, date, amount, scopeType (`عام`/`مواقع`/`شهر`), sites, month (`YYYY-MM`), person (optional link to a staff name), notes, created
- `misc`: same as car plus `category`
- `sites`: `id` **is the site number itself**, must match `^\d{3,4}$` (validated in `app.js` and `Code.gs`; renaming is not supported; delete + add)
- `lists`: id, list (`بند` = misc categories), value

Multi-site values are stored as one comma-separated string of site ids.

## Rules to keep

1. Adding a field = (a) add to `SECTIONS[...].fields` and `.cols` in `js/app.js`, (b) add the column at the **end** of that sheet's `cols` in `Code.gs` (before `created` is fine only on fresh sheets; on existing sheets append after `created` or migrate), (c) mention that the user must re-deploy Apps Script as a **new version**.
2. Allocation rules are in `js/calc.js` and described in `README.md`; update both together. Totals in the summary must always equal the sum of entered amounts (test with the demo data: total 2,900.00).
3. Do not use `fetch` with custom headers to Apps Script (no CORS preflight support). Keep `Content-Type: text/plain`.
4. Never commit the real `API_URL` password. The password only lives in Apps Script Script Properties (`APP_PASSWORD`) and the browser's localStorage.
5. Keep RTL + mobile working (test at 390px width). Numbers use the `.num` class (LTR, tabular).
6. Dates are `YYYY-MM-DD` text; months `YYYY-MM`. Sheet text columns are formatted `@` so Sheets does not convert them.

## Quick test

Open `index.html` with empty `API_URL`: demo data loads; summary total should be `2,900.00` with site 101 = 1,937.50, site 152 = 970.00, site 2103 = 22.50, general = -30.00 (contractor 2,750 minus a 120 general deduction; plus 60 car and 30 misc).
