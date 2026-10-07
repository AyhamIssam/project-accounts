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
| `apps-script/Code.gs` | Backend. `SPREADSHEET_ID` identifies the workbook; `SCHEMA` defines English tabs and columns. It translates fixed Arabic UI values to English when writing and back when reading. Record keys must stay in sync with `app.js`. |

## Data model (record keys)

- `company`: id, date, kind (`مستحق`/`خصم`/`دفعة مستلمة` in the UI; `Amount Due`/`Deduction`/`Payment Received` in Sheets), site (optional for non-deductions), amount, label (deduction item), notes, created. Balance = due − deductions − received payments. Only deductions also count as positive project expenses under source `company`, split equally across sites whose account month matches the deduction date's YYYY-MM, regardless of any legacy site link. No matches = unallocated with warning. Due and received payments never enter project expenses.
- `worklog`: id, date, team, site, tasks, startTime, endTime, notes, created, members, sites, car, carMode (`سيارة مضمنة`/`سيارة شخص`/`سيارة مقاول`), carPerson, teamType, engineer. The fields after `created` were appended for the existing sheet. Contractor teams use `team` without `members` and may select one optional `engineer`; internal teams can select multiple members. These are non-financial work records.
- `contractor`: id, date, kind (`حساب`/`خصم`/`دفعة`/`سلفة` in the UI; `Account`/`Deduction`/`Payment`/`Advance` in Sheets), site (required for account, optional otherwise), amount, label (deduction item), notes, created. All non-account entries are stored positive and counted negative in `calc.js`.
- `staff`: id, person, role, kind (`يومي`/`على الموقع`/`حضور`/`دفعة`/`مواد` in the UI; `Daily`/`By Site`/`Attendance`/`Payment`/`Materials Paid` in Sheets), date, sites (comma list), amount, notes, created. Materials paid by a person are allocated directly across the selected sites and increase that person's entitlement.
- `car`: id, date, amount, scopeType (`عام`/`مواقع`/`شهر` in the UI; `General`/`Sites`/`Month` in Sheets), sites, month (`YYYY-MM`), person (optional link to a staff name), notes, created
- `misc`: same as car plus `category`
- `sites`: id, notes, month (`YYYY-MM`, optional account month; appended as Account Month). `id` **is the site number itself**, must match `^\d{3,4}$` (validated in `app.js` and `Code.gs`; renaming is not supported; delete + add). Month is edited in Settings, not SECTIONS. Monthly car/misc allocations split equally across sites assigned to that month; absent matches stay unallocated. General amounts split equally across all registered sites.
- `lists`: id, list (`بند`/`سيارة` in the UI, `Category`/`Car` in Sheets), value

Multi-site values are stored as one comma-separated string of site ids.

## Rules to keep

1. Adding a field = (a) add to `SECTIONS[...].fields` and `.cols` in `js/app.js`, (b) add the column at the **end** of that sheet's `cols` in `Code.gs` (before `created` is fine only on fresh sheets; on existing sheets append after `created` or migrate), (c) mention that the user must re-deploy Apps Script as a **new version**.
2. Allocation rules are in `js/calc.js` and described in `README.md`; update both together. Totals in the summary must always equal the sum of entered amounts (test with the demo data: total 2,900.00).
3. Do not use `fetch` with custom headers to Apps Script (no CORS preflight support). Keep `Content-Type: text/plain`.
4. Never commit the real `API_URL` password. The password only lives in Apps Script Script Properties (`APP_PASSWORD`) and the browser's localStorage.
5. Keep RTL + mobile working (test at 390px width). Numbers use the `.num` class (LTR, tabular).
6. Dates are `YYYY-MM-DD` text; months `YYYY-MM`. Sheet text columns are formatted `@` so Sheets does not convert them.

## Quick test

Open `index.html` with empty `API_URL` and fresh demo storage: summary total should be `2,900.00` with site 101 = 1,932.50, site 152 = 965.00, site 2103 = 2.50, unallocated = 0. General contractor deduction 120 and car 60 split across all three sites; monthly misc 30 splits across 101 and 152 assigned to the current month. Existing demo storage may have no site months; assign them in Settings or reset demo data.
