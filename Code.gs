/**
 * TNF QC Scoring — backend (Google Apps Script)
 * --------------------------------------------------------------
 * One Google Sheet = your single source of truth. The dashboard
 * POSTs each stage's fields; this script UPSERTS by ASN Code so
 * different teams filling different stages never overwrite each
 * other. Scores are recomputed server-side after every save, so
 * the sheet your BI connects to is always current.
 *
 * SETUP (5 minutes, no server to maintain):
 *  1. Create a Google Sheet. Note nothing else — leave it blank.
 *  2. Extensions ▸ Apps Script. Delete the sample, paste this file.
 *  3. Run `setup` once (top toolbar ▸ Run). Approve the permission
 *     prompt. This creates the QC_Scores tab with all headers.
 *  4. Deploy ▸ New deployment ▸ type "Web app".
 *       Execute as: Me   |   Who has access: Anyone
 *     Copy the Web app URL.
 *  5. Paste that URL into CONFIG.ENDPOINT in tnf_qc_dashboard.html.
 *  6. Point your BI tool at this same Google Sheet.
 *
 * Re-deploy (Manage deployments ▸ edit ▸ new version) only if you
 * change this script. Editing the dashboard needs no re-deploy.
 */

const SHEET_NAME = 'QC_Scores';

/* Each check is scored 0..MAX_SCORE (0 = best, 2 = worst). Max points
   per side = (#fields) × MAX_SCORE. Keep MAX_SCORE in sync with the
   dashboard CONFIG. */
const MAX_SCORE = 2;

/* EXACT column order. Must match the dashboard's column names. */
const HEADERS = [
  'Date',
  'Created On',
  'Delivery Deadline',
  'PM Checker',
  'QC checker',
  'Review Type (New/Rescue)',
  'ASN Code',
  'Sanctioned Country (Yes (1)/No (0))',
  'Retraction Database (PM)',
  'AI generated text (Yes/No) (PM)',
  'Keyword Mismatch',
  'Primary Subject Area',
  'Secondary Subject Area',
  'Retraction Database (QC)',
  'Generic feedback (Yes/No)',
  'AI generated text changes (Yes/No) (QC)',
  'Total scoring (QC Score)',
  'Total scoring (PM Score)',
  'Error%',
  'Quality Check %',
  'Error% (PM)',
  'PM Check %',
  'Comments (optional)',
  'Last Updated',
  'Stages Completed'
];

const PM_FIELDS = [
  'Sanctioned Country (Yes (1)/No (0))',
  'Retraction Database (PM)',
  'AI generated text (Yes/No) (PM)'
];
const QC_FIELDS = [
  'Keyword Mismatch',
  'Primary Subject Area',
  'Secondary Subject Area',
  'Retraction Database (QC)',
  'Generic feedback (Yes/No)',
  'AI generated text changes (Yes/No) (QC)'
];
const ASN_COL = 'ASN Code';

/* ---------- one-time setup ---------- */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sh.clear();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
}

/* ---------- helpers ---------- */
function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { setup(); sh = ss.getSheetByName(SHEET_NAME); }
  return sh;
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function rowToObj_(headers, row) {
  const o = {};
  headers.forEach((h, i) => { o[h] = row[i]; });
  return o;
}
function num_(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

function recompute_(obj) {
  const pm = PM_FIELDS.reduce((s, c) => s + num_(obj[c]), 0);
  const qc = QC_FIELDS.reduce((s, c) => s + num_(obj[c]), 0);
  const pmMax = PM_FIELDS.length * MAX_SCORE;   // 3 × 2 = 6
  const qcMax = QC_FIELDS.length * MAX_SCORE;   // 6 × 2 = 12
  const errPm = pmMax ? pm / pmMax * 100 : 0;
  const errQc = qcMax ? qc / qcMax * 100 : 0;
  const r = n => Math.round(n * 100) / 100;
  obj['Total scoring (PM Score)'] = pm;
  obj['Total scoring (QC Score)'] = qc;
  obj['Error% (PM)'] = r(errPm);
  obj['PM Check %'] = r(100 - errPm);
  obj['Error%'] = r(errQc);
  obj['Quality Check %'] = r(100 - errQc);
}

/* ---------- GET: read one (?asn=) or all ---------- */
function doGet(e) {
  const sh = sheet_();
  const data = sh.getDataRange().getValues();
  const headers = data.shift();
  const asnIdx = headers.indexOf(ASN_COL);
  const asn = e && e.parameter && e.parameter.asn;

  if (asn) {
    const row = data.find(r => String(r[asnIdx]).trim().toUpperCase() === asn.trim().toUpperCase());
    return json_({ ok: true, record: row ? rowToObj_(headers, row) : null });
  }
  return json_({ ok: true, records: data.map(r => rowToObj_(headers, r)) });
}

/* ---------- POST: upsert by ASN ---------- */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);                       // serialise concurrent saves
  try {
    const payload = JSON.parse(e.postData.contents);
    const asn = String(payload.asn || payload.values[ASN_COL] || '').trim();
    const incoming = payload.values || {};
    if (!asn) return json_({ ok: false, error: 'missing ASN' });

    const sh = sheet_();
    const range = sh.getDataRange();
    const data = range.getValues();
    const headers = data[0];
    const asnIdx = headers.indexOf(ASN_COL);

    // find existing row
    let rowNum = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][asnIdx]).trim().toUpperCase() === asn.toUpperCase()) { rowNum = i; break; }
    }

    // build the record object (existing values, or blanks for a new one)
    let obj;
    if (rowNum > -1) { obj = rowToObj_(headers, data[rowNum]); }
    else { obj = {}; headers.forEach(h => obj[h] = ''); }

    // merge ONLY the incoming columns; never blank out other stages' data
    Object.keys(incoming).forEach(k => {
      if (headers.indexOf(k) > -1 && incoming[k] !== undefined && incoming[k] !== null && incoming[k] !== '') {
        obj[k] = incoming[k];
      }
    });
    obj[ASN_COL] = asn;
    if (!obj['Date']) obj['Date'] = incoming['Date'] || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d/yyyy');
    obj['Last Updated'] = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

    recompute_(obj);

    const rowArr = headers.map(h => obj[h]);
    if (rowNum > -1) {
      sh.getRange(rowNum + 1, 1, 1, headers.length).setValues([rowArr]);
    } else {
      sh.appendRow(rowArr);
    }
    return json_({ ok: true, record: obj });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
