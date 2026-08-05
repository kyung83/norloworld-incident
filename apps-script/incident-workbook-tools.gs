/**
 * =============================================================================
 * incident-workbook-tools.gs  —  Norlo Safety Incident, office-side tools
 * =============================================================================
 *
 * CONTAINER-BOUND script, living in the Apps Script project attached to the
 * "Incident Report Updated" workbook alongside incident-api.gs and
 * IncidentDashboard.gs.
 *
 * It gives Riley / Mark / Spencer menus to work incidents without leaving the
 * sheet:
 *
 *   📋 Incident Dashboard  ->  Open
 *   🛡 Safety Incident     ->  Log update / Close & email / Set up tabs
 *
 * WHY CONTAINER-BOUND (and not another web-app route):
 *   Bound to the workbook, the script runs as whoever has the sheet open. Since
 *   the safety team is all @norloworld.com, Session.getActiveUser().getEmail()
 *   returns their REAL email. The "Added by" field is therefore honest, not a
 *   self-selected dropdown that anyone could spoof. onOpen / getUi only work
 *   from a bound script, which is what makes the menu possible at all.
 *
 * NOTHING in IncidentUpdates is ever edited or deleted. Corrections are new
 * rows. That append-only log is the record of what was known and when.
 * =============================================================================
 */

// ---- Config -----------------------------------------------------------------
var DATA_TAB      = 'IncidentsData';
var UPDATES_TAB   = 'IncidentUpdates';
var QUEUE_TAB     = 'Queue';
var SAFETY_EMAIL  = 'safety@norloworld.com';
var TZ            = 'America/Detroit';

// The append-only update log's headers, in order.
var UPDATE_HEADERS = [
  'Update ID', 'Case Number', 'Timestamp', 'Added By',
  'Category', 'Update', 'Attachment'
];

// Dropdown categories, so the log can be filtered later instead of free text.
var UPDATE_CATEGORIES = [
  'Police / court',
  'Other party or their insurer',
  'Our insurer',
  'Driver contact',
  'Repair or equipment',
  'Freight or customer',
  'Internal note'
];

// Columns this tool adds to IncidentsData if they are not already present.
// Appended at the end, so header-addressed reads on the web-app side are
// unaffected.
var CLOSE_COLUMNS = ['Closed By', 'Closed At', 'Closing Summary'];


// =============================================================================
// MENUS
// =============================================================================

/**
 * Two separate top-level menus rather than one.
 *
 * The dashboard is what safety opens every day; the other three act on a
 * selected row and assume you are already working in the sheet. Giving the
 * dashboard its own menu label puts it one level shallower and makes it the
 * obvious thing to click.
 *
 * Sheets does not allow a top-level menu that fires directly on click — every
 * custom menu opens a dropdown — so "Open" is the single item inside it. That
 * is as close to a toolbar button as the platform permits.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();

  ui.createMenu('📋 Incident Dashboard')
    .addItem('Open', 'openIncidentDashboard')
    .addToUi();

  ui.createMenu('🛡 Safety Incident')
    .addItem('Log update for selected incident…', 'menuLogUpdate')
    .addItem('Close & email selected incident…', 'menuCloseIncident')
    .addSeparator()
    .addItem('Set up tabs (run once)', 'menuSetup')
    .addToUi();
}


// =============================================================================
// SETUP — run once
// =============================================================================

function menuSetup() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();

  if (!ss.getSheetByName(DATA_TAB)) {
    ui.alert('Cannot find a tab named "' + DATA_TAB + '". Open this from the ' +
             'incident workbook and try again.');
    return;
  }

  // 1. IncidentUpdates ------------------------------------------------------
  var updates = ss.getSheetByName(UPDATES_TAB);
  if (!updates) updates = ss.insertSheet(UPDATES_TAB);
  if (updates.getLastRow() === 0) {
    updates.getRange(1, 1, 1, UPDATE_HEADERS.length)
           .setValues([UPDATE_HEADERS])
           .setFontWeight('bold');
    updates.setFrozenRows(1);
  }
  // Category dropdown on column E for a healthy number of rows.
  var catCol = UPDATE_HEADERS.indexOf('Category') + 1;
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(UPDATE_CATEGORIES, true)
    .setAllowInvalid(true)
    .build();
  updates.getRange(2, catCol, 2000, 1).setDataValidation(rule);

  // 2. Closing columns on IncidentsData ------------------------------------
  var data = ss.getSheetByName(DATA_TAB);
  CLOSE_COLUMNS.forEach(function (h) { ensureColumn_(data, h); });

  // 3. Queue view ----------------------------------------------------------
  var queue = ss.getSheetByName(QUEUE_TAB);
  if (!queue) queue = ss.insertSheet(QUEUE_TAB);
  queue.clear();
  // Live: everything not Closed, Tier 1 first, then newest. Headers come from
  // IncidentsData row 1 (the "1" trailing arg to QUERY).
  var formula =
    '=QUERY(' + DATA_TAB + '!A1:AB, "select A, M, P, B, C, D, E, G ' +
    'where lower(P) <> \'closed\' order by M asc, B desc", 1)';
  queue.getRange(1, 1).setFormula(formula);
  queue.setFrozenRows(1);

  ui.alert('Setup complete.\n\n' +
           '• "' + UPDATES_TAB + '" tab ready (append-only log).\n' +
           '• "' + QUEUE_TAB + '" tab shows the live open queue.\n' +
           '• "' + DATA_TAB + '" gained: ' + CLOSE_COLUMNS.join(', ') + '.\n\n' +
           'Use the 🛡 Safety Incident menu to log updates and close incidents.');
}


// =============================================================================
// LOG UPDATE
// =============================================================================

function menuLogUpdate() {
  var ui = SpreadsheetApp.getUi();
  var caseNumber = activeCaseNumber_();
  if (!caseNumber) {
    ui.alert('Select the row of the incident you want to log against first ' +
             '(any cell in that row, on the Queue or ' + DATA_TAB + ' tab).');
    return;
  }
  var options = UPDATE_CATEGORIES.map(function (c) {
    return '<option value="' + escapeHtml_(c) + '">' + escapeHtml_(c) + '</option>';
  }).join('');

  var html = '' +
    '<div style="font:14px Arial,sans-serif;color:#111;padding:4px 8px;">' +
    '<p style="margin:0 0 10px;">Logging an update for ' +
      '<b>' + escapeHtml_(caseNumber) + '</b>. This is added as a new row and ' +
      'never overwrites anything.</p>' +
    '<label style="font-weight:bold;">Category</label><br>' +
    '<select id="cat" style="width:100%;padding:6px;margin:4px 0 10px;">' + options + '</select>' +
    '<label style="font-weight:bold;">Update</label><br>' +
    '<textarea id="text" rows="5" style="width:100%;padding:6px;margin:4px 0 10px;" ' +
      'placeholder="What was learned, from whom, and when."></textarea>' +
    '<label style="font-weight:bold;">Attachment link (optional)</label><br>' +
    '<input id="att" type="text" style="width:100%;padding:6px;margin:4px 0 12px;" ' +
      'placeholder="Drive or web URL">' +
    '<div style="text-align:right;">' +
      '<button onclick="google.script.host.close()" ' +
        'style="padding:8px 14px;margin-right:6px;">Cancel</button>' +
      '<button id="save" onclick="save()" ' +
        'style="padding:8px 18px;background:#125e4d;color:#fff;border:none;border-radius:4px;">' +
        'Save update</button>' +
    '</div></div>' +
    '<script>' +
    'function save(){' +
      'var t=document.getElementById("text").value.trim();' +
      'if(!t){alert("Enter the update text.");return;}' +
      'document.getElementById("save").disabled=true;' +
      'google.script.run.withSuccessHandler(function(){google.script.host.close();})' +
        '.withFailureHandler(function(e){alert("Save failed: "+e.message);' +
        'document.getElementById("save").disabled=false;})' +
        '.saveIncidentUpdate({' +
          'caseNumber:' + JSON.stringify(caseNumber) + ',' +
          'category:document.getElementById("cat").value,' +
          'text:t,' +
          'attachment:document.getElementById("att").value.trim()});' +
    '}' +
    '</script>';

  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(420).setHeight(360),
                     'Log update');
}

/** Called from the dialog. Appends one append-only row. */
function saveIncidentUpdate(p) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(UPDATES_TAB);
  if (!sheet) throw new Error('Run "Set up tabs" first — no ' + UPDATES_TAB + ' tab.');

  var now = new Date();
  var row = {};
  row['Update ID']   = 'UPD-' + Utilities.formatDate(now, TZ, 'yyyyMMdd-HHmmss');
  row['Case Number'] = p.caseNumber;
  row['Timestamp']   = Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm');
  row['Added By']    = currentUser_();
  row['Category']    = p.category || 'Internal note';
  row['Update']      = p.text || '';
  row['Attachment']  = p.attachment || '';

  sheet.appendRow(UPDATE_HEADERS.map(function (h) { return row[h]; }));
  return true;
}


// =============================================================================
// CLOSE & EMAIL
// =============================================================================

function menuCloseIncident() {
  var ui = SpreadsheetApp.getUi();
  var caseNumber = activeCaseNumber_();
  if (!caseNumber) {
    ui.alert('Select the row of the incident you want to close first ' +
             '(any cell in that row, on the Queue or ' + DATA_TAB + ' tab).');
    return;
  }

  var html = '' +
    '<div style="font:14px Arial,sans-serif;color:#111;padding:4px 8px;">' +
    '<p style="margin:0 0 10px;">Closing <b>' + escapeHtml_(caseNumber) + '</b>. ' +
      'This builds a PDF of the whole record, emails it to ' +
      escapeHtml_(SAFETY_EMAIL) + ', files it to the incident\'s Drive folder, ' +
      'and sets the status to Closed.</p>' +
    '<label style="font-weight:bold;">Closing summary (required)</label><br>' +
    '<textarea id="sum" rows="5" style="width:100%;padding:6px;margin:4px 0 12px;" ' +
      'placeholder="One paragraph: what happened and how it resolved."></textarea>' +
    '<div style="text-align:right;">' +
      '<button onclick="google.script.host.close()" ' +
        'style="padding:8px 14px;margin-right:6px;">Cancel</button>' +
      '<button id="go" onclick="go()" ' +
        'style="padding:8px 18px;background:#8a1c1c;color:#fff;border:none;border-radius:4px;">' +
        'Build PDF, email &amp; close</button>' +
    '</div>' +
    '<p id="msg" style="margin:10px 0 0;color:#555;"></p></div>' +
    '<script>' +
    'function go(){' +
      'var s=document.getElementById("sum").value.trim();' +
      'if(!s){alert("A closing summary is required.");return;}' +
      'document.getElementById("go").disabled=true;' +
      'document.getElementById("msg").textContent="Working… building PDF and sending.";' +
      'google.script.run.withSuccessHandler(function(m){' +
        'document.getElementById("msg").textContent=m;' +
        'setTimeout(function(){google.script.host.close();},1500);})' +
        '.withFailureHandler(function(e){alert("Close failed: "+e.message);' +
        'document.getElementById("go").disabled=false;' +
        'document.getElementById("msg").textContent="";})' +
        '.closeIncident(' + JSON.stringify(caseNumber) + ',s);' +
    '}' +
    '</script>';

  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(440).setHeight(320),
                     'Close incident');
}

/** Called from the dialog. Builds the PDF, emails, files, and marks Closed. */
function closeIncident(caseNumber, summary) {
  if (!summary || !String(summary).trim()) throw new Error('Closing summary is required.');

  var ss    = SpreadsheetApp.getActive();
  var data  = ss.getSheetByName(DATA_TAB);
  var rowNum = rowForCase_(data, caseNumber);
  if (!rowNum) throw new Error('Case ' + caseNumber + ' not found in ' + DATA_TAB + '.');

  var row     = rowObject_(data, rowNum);
  var updates = updatesForCase_(caseNumber);
  var closedBy = currentUser_();
  var closedAt = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');

  var driver = String(row['Driver'] || 'Driver').replace(/[^\w \-]/g, '').trim() || 'Driver';
  var html = buildIncidentPrintHTML_(row, updates, summary, closedBy, closedAt);
  var pdf = Utilities.newBlob(html, 'text/html')
    .getAs('application/pdf')
    .setName(caseNumber + '_' + driver + '.pdf');

  // Email — plain summary in the body, full record attached.
  MailApp.sendEmail({
    to: SAFETY_EMAIL,
    subject: 'Incident ' + caseNumber + ' — ' + driver + ' — closed',
    htmlBody: '<p>' + escapeHtml_(summary) + '</p>' +
              '<p style="color:#666;">Closed by ' + escapeHtml_(closedBy) +
              ' on ' + closedAt + '. Full record attached.</p>',
    attachments: [pdf]
  });

  // File the PDF back to the incident's Drive folder when we can find it.
  var filedTo = '';
  try {
    var folderId = driveIdFromUrl_(row['Photos — Folder']);
    if (folderId) {
      DriveApp.getFolderById(folderId).createFile(pdf);
      filedTo = ' and filed to the incident folder';
    }
  } catch (e) { /* non-fatal: the email still went */ }

  // Mark closed.
  setCell_(data, rowNum, 'Status', 'Closed');
  setCell_(data, rowNum, 'Closed By', closedBy);
  setCell_(data, rowNum, 'Closed At', closedAt);
  setCell_(data, rowNum, 'Closing Summary', summary);

  return 'Emailed to ' + SAFETY_EMAIL + filedTo + '. Status set to Closed.';
}


// =============================================================================
// onEdit — stamp hand-typed update rows
// =============================================================================

/**
 * If someone types into the Update column of IncidentUpdates by hand (rather
 * than the dialog), fill in a missing ID / timestamp / editor so every row is
 * self-describing. Never overwrites an existing value.
 */
function onEdit(e) {
  try {
    var sheet = e.range.getSheet();
    if (sheet.getName() !== UPDATES_TAB) return;
    var r = e.range.getRow();
    if (r < 2) return;

    var updCol = UPDATE_HEADERS.indexOf('Update') + 1;
    if (e.range.getColumn() !== updCol) return;
    if (!String(e.value || '').trim()) return;

    var now = new Date();
    var idCell = sheet.getRange(r, UPDATE_HEADERS.indexOf('Update ID') + 1);
    if (!idCell.getValue())
      idCell.setValue('UPD-' + Utilities.formatDate(now, TZ, 'yyyyMMdd-HHmmss'));

    var tsCell = sheet.getRange(r, UPDATE_HEADERS.indexOf('Timestamp') + 1);
    if (!tsCell.getValue())
      tsCell.setValue(Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm'));

    var byCell = sheet.getRange(r, UPDATE_HEADERS.indexOf('Added By') + 1);
    if (!byCell.getValue()) byCell.setValue(currentUser_());
  } catch (err) { /* onEdit must never throw */ }
}


// =============================================================================
// PDF BUILDER
// =============================================================================

/**
 * Portrait letter record: what the driver reported (read-only), photos, the
 * update log in order, and the closing summary. Mirrors the mechanics app's
 * getAs('application/pdf') approach, with incident field names.
 */
function buildIncidentPrintHTML_(row, updates, summary, closedBy, closedAt) {
  _embedUsed = 0;   // fresh budget for this document
  function val(k) { return escapeHtml_(row[k] == null ? '' : String(row[k])); }
  function fieldRows(pairs) {
    return pairs.map(function (p) {
      return '<tr><td class="k">' + escapeHtml_(p[0]) + '</td><td class="v">' +
             (p[2] ? p[2] : val(p[1])) + '</td></tr>';
    }).join('');
  }

  var identity = fieldRows([
    ['Case Number', 'Case Number'], ['Tier', 'Tier'],
    ['Tier reasons', 'Tier Reasons'], ['Lane', 'Lane'], ['Status', 'Status']
  ]);
  var driverBlock = fieldRows([
    ['Driver', 'Driver'], ['Driver phone', 'Driver Phone'],
    ['Truck', 'Truck'], ['Trailer', 'Trailer']
  ]);
  var whenWhere = fieldRows([
    ['Reported', 'Timestamp'], ['Location', 'Location'],
    ['City', 'City'], ['State', 'State']
  ]);
  var whatBlock = fieldRows([
    ['Type', 'Type'], ['Subcategory', 'Subcategory'],
    ['Description', 'Description']
  ]);
  var bookkeeping = fieldRows([
    ['Marked N/A', 'Not applicable'], ['Answered no', 'Answered no'],
    ['Office notes', 'Office Notes']
  ]);

  var photos = ['Photo — Scene', 'Photo — Our Truck', 'Photo — Other']
    .map(function (k) {
      var url = row[k];
      if (!url) return '';
      return '<div class="photo"><div class="cap">' + escapeHtml_(k) + '</div>' +
             embedImg_(url) + '</div>';
    }).join('');
  var folderUrl = row['Photos — Folder'];
  var folderLink = folderUrl
    ? '<p><a href="' + escapeHtml_(String(folderUrl)) + '">Open all photos in Drive</a></p>' : '';

  var log = (updates && updates.length)
    ? updates.map(function (u) {
        return '<tr><td class="lt">' + escapeHtml_(u['Timestamp'] || '') + '</td>' +
               '<td class="lb">' + escapeHtml_(u['Added By'] || '') + '</td>' +
               '<td class="lc">' + escapeHtml_(u['Category'] || '') + '</td>' +
               '<td class="lx">' + escapeHtml_(u['Update'] || '') +
               (u['Attachment'] ? '<br><a href="' + escapeHtml_(String(u['Attachment'])) +
                 '">attachment</a>' : '') + '</td></tr>';
      }).join('')
    : '<tr><td colspan="4" class="lx" style="color:#777;">No log entries.</td></tr>';

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:0;padding:14px;}' +
    'h1{font-size:16px;margin:0 0 2px;} h2{font-size:12px;background:#125e4d;color:#fff;' +
      'padding:4px 6px;margin:14px 0 4px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
    'table{border-collapse:collapse;width:100%;}' +
    'td{border:1px solid #ccc;padding:3px 6px;vertical-align:top;}' +
    'td.k{font-weight:bold;background:#eee;width:130px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
    '.sub{color:#555;margin:0 0 8px;}' +
    '.photo{display:inline-block;width:31%;margin:1%;text-align:center;vertical-align:top;}' +
    '.photo img{max-width:100%;max-height:150px;object-fit:contain;border:1px solid #ccc;}' +
    '.cap{font-weight:bold;font-size:9px;margin-bottom:2px;}' +
    'td.lt{width:110px;} td.lb{width:150px;} td.lc{width:120px;font-style:italic;}' +
    '.summary{border:2px solid #8a1c1c;padding:8px;background:#fbf3f3;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
    '</style></head><body>' +
    '<h1>Incident ' + val('Case Number') + ' — ' + val('Driver') + '</h1>' +
    '<p class="sub">CLOSED — ' + escapeHtml_(closedBy) + ' on ' + escapeHtml_(closedAt) + '</p>' +
    '<h2>Incident</h2><table>' + identity + '</table>' +
    '<h2>Driver &amp; equipment</h2><table>' + driverBlock + '</table>' +
    '<h2>When &amp; where</h2><table>' + whenWhere + '</table>' +
    '<h2>What the driver reported</h2><table>' + whatBlock + '</table>' +
    '<h2>Checklist bookkeeping</h2><table>' + bookkeeping + '</table>' +
    '<h2>Photos</h2>' + (photos || '<p style="color:#777;">No photos.</p>') + folderLink +
    '<h2>Update log</h2><table>' +
      '<tr><td class="k">When</td><td class="k">Added by</td><td class="k">Category</td><td class="k">Update</td></tr>' +
      log + '</table>' +
    '<h2>Closing summary</h2><div class="summary">' + escapeHtml_(summary) + '</div>' +
    '</body></html>';
}


// =============================================================================
// HELPERS
//
// Deliberately separate from the colFor_ / setByHeader_ pair in incident-api.gs.
// Those cache headers in a single global without keying by sheet, which returns
// the wrong column once a second tab is touched in the same execution — and
// these tools read IncidentsData and IncidentUpdates in one run. Do not "clean
// up the duplication" by merging them.
// =============================================================================

/** Real email of whoever is running this, or a clear fallback. */
function currentUser_() {
  var e = '';
  try { e = Session.getActiveUser().getEmail(); } catch (ignored) {}
  return e || 'unknown@norloworld.com';
}

/** Per-sheet header -> 1-based column index. Not cached; sheets are small. */
function headerMap_(sheet) {
  var last = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, last).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).trim();
    if (h) map[h] = i + 1;
  }
  return map;
}

function colIndex_(sheet, header) {
  var m = headerMap_(sheet);
  return m[header] === undefined ? -1 : m[header];
}

/** Ensure a header exists; append it at the end if missing. Returns its column. */
function ensureColumn_(sheet, header) {
  var col = colIndex_(sheet, header);
  if (col > 0) return col;
  col = sheet.getLastColumn() + 1;
  sheet.getRange(1, col).setValue(header).setFontWeight('bold');
  return col;
}

function setCell_(sheet, rowNum, header, value) {
  var col = ensureColumn_(sheet, header);
  sheet.getRange(rowNum, col).setValue(value);
}

/** Row object keyed by header name. */
function rowObject_(sheet, rowNum) {
  var last = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, last).getValues()[0];
  var values  = sheet.getRange(rowNum, 1, 1, last).getValues()[0];
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).trim();
    if (h) obj[h] = values[i];
  }
  return obj;
}

/** 1-based row of a case number in a sheet, or 0. */
function rowForCase_(sheet, caseNumber) {
  var col = colIndex_(sheet, 'Case Number');
  if (col < 0) return 0;
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, col, last - 1, 1).getValues();
  var target = String(caseNumber).trim();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === target) return i + 2;
  }
  return 0;
}

/** Case Number on the active row of the active sheet, or ''. */
function activeCaseNumber_() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var col = colIndex_(sheet, 'Case Number');
  if (col < 0) return '';
  var r = sheet.getActiveRange().getRow();
  if (r < 2) return '';
  return String(sheet.getRange(r, col).getValue()).trim();
}

/** All update rows for a case, oldest first. */
function updatesForCase_(caseNumber) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(UPDATES_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var last = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, last).getValues()[0];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, last).getValues();
  var target = String(caseNumber).trim();
  var out = [];
  rows.forEach(function (r) {
    var obj = {};
    for (var i = 0; i < headers.length; i++) obj[String(headers[i]).trim()] = r[i];
    if (String(obj['Case Number']).trim() === target) out.push(obj);
  });
  return out;
}

/** Extract a Drive file/folder id from a share URL, or '' if none. */
function driveIdFromUrl_(url) {
  if (!url) return '';
  var s = String(url);
  var m = s.match(/[-\w]{25,}/);
  return m ? m[0] : '';
}

/**
 * Inline a Drive image as base64, or fall back to a link.
 *
 * Base64 inflates an image by a third and Apps Script's HTML-to-PDF conversion
 * slows down sharply as the document grows — a few large photos can push a PDF
 * that should take seconds into the minutes, or past the execution limit
 * entirely.
 *
 * So there is a budget. Photos are embedded until it runs out, then the rest
 * become links. The wide shot and our equipment come first in the caller's
 * list, so the shots that matter most are the ones that get embedded.
 */
var EMBED_BUDGET_BYTES = 900000;   // ~900 KB of image data per PDF
var _embedUsed = 0;

function embedImg_(url) {
  var s = String(url);
  try {
    var id = driveIdFromUrl_(s);
    if (!id) return photoLink_(s);

    if (_embedUsed >= EMBED_BUDGET_BYTES) return photoLink_(s, 'not embedded');

    var blob  = DriveApp.getFileById(id).getBlob();
    var bytes = blob.getBytes();

    // A single oversized photo should not eat the whole budget.
    if (bytes.length > 400000) return photoLink_(s, 'too large to embed');

    _embedUsed += bytes.length;
    var b64 = 'data:' + blob.getContentType() + ';base64,' +
              Utilities.base64Encode(bytes);
    return '<img src="' + b64 + '">';
  } catch (e) {
    return photoLink_(s);
  }
}

function photoLink_(url, why) {
  return '<a href="' + escapeHtml_(String(url)) + '">Open photo in Drive</a>' +
         (why ? '<div style="font-size:8px;color:#888;">' + why + '</div>' : '');
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
