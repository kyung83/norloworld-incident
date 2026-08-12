/**
 * =============================================================================
 * incident-api.gs  —  Norlo Driver Incident Report
 * =============================================================================
 *
 * Companion to the existing Breakdowns API. Deliberately mirrors the idioms
 * already in use at Norlo:
 *   - doGet / doPost switch on a ?route= parameter
 *   - convert2DArrayToObjects() for sheet reads
 *   - errors appended to the shared error-log spreadsheet
 *   - notification handled by norlo-twilio-sms.gs in CLAIM mode
 *
 * WHAT IS NEW HERE
 *   computeSeverity_()  decides Tier 1 / 2 / 3 from the driver's gate answers
 *                       and returns the reasons, which get written to the row
 *                       so Riley and Mark can see WHY it was tiered that way.
 *
 * DESIGN RULES BAKED IN
 *   1. Tier comes from the gate answers, never from which category button the
 *      driver pressed. A "deer strike" with an injury is still Tier 1.
 *   2. Unanswered or unknown gates escalate UPWARD. A false page costs ten
 *      minutes; a missed one costs considerably more.
 *   3. Only Tier 1 sends SMS. Tier 2 and 3 land in the sheet for the morning
 *      queue. That is the whole point of the project.
 *   4. Nothing here decides who calls the driver. Tier 1 blasts the safety
 *      roster and whoever claims it owns it.
 *
 * =============================================================================
 */

// =============================================================================
// SECTION 1 — CONFIG
// =============================================================================

var INC = {
  // "Incident Report Updated" — where driver submissions land.
  SHEET_ID:        '1eet9u2Bb9m_8Aj-TFymxAwouK2z-O1AmAwt5KajVu0w',

  // Breakdown workbook. Only used by spawnBreakdown_, which is disabled below
  // until the incident side is proven out.
  BREAKDOWN_SHEET_ID: '1ni51WDxpEeYSnf2f4UmtOAp1Dsvtv8uWHPVkvjCijLI',

  MASTER_SHEET_ID: '1zFDdVqpb51u7BPAE9RA6v7e-ew8fR-E4fHcTMWDNg-g',
  ERROR_LOG_ID:    '10amkhYmOGsrUL2PAl7XqId2i-G63gXdBNirWnR66tGc',

  DATA_TAB:       'IncidentsData',
  ROSTER_ROLE_TAB: 'Recruiting',      // driver roster — Division and ROLE columns
  ROSTER_TAB:     'Roster',

  // Drive folder (created in the deploying account's My Drive) holding incident
  // photos — one subfolder per incident. Created on first upload.
  PHOTO_ROOT_FOLDER: 'Incident Photos',

  // Roster groups. rosterForGroup_() compares as trimmed strings, so named
  // groups coexist with the numeric breakdown stages already in the sheet.
  GROUP_SAFETY_NOW: 'SAFETY-NOW',   // Riley + Mark — Tier 1 only
  GROUP_BREAKDOWN:  '1',            // existing Stage 1 breakdown roster

  TIMEZONE: 'America/Detroit',

  // Every submission emails a summary — all tiers, including Tier 3. Safety
  // uses it for analytics, and email does not wake anyone, so a deer strike
  // landing at 2am costs nothing and completes the record.
  //
  // OFF by default, and safety@norloworld.com is a live inbox — test traffic
  // must not land there. To turn it on, or off again in a hurry, set
  // SUMMARY_EMAIL_ENABLED to "true" in Project Settings → Script Properties.
  // No redeploy: it is read on every submission.
  //
  // While it is off, set SUMMARY_EMAIL_TEST to your own address and summaries
  // go there instead, so the format can be checked without anyone else seeing
  // it. Leave that property unset and nothing is sent at all.
  SUMMARY_EMAIL: 'safety@norloworld.com',

  // Leave true until Riley and Mark have signed off on the tier definitions.
  // Rows still land in the sheet; nobody's phone rings.
  DRY_RUN: true,

  // SMS lives in the Twilio Apps Script project. This file is standalone, so
  // blastForClaim_ does not exist here yet. Flip to true only after this file
  // has been moved into that project and the doPost dispatcher is in place.
  SMS_ENABLED: false,

  // Opening a matching breakdown row. Off until the incident side is proven.
  BREAKDOWN_SPAWN_ENABLED: false,

  // Kill switch, borrowed from the mechanics app. Set INCIDENT_APP_ENABLED to
  // anything other than "true" in Project Settings → Script Properties and the
  // form stops accepting submissions. No redeploy needed — takes effect on the
  // next request. Leave the property unset to keep the form running.
  RESPECT_KILL_SWITCH: true
};


// =============================================================================
// SECTION 2 — ROUTES
// =============================================================================

function doGet(e) {
  var route = e && e.parameter && e.parameter.route ? e.parameter.route : null;

  switch (route) {

    // Everything the driver-facing form needs to render.
    case 'getIncidentForm':
      return json_({
        drivers: getDrivers(),
        states:  getStates()
      });

    // Office-side queue for the dashboard.
    case 'getIncidents':
      return json_({ incidents: getIncidentsOpen() });

    default:
      return json_({ error: 'Endpoint not found', routeReceived: route });
  }
}


function doPost(request) {
  var parameter = request.parameter || {};
  var contents  = request.postData ? request.postData.contents : '{}';
  var route     = parameter.route;

  try {
    var res;
    switch (route) {

      case 'createIncident':
        res = createIncident(JSON.parse(contents));
        return json_(res);

      case 'acknowledgeIncident':
        res = acknowledgeIncident(JSON.parse(contents));
        return json_({ ok: !!res });

      case 'editIncident':
        res = editIncident(JSON.parse(contents));
        return json_({ ok: !!res });

      case 'savePhoto':
        res = savePhoto(JSON.parse(contents));
        return json_(res);

      default:
        return json_({ error: 'Endpoint not found' });
    }
  } catch (err) {
    logError_('doPost/' + route, err);
    return json_({ ok: false, error: String(err) });
  }
}


// =============================================================================
// SECTION 2b — PHOTO UPLOAD
// =============================================================================

/**
 * Saves one photo to Drive and returns its URL. The wizard calls this once per
 * photo (already downscaled) before it submits the incident, then sends the
 * returned URLs in the createIncident payload — so no image data ever touches
 * the sheet.
 *
 * Payload: { dataUrl | content, contentType?, slot, driverName, dateOfIncident,
 *            sessionId }
 */
function savePhoto(p) {
  try {
    if (!isIncidentAppEnabled_()) {
      return { ok: false, error: 'The incident form is temporarily offline.' };
    }

    // Accept a full data URL ("data:image/jpeg;base64,....") or a raw base64
    // string in `content` with `contentType` alongside it.
    var contentType = p.contentType || 'image/jpeg';
    var b64 = p.content || '';
    if (!b64 && p.dataUrl) {
      var comma = String(p.dataUrl).indexOf(',');
      b64 = comma > -1 ? p.dataUrl.slice(comma + 1) : p.dataUrl;
      var mt = /^data:([^;]+)/.exec(p.dataUrl);
      if (mt) contentType = mt[1];
    }
    if (!b64) return { ok: false, error: 'No image data' };

    var driver  = sanitizeName_(driverFullName_(p)) || 'Unknown';
    var dateStr = photoDateStr_(p.dateOfIncident);
    var ext     = contentType.indexOf('png') > -1 ? 'png' : 'jpg';
    var name    = photoFileName_(p.slot, dateStr, driver, ext);
    var blob    = Utilities.newBlob(Utilities.base64Decode(b64), contentType, name);

    // Resolve the folder under a short lock so two photos from the same
    // incident don't each create a duplicate subfolder. The actual upload (the
    // slow part) happens OUTSIDE the lock, so a driver's photos upload in
    // parallel instead of queuing behind each other.
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    var folder;
    try {
      folder = incidentPhotoFolder_(p.sessionId, dateStr, driver);
    } finally {
      lock.releaseLock();
    }
    var file = folder.createFile(blob);

    return { ok: true, url: file.getUrl(), name: name };
  } catch (err) {
    logError_('savePhoto', err);
    return { ok: false, error: String(err) };
  }
}

/**
 * Human-readable, sortable file names.
 *
 * The wizard sends its field key as the slot — "other-id", "other-property" —
 * which means nothing to anyone opening the folder cold. Six months from now
 * an adjuster or an attorney may be looking at these, and "other-id.jpg" does
 * not tell them it is a photo of the other driver's licence.
 *
 * The leading number is not decoration: Drive sorts by name, so numbering puts
 * the folder in the order the checklist asks for the shots — scene first, then
 * our equipment, then theirs, then documents.
 */
var PHOTO_SLOT_NAMES = {
  'scene':            '1-scene-wide-shot',
  'photoScene':       '1-scene-wide-shot',
  'our-truck':        '2-our-equipment-damage',
  'photoOurEquipment':'2-our-equipment-damage',
  'other-property':   '3-their-property-damage',
  'photoOtherProperty':'3-their-property-damage',
  'other-vehicle':    '4-their-vehicle-all-sides',
  'photoOtherVehicle':'4-their-vehicle-all-sides',
  'other-id':         '5-other-driver-license',
  'photoOtherId':     '5-other-driver-license',
  'other-insurance':  '6-other-driver-insurance',
  'photoOtherInsurance':'6-other-driver-insurance',
  'ticket':           '7-citation',
  'photoTicket':      '7-citation',
  'police-report':    '8-police-report-or-card',
  'photoPoliceReport':'8-police-report-or-card',
  'load-wide':        '9-freight-whole-load',
  'photoLoadWide':    '9-freight-whole-load',
  'load-damage':      '10-freight-damage-closeup',
  'photoLoadDamage':  '10-freight-damage-closeup'
};

function photoFileName_(slot, dateStr, driver, ext) {
  var key   = String(slot || '').trim();
  var label = PHOTO_SLOT_NAMES[key] || sanitizeName_(key || 'photo');
  return label + '_' + driver + '_' + dateStr + '.' + ext;
}

/**
 * Folder for one submission's photos, under "Incident Photos".
 *
 * Named by session ID at upload time because the case number does not exist yet
 * (the wizard uploads DURING the checklist; nextCaseNumber_ runs at submit).
 * incidentPhotoFolderFinal_ renames it to "CaseNumber - Driver" once the number
 * is assigned, so "PENDING …" is never seen in practice. Falls back to the old
 * date+driver name if no session ID arrives, so an older cached front end that
 * doesn't send one keeps working rather than throwing.
 */
function incidentPhotoFolder_(sessionId, dateStr, driver) {
  var parent = DriveApp.getRootFolder();
  var it = parent.getFoldersByName(INC.PHOTO_ROOT_FOLDER);
  var root;
  if (it.hasNext()) {
    root = it.next();
  } else {
    root = parent.createFolder(INC.PHOTO_ROOT_FOLDER);
    // Share ONCE, only when the root is first created, so team links open.
    // setSharing is a slow ACL write — never run it on every upload.
    try {
      root.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (ignored) {}
  }

  var name = sessionId
    ? 'PENDING ' + sessionId
    : dateStr + ' ' + driver;          // legacy fallback
  return getOrCreateFolder_(root, name);
}

function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Strip characters that are hostile in file names, collapse spaces to dashes. */
function sanitizeName_(s) {
  return String(s == null ? '' : s)
    .replace(/[\/\\:*?"<>|,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '-');
}

function photoDateStr_(d) {
  var dt = d ? new Date(d) : new Date();
  if (isNaN(dt.getTime())) dt = new Date();
  return Utilities.formatDate(dt, INC.TIMEZONE, 'yyyy-MM-dd');
}

/**
 * The submission's photo folder, renamed to the case number, and its URL.
 *
 * Only runs when at least one photo actually uploaded (so a photoless incident
 * never spawns an empty folder). Photos arrive in the payload as https Drive
 * URLs after the wizard's savePhoto calls. Re-resolves the same PENDING folder
 * by session ID, then renames it — a fast metadata write.
 */
function incidentPhotoFolderFinal_(p, caseNumber) {
  if (!allPhotoUrls_(p).length) return '';
  try {
    var driver  = sanitizeName_(driverFullName_(p)) || 'Unknown';
    var dateStr = photoDateStr_(p.dateOfIncident);
    var folder  = incidentPhotoFolder_(p.sessionId, dateStr, driver);

    // "08022601 - Steve-Stinky" — unique per incident, sorts by date because the
    // case number starts MMDDYY, and greppable by case number.
    folder.setName(caseNumber + ' - ' + driver);
    return folder.getUrl();
  } catch (err) {
    logError_('incidentPhotoFolderFinal_', err);
    return '';
  }
}

/** Collapse every "<field>Skipped" reason the driver gave into one cell. */
function collectSkips_(p) {
  var out = [];
  for (var k in p) {
    if (/Skipped$/.test(k) && String(p[k] || '').trim()) {
      out.push(k.replace(/Skipped$/, '') + ': ' + p[k]);
    }
  }
  return out.join('  |  ');
}

/**
 * Next case number: MMDDYY (this incident's date) + a running sequence that
 * counts incidents PER YEAR and continues across day and month changes, so the
 * last number of the year equals that year's incident count.
 *
 *   1st of 2026 on Jan 5   -> 01052601
 *   2nd, same day          -> 01052602
 *   3rd, on Feb 10         -> 02102603    (sequence continues; only the date changes)
 *   126th, on Dec 20       -> 122026126   (3 digits — see below)
 *   1st of 2027 on Jan 2   -> 01022701    (resets each new year)
 *
 * The sequence is a 2-digit minimum and grows on its own with no cap: 100 -> 3
 * digits, 1000 -> 4 digits. Sequencing takes the highest number already used
 * this year + 1 (so deleting a row never reuses one); the year is chars 5-6 of
 * each case number. Falls back to counting this year's rows by Timestamp if the
 * column doesn't exist yet. Call inside a lock — createIncident does.
 */
function nextCaseNumber_(sheet) {
  var tz      = INC.TIMEZONE;
  var now     = new Date();
  var prefix  = Utilities.formatDate(now, tz, 'MMddyy');   // this incident's date
  var yy      = Utilities.formatDate(now, tz, 'yy');        // current two-digit year
  var yyyy    = Utilities.formatDate(now, tz, 'yyyy');
  var lastRow = sheet.getLastRow();
  var maxSeq  = 0;

  if (lastRow >= 2) {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var caseCol = 0;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).trim().toLowerCase() === 'case number') { caseCol = h + 1; break; }
    }

    if (caseCol) {
      var nums = sheet.getRange(2, caseCol, lastRow - 1, 1).getValues();
      for (var i = 0; i < nums.length; i++) {
        // A leading zero may have been stripped by number formatting on an
        // older row. Pad it back so the year check below still lines up.
        var cn = String(nums[i][0] || '');
        if (cn.length === 7) cn = '0' + cn;
        // MMDDYY + sequence; the year is chars 5-6 (index 4-5).
        if (cn.length >= 8 && cn.substring(4, 6) === yy) {
          var seq = parseInt(cn.substring(6), 10);
          if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
        }
      }
    } else {
      // No Case Number column yet — count this year's rows by Timestamp.
      var stamps = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
      for (var j = 0; j < stamps.length; j++) {
        var d = stamps[j][0];
        if (d && d.getTime && Utilities.formatDate(new Date(d), tz, 'yyyy') === yyyy) maxSeq++;
      }
    }
  }

  var next = maxSeq + 1;
  return prefix + (next < 10 ? '0' + next : String(next));   // 2-digit min, auto-expands
}


// =============================================================================
// SECTION 3 — SEVERITY
// =============================================================================

/**
 * The whole point of the project lives in this function.
 *
 * Returns { tier: 1|2|3, reasons: [], lane: 'SAFETY'|'BREAKDOWN'|'BOTH' }
 *
 * Read the ordering carefully: Tier 1 conditions are checked first and any
 * single one is sufficient. Then the fail-upward guard. Only after both of
 * those does anything get to be Tier 2 or 3.
 */
function computeSeverity_(p) {
  var reasons = [];

  // ---- TIER 1 ---------------------------------------------------------------
  // No judgment required on any of these. Somebody gets woken up.

  if (yes_(p.fatality))              reasons.push('Fatality');
  if (yes_(p.anyoneInjured))         reasons.push('Injury reported');
  if (yes_(p.medicalAwayFromScene))  reasons.push('Medical treatment away from scene');
  // Another vehicle on a public road is a call, whether or not anyone is
  // standing there. Michigan is a no-fault state in every instance EXCEPT a
  // legally parked vehicle — that is the one collision where fault genuinely
  // gets argued, so it is the one worth reaching the other party about before
  // a police report exists. Mark's rule, and the reason for it.
  if (yes_(p.otherVehicleInvolved)) {
    reasons.push('Another vehicle on a public road — reach the other party before police are involved');
  }

  // For everything that is NOT another vehicle — a fence, a building, a dock —
  // presence still decides. Someone standing there can be talked to now; a
  // dented fence is exactly as dented in the morning.
  else if (otherPartyPresent_(p)) {
    reasons.push('Other party still on scene — settle it before police are involved');
  }
  if (yes_(p.rollover))              reasons.push('Rollover or jackknife');

  if (yes_(p.hazmatOrFuelSpill))     reasons.push('Fuel, oil, or hazmat spill');

  // Police attending a parking-lot scrape is not by itself a wakeup. Police
  // attending something with another party in it is.
  // Police alone was never the trigger, and with presence now carrying that
  // weight it is not one at all. An officer taking a deer report is paperwork.


  // 49 CFR 382.303. A citation on its own is a morning problem. A citation
  // combined with a tow-away or an injury starts a testing clock: alcohol is
  // abandoned at 8 hours, controlled substances at 32. This cannot wait for
  // the morning queue, which is exactly why it is checked as a COMBINATION
  // and not as a property of the citation field alone.
  if (citationLikely_(p) && (yes_(p.towRequired) || yes_(p.medicalAwayFromScene))) {
    reasons.push('Citation or expected citation with tow or injury — DOT post-accident testing clock started');
  }

  if (reasons.length) {
    return { tier: 1, reasons: reasons, lane: laneFor_(p, 1) };
  }

  // ---- FAIL UPWARD ----------------------------------------------------------
  // A gate the driver skipped, closed the form on, or answered "unsure" is
  // not evidence of absence. Escalate rather than assume.

  var gates = [
    'anyoneInjured', 'medicalAwayFromScene',
    'otherVehicleInvolved', 'otherPartyInvolved',
    'rollover', 'hazmatOrFuelSpill',
    'truckDrivable', 'towRequired', 'vehicleStuck'
  ];
  // pedestrianInvolved and driverRequestsContact were removed from the form.
  // Leaving either in this list would mark every submission as having an
  // unanswered gate and escalate all of them to Tier 1 — the exact failure
  // this project exists to prevent. anyoneInjured now covers both parties
  // ("Northern employee or any other party") and is Yes/No: safety wants a
  // decision, not an Unknown that drivers use to move on.
  // policeOnScene and citationIssued are deliberately NOT in that list. Both
  // now have an "Unknown" option that is a legitimate answer rather than a
  // skipped question, and citationIssued is asked at the END of the form — a
  // driver who abandons before reaching it would otherwise escalate every time.
  // otherPartyPresent is only asked when another party is involved, so it is
  // checked separately below rather than as a blanket gate.
  var missing = [];
  for (var i = 0; i < gates.length; i++) {
    var v = p[gates[i]];
    if (v === undefined || v === null || String(v).trim() === '' ||
        ['unsure','unknown','n/a'].indexOf(String(v).trim().toLowerCase()) > -1) {
      missing.push(gates[i]);
    }
  }
  // Asked only when another party is involved — but when it was asked and not
  // answered, we cannot tell whether anyone is standing there, and that is the
  // difference between a call and a morning text.
  if (yes_(p.otherPartyInvolved)) {
    var pres = String(p.otherPartyPresent || '').trim().toLowerCase();
    if (!pres || pres === 'unknown') missing.push('otherPartyPresent');
  }

  if (missing.length) {
    return {
      tier: 1,
      reasons: ['Escalated — unanswered or uncertain gate: ' + missing.join(', ')],
      lane: laneFor_(p, 1)
    };
  }

  // ---- TIER 2 ---------------------------------------------------------------
  // Real, but it keeps until someone is awake and looking.

  if (citationLikely_(p))          reasons.push('Citation issued, no tow or injury');
  // Safety is told, but this is breakdown's problem. There is nobody for safety
  // to de-escalate with and nothing they can do at the roadside that breakdown
  // is not already doing — they want it for the record and the analytics.
  if (no_(p.truckDrivable))        reasons.push('Truck not drivable — breakdown dispatched');
  if (isStuck_(p)) {
    var where = String(p.vehicleStuck || '').replace(/^Yes\s*[—-]\s*/i, '');
    reasons.push('Stuck' + (where && where.toLowerCase() !== 'yes' ? ' — ' + where : '') +
                 ' — breakdown dispatched, safety notified');
  }
  // Someone else's vehicle or property, and nobody there to talk to. Mark's
  // case: the driver documents it, safety picks it up in the morning, and the
  // damaged fence is exactly as damaged then as it is now. Real, not urgent —
  // which is Tier 2, not a silent Tier 3 log nobody is asked to acknowledge.
  // Property only — another vehicle never reaches here, it is Tier 1 above.
  if (yes_(p.otherPartyInvolved) && !otherPartyPresent_(p)) {
    reasons.push('Someone else\'s property, nobody there to speak to');
  }
  if (yes_(p.freightDamaged))      reasons.push('Freight damaged');
  if (yes_(p.towRequired))         reasons.push('Tow required');
  if (yes_(p.customerPropertyHit)) reasons.push('Damage at a customer facility');
  if ((p.otherNaCount || 0) > 2)   reasons.push('Multiple checklist items marked N/A');

  if (reasons.length) {
    return { tier: 2, reasons: reasons, lane: laneFor_(p, 2) };
  }

  // ---- TIER 3 ---------------------------------------------------------------
  return {
    tier: 3,
    reasons: ['No escalation gates tripped'],
    lane: laneFor_(p, 3)
  };
}


/**
 * Which team owns this. Independent of tier — a Tier 3 "stuck in a ditch, no
 * damage" is a breakdown job at 2am regardless of how calm safety's night is.
 */
function laneFor_(p, tier) {
  // The old `propertyDamage` boolean is gone — "someone else's property" is now
  // an incident-type label. Match on text so label wording can drift.
  var typesText = (p.incidentTypes || []).join(' ').toLowerCase();
  var hitTheirs = typesText.indexOf('someone else') > -1;

  // Breakdown owns maintenance as well as roadside, so it is one queue: a
  // stranded truck and a cracked mirror both end up with the same department.
  // Any damage to our equipment goes to them, whether or not it stopped the
  // truck — damage nobody logs is damage that gets deferred, and deferred
  // damage is what an inspector finds.
  var damagedOurs = typesText.indexOf('our truck') > -1 ||
                    typesText.indexOf('our equipment') > -1 ||
                    String(p.ourDamageWhat || '').trim() !== '' ||
                    photoCell_(p.photoOurEquipment).indexOf('http') === 0;

  var needsBreakdown = damagedOurs ||
                       no_(p.truckDrivable) ||
                       yes_(p.towRequired) ||
                       isStuck_(p);

  var needsSafety    = tier === 1 || yes_(p.otherPartyInvolved) ||
                       yes_(p.citationIssued) || yes_(p.anyoneInjured) ||
                       hitTheirs;

  if (needsBreakdown && needsSafety) return 'BOTH';
  if (needsBreakdown)                return 'BREAKDOWN';
  return 'SAFETY';
}


// =============================================================================
// SECTION 4 — CREATE
// =============================================================================

function createIncident(p) {
  try {
    if (!isIncidentAppEnabled_()) {
      return { ok: false, error: 'The incident form is temporarily offline. Call the driver line.' };
    }
    var sev   = computeSeverity_(p);
    var sheet = tab_(INC.SHEET_ID, INC.DATA_TAB);
    // Resolved outside the lock — it reads a different spreadsheet and there is
    // no reason to hold up another driver's submission for it.
    var driverRole = lookupDriverRole_(p);
    var id    = 'INC-' + Utilities.formatDate(new Date(), INC.TIMEZONE, 'yyyyMMdd-HHmmss');

    // Case number + append run under a lock so two submissions at the same
    // moment get distinct sequential numbers.
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    var caseNumber, rowNum, photoFolderUrl;
    var duplicate = false;
    try {
    // Inside the lock on purpose: two taps a fraction apart would otherwise
    // both pass the check and both write a row.
    var already = existingCaseForSession_(sheet, p.sessionId);
    if (already) {
      duplicate  = true;
      caseNumber = already;
    } else {
    caseNumber = nextCaseNumber_(sheet);
    // One folder link opens every photo for this incident (up to ten). The
    // upload folder was named by session ID because the case number did not
    // exist yet; now that it does, rename it. Only when a photo came back.
    photoFolderUrl = incidentPhotoFolderFinal_(p, caseNumber);
    // Column order matches the IncidentsData header row: human-readable up
    // front (A–T), photos + plumbing at the back. Photo URLs are written inline
    // here because the wizard uploads them during the checklist and sends the
    // URLs in this payload (there is no separate savePhotoUrls step).
    sheet.appendRow(rowSafe_([
      caseNumber,                                         // A  Case Number
      new Date(),                                         // B  Timestamp
      driverFullName_(p),                                 // C  Driver
      pick_(p, 'driverPhone', 'driverContact', 'phone'),  // D  Driver Phone
      pick_(p, 'truck', 'truckNumber'),                   // E  Truck
      pick_(p, 'trailer', 'trailerNumber'),               // F  Trailer
      typeList_(p),                                       // G  Type
      pick_(p, 'locationName', 'siteName', 'location', 'streetAddress'), // H  Location
      pick_(p, 'city'),                                   // I  City
      pick_(p, 'state'),                                  // J  State
      pick_(p, 'description', 'otherExplain', 'notes'),   // K  Description
      sev.tier,                                           // L  Tier
      sev.reasons.join(' | '),                            // M  Tier Reasons
      sev.lane,                                           // N  Lane
      'New',                                              // O  Status
      '',                                                 // P  Claimed By
      '',                                                 // Q  Claimed At
      pick_(p, 'notApplicable'),                          // R  Not applicable
      pick_(p, 'answeredNo'),                             // S  Answered no
      photoCell_(p.photoScene),                           // T  Photo — Scene
      photoCell_(p.photoOurEquipment),                    // U  Photo — Our Truck
      photoCell_(p.photoOtherProperty),                   // V  Photo — Other
      photoFolderUrl,                                     // W  Photos — Folder
      '',                                                 // X  Office Notes
      pick_(p, 'breakdownId'),                            // Y  Breakdown ID
      id,                                                 // Z  Incident ID
      JSON.stringify(p)                                   // AA Payload (hidden)
    ]));
    rowNum = sheet.getLastRow();
    }
    // Force the case number to stay text. Sheets otherwise reads 08042601 as a
    // number and drops the leading zero — which breaks the dashboard's monthly
    // counts AND changes the number Riley quotes to an insurer.
    if (!duplicate) {
      sheet.getRange(rowNum, 1).setNumberFormat('@').setValue(caseNumber);
      // Written by header so they land wherever the columns sit. Add
      // "Home Terminal" and "Driver Role" to IncidentsData; without them this
      // logs once and carries on.
      setByHeader_(sheet, rowNum, 'Home Terminal', pick_(p, 'homeTerminal'));
      setByHeader_(sheet, rowNum, 'Driver Role',   driverRole);
    }
    } finally {
      lock.releaseLock();
    }

    // Only Tier 1 makes a phone buzz. This single condition is the difference
    // between the current situation and the one you asked for.
    // A duplicate is already recorded and already paged. Hand back the original
    // case number and stop — re-paging safety for the same incident is the
    // exact behaviour this project exists to prevent.
    if (duplicate) {
      return {
        ok: true, duplicate: true, caseNumber: caseNumber,
        tier: sev.tier, reasons: sev.reasons, lane: sev.lane,
        notify: { sent: false, reason: 'Already submitted' }
      };
    }

    // Sent for every tier. Deliberately after the row is written and outside
    // the lock — a mail failure must never cost the incident record.
    emailSummary_(p, sev, caseNumber, photoFolderUrl, rowNum);

    var notify = { sent: false, reason: 'Tier ' + sev.tier + ' — queued, no SMS' };
    if (sev.tier === 1) {
      notify = notifyTier1_(rowNum, id, p, sev, caseNumber, photoFolderUrl);
    }

    // A disabled truck is a breakdown job whatever the tier says.
    var spawned = null;
    if (INC.BREAKDOWN_SPAWN_ENABLED &&
        (sev.lane === 'BREAKDOWN' || sev.lane === 'BOTH')) {
      spawned = spawnBreakdown_(caseNumber, p, sev);
    }

    return {
      ok: true,
      incidentId: id,
      caseNumber: caseNumber,
      tier: sev.tier,
      reasons: sev.reasons,
      lane: sev.lane,
      driverRole: driverRole,
      flatbed: isFlatbed_(driverRole),
      notify: notify,
      breakdownSpawned: spawned
    };

  } catch (err) {
    logError_('createIncident', err);
    return { ok: false, error: String(err) };
  }
}


/**
 * Hands the incident to the safety roster via the existing CLAIM mechanism in
 * norlo-twilio-sms.gs. First person to text the token back owns it; the other
 * is told who took it. Nothing here picks a person.
 *
 * REQUIRES the one-line change to blastForClaim_ so the group is an argument
 * rather than CFG.CLAIM_GROUP. See the note at the bottom of this file.
 */
/**
 * Emails a readable summary of every submission to safety.
 *
 * Not a notification — the texts do that. This is the record: one email per
 * incident, searchable by case number, driver or truck, and complete enough
 * that safety can answer a question months later without opening the sheet.
 *
 * Every answer the driver gave is included, not a selection. The point is
 * analytics, and a summary that leaves things out is one somebody has to go
 * looking past.
 */
function emailSummary_(p, sev, caseNumber, photoFolderUrl, rowNum) {
  var to = summaryRecipient_();
  if (!to) {
    Logger.log('[SUMMARY OFF] %s would have emailed a summary', caseNumber);
    return;
  }
  try {
    var driver = driverFullName_(p) || 'Unknown driver';
    var tierWord = sev.tier === 1 ? 'TIER 1 — call'
                 : sev.tier === 2 ? 'Tier 2 — text'
                 : 'Tier 3 — logged';

    var where = [pick_(p, 'siteName'), pick_(p, 'streetAddress'), p.city, p.state]
                  .filter(function (x) { return String(x || '').trim(); }).join(', ');

    function row(k, v) {
      if (v === null || v === undefined || String(v).trim() === '') return '';
      return '<tr><td style="padding:4px 10px;border-bottom:1px solid #e3e6e3;' +
             'color:#5a6b5e;width:230px;vertical-align:top;font-size:12px;">' +
             esc_(k) + '</td><td style="padding:4px 10px;border-bottom:1px solid #e3e6e3;' +
             'font-size:12px;">' + esc_(String(v)) + '</td></tr>';
    }

    // Everything the driver answered, minus plumbing and photo URLs. Prettified
    // keys rather than a curated list, so a question added to the form next
    // month appears here without anyone remembering to update this.
    var skip = ['sessionId','submittedAt','incidentTypes','notApplicable','answeredNo',
                'otherNaCount','driverFirstName','driverLastName','driverName'];
    var answers = '';
    Object.keys(p).forEach(function (k) {
      if (skip.indexOf(k) > -1) return;
      if (k.charAt(0) === '_') return;
      if (k.indexOf('photo') === 0) return;
      var v = p[k];
      if (Array.isArray(v)) return;
      if (v === null || v === undefined || String(v).trim() === '') return;
      var label = k.replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); });
      answers += row(label, v);
    });

    var photoCount = allPhotoUrls_(p).length;

    var html =
      '<div style="font-family:Arial,Helvetica,sans-serif;color:#14231a;max-width:720px;">' +
      '<div style="background:#1e5631;color:#fff;padding:14px 18px;">' +
        '<div style="font-size:20px;font-weight:700;font-family:monospace;">' + esc_(caseNumber) + '</div>' +
        '<div style="font-size:12px;color:#a9c4b3;">' + esc_(driver) + ' · Truck ' +
          esc_(pick_(p, 'truck', 'truckNumber') || '?') + ' · ' + esc_(tierWord) + '</div>' +
      '</div>' +

      '<div style="padding:12px 18px;background:' +
        (sev.tier === 1 ? '#fbeeea' : sev.tier === 2 ? '#fdf5e6' : '#f1f3f1') + ';">' +
        '<b style="font-size:12px;">Why this tier:</b> ' +
        '<span style="font-size:12px;">' + esc_(sev.reasons.join(' · ')) + '</span>' +
      '</div>' +

      '<table style="border-collapse:collapse;width:100%;margin-top:14px;">' +
        row('Type', typeList_(p)) +
        row('When', pick_(p, 'dateOfIncident') + ' ' + pick_(p, 'timeOfIncident')) +
        row('Where', where) +
        row('Driver phone', pick_(p, 'driverPhone', 'driverContact')) +
        row('Trailer', pick_(p, 'trailer', 'trailerNumber')) +
        row('Home terminal', pick_(p, 'homeTerminal')) +
        row('Role', lookupDriverRole_(p)) +
        row('Lane', sev.lane) +
        row('Description', pick_(p, 'description')) +
      '</table>' +

      (answers ?
        '<div style="margin-top:16px;padding:6px 10px;background:#e8efe9;font-size:11px;' +
        'font-weight:700;letter-spacing:1px;color:#1e5631;">EVERYTHING THE DRIVER ANSWERED</div>' +
        '<table style="border-collapse:collapse;width:100%;">' + answers + '</table>' : '') +

      (pick_(p, 'notApplicable') ?
        '<div style="margin-top:14px;padding:10px;background:#fdf5e6;font-size:12px;">' +
        '<b>Marked N/A:</b><br>' + esc_(String(p.notApplicable)).replace(/\n/g, '<br>') + '</div>' : '') +

      '<div style="margin-top:16px;padding:10px 0;font-size:12px;color:#5a6b5e;">' +
        photoCount + ' photo' + (photoCount === 1 ? '' : 's') +
        (photoFolderUrl ? ' · <a href="' + esc_(photoFolderUrl) + '">open the folder</a>' : '') +
      '</div>' +

      '<div style="margin-top:8px;font-size:11px;color:#8a938c;">' +
        'Submitted from the driver tablet. Row ' + rowNum + ' of IncidentsData.' +
      '</div></div>';

    MailApp.sendEmail({
      to: to,
      subject: (to === INC.SUMMARY_EMAIL ? '' : '[TEST] ') +
               'Incident ' + caseNumber + ' — ' + driver + ' — ' + tierWord,
      htmlBody: html
    });

  } catch (err) {
    // Never let a mail problem affect the submission. The row is already saved.
    logError_('emailSummary_', err);
  }
}

/**
 * Who gets the summary, or '' for nobody.
 *
 * Read from Script Properties rather than config so it can be turned off from a
 * phone in the middle of the night without a redeploy — the same reasoning as
 * the kill switch on the form itself.
 *
 *   SUMMARY_EMAIL_ENABLED = "true"   →  safety@norloworld.com
 *   SUMMARY_EMAIL_TEST    = an address → that address, subject prefixed [TEST]
 *   neither set                       →  nothing is sent, and the log says so
 *
 * Off is the default on purpose. safety@ is a live inbox and test traffic in it
 * is worse than no summary at all.
 */
function summaryRecipient_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SUMMARY_EMAIL_ENABLED') === 'true') return INC.SUMMARY_EMAIL;
  var test = String(props.getProperty('SUMMARY_EMAIL_TEST') || '').trim();
  return test || '';
}


function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


function notifyTier1_(rowNum, id, p, sev, caseNumber, photoFolderUrl) {
  if (!INC.SMS_ENABLED) {
    Logger.log('[SMS OFF] Tier 1 %s — %s', caseNumber, sev.reasons.join(' | '));
    return { sent: false, reason: 'SMS not wired up yet' };
  }

  if (INC.DRY_RUN) {
    Logger.log('[DRY_RUN] Tier 1 %s would blast %s: %s',
               caseNumber, INC.GROUP_SAFETY_NOW, sev.reasons.join(' | '));
    return { sent: false, reason: 'DRY_RUN' };
  }

  // This text lands AFTER the driver has finished the form. He was already
  // told to call from the scene, so somebody has probably spoken to him
  // already — the point of this message is that the report now exists, with
  // the case number, the photos, and the reasons the phone call could not
  // carry. It also closes the loop: no text means no report, which is itself
  // worth someone noticing.
  var body = [
    'INCIDENT ' + caseNumber + ' — report submitted',
    (driverFullName_(p) || 'Unknown driver') + '  ' + (p.driverPhone || ''),
    'Truck ' + (p.truck || '?') + '  Trailer ' + (p.trailer || '?'),
    (pick_(p, 'siteName', 'streetAddress') || '') + ' ' + (p.city || '') + ' ' + (p.state || ''),
    sev.reasons.join('; '),
    photoFolderUrl ? 'Photos: ' + photoFolderUrl : ''
  ].filter(function (l) { return String(l).trim(); }).join('\n');

  try {
    // blastForClaim_ mints the token, texts the roster, and opens the Claim Log
    // row. Passing the group explicitly is the only modification needed.
    return blastForClaim_(rowNum, { _incidentBody: body }, INC.GROUP_SAFETY_NOW);
  } catch (err) {
    logError_('notifyTier1_', err);
    // A failed page must be loud. Fall back to email rather than fail silently.
    MailApp.sendEmail({
      to: 'breakdown@norloworld.com',
      subject: 'INCIDENT ' + caseNumber + ' — report submitted, SMS FAILED',
      body: body + '\n\nSMS dispatch threw: ' + err
    });
    return { sent: false, reason: 'SMS failed, email fallback sent' };
  }
}


/** Opens a matching row on BreakdownsData so the breakdown team sees it too. */
/** First uploaded photo URL, for the File Attachment column. */
function photoFolderUrlFor_(p) {
  for (var k in p) {
    if (k.indexOf('photo') === 0) {
      var v = Array.isArray(p[k]) ? p[k][0] : p[k];
      if (/^https?:/i.test(String(v || ''))) return String(v);
    }
  }
  return '';
}

function spawnBreakdown_(caseNumber, p, sev) {
  try {
    var sheet = tab_(INC.BREAKDOWN_SHEET_ID, 'BreakdownsData');

    // Column positions matter here, and they are not ours to choose. Headers
    // occupy rows 1-2 of BreakdownsData and data starts at row 3, which is why
    // stages() reads getRange(3, 1, ...) — so data[0] is the first real row and
    // these indices line up directly:
    //
    //   0 TimeStamp        4 Trailer #    8 Description
    //   1 BreakDown Date   5 State        9 File Attachment
    //   2 Driver Name      6 City        10 Assigned To
    //   3 Truck #          7 Repair Type
    //
    // Stage 1 fires only when columns 0-6 AND column 10 are all non-empty:
    //
    //   isValidStage1 = row[0] && row[1] && row[2] && row[3] && row[4]
    //                && row[5] && row[6] && row[10] && row[21] !== true
    //
    // Leave any of those blank and the row lands in the sheet and never
    // notifies anyone — which is worse than not writing it, because it looks
    // like it worked. Column 10 ("Assigned To") is the one most easily missed.
    var tz   = INC.TIMEZONE;
    var now  = new Date();
    var why  = isStuck_(p) ? 'Stuck — ' + String(p.vehicleStuck).replace(/^Yes\s*[—-]\s*/i, '')
             : no_(p.truckDrivable) ? 'Truck not drivable'
             : yes_(p.towRequired)  ? 'Tow required'
             : 'Equipment damage';

    var row = [];
    row[0]  = Utilities.formatDate(now, tz, 'M/d/yyyy H:mm:ss');   // Timestamp
    row[1]  = Utilities.formatDate(now, tz, 'M/d/yyyy');           // Breakdown Date
    row[2]  = driverFullName_(p);                                  // Driver Name
    row[3]  = pick_(p, 'truck', 'truckNumber')     || 'Unknown';   // Truck
    row[4]  = pick_(p, 'trailer', 'trailerNumber') || 'None';      // Trailer
    row[5]  = pick_(p, 'state')                    || 'Unknown';   // State
    row[6]  = pick_(p, 'city')                     || 'Unknown';   // City
    row[7]  = why;                                                 // Repair Type
    row[8]  = 'From incident ' + caseNumber + ' — ' +               // Description
              (pick_(p, 'description') || '') +
              (pick_(p, 'stuckWhere') ? ' — ' + p.stuckWhere : '');
    row[9]  = photoFolderUrlFor_(p);                               // File Attachment
    // "Assigned To (same as driver name)" — the driver's own name, matching how
    // the breakdown form fills it. stages() also uses it to look up the driver's
    // phone, so anything else here breaks the contact line in the text.
    row[10] = driverFullName_(p);                                  // Assigned To — REQUIRED

    // appendRow needs a dense array; a sparse one writes undefined cells.
    for (var i = 0; i < 11; i++) if (row[i] === undefined) row[i] = '';

    sheet.appendRow(row);
    return { ok: true, row: sheet.getLastRow(), reason: why };

  } catch (err) {
    logError_('spawnBreakdown_', err);
    return { ok: false, error: String(err) };
  }
}


// =============================================================================
// SECTION 5 — OFFICE SIDE
// =============================================================================

/** Riley or Mark marking a queued incident as handled, from the dashboard. */
function acknowledgeIncident(p) {
  try {
    var sheet = tab_(INC.SHEET_ID, INC.DATA_TAB);
    var row   = parseInt(p.rowIndex, 10);
    if (!row || isNaN(row)) return false;

    setByHeader_(sheet, row, 'Status',     p.state || 'Reviewed');
    setByHeader_(sheet, row, 'Claimed By', p.by || '');
    setByHeader_(sheet, row, 'Claimed At', new Date());
    return true;
  } catch (err) {
    logError_('acknowledgeIncident', err);
    return false;
  }
}


function editIncident(p) {
  try {
    var sheet = tab_(INC.SHEET_ID, INC.DATA_TAB);
    var row   = parseInt(p.rowIndex, 10);
    if (!row || isNaN(row)) return false;

    if (p.description)  setByHeader_(sheet, row, 'Description',  p.description);
    if (p.officeNotes)  setByHeader_(sheet, row, 'Office Notes', p.officeNotes);
    return true;
  } catch (err) {
    logError_('editIncident', err);
    return false;
  }
}


/** Everything not yet closed — this is the morning queue. */
function getIncidentsOpen() {
  var sheet = tab_(INC.SHEET_ID, INC.DATA_TAB);
  var last  = sheet.getLastRow();
  if (last < 2) return [];

  var data = sheet.getRange(1, 1, last, sheet.getLastColumn()).getValues();
  var all  = convert2DArrayToObjects(data);

  all.forEach(function (r, i) { r.rowIndex = i + 2; });

  return all.filter(function (r) {
    var s = String(r['Status'] == null ? '' : r['Status']).trim().toLowerCase();
    return s !== 'closed';
  });
}


// =============================================================================
// SECTION 7 — HELPERS
// =============================================================================

/**
 * Returns the first of several possible keys that has a value.
 *
 * The front end and this file were written separately, so the same field has
 * two names in places — truck vs truckNumber, driverPhone vs driverContact.
 * Rather than force one side to rename (and break the other), accept both.
 * New aliases can be added here without touching the schema.
 */
function pick_(obj) {
  for (var i = 1; i < arguments.length; i++) {
    var v = obj[arguments[i]];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

/**
 * The driver's role, from the roster, falling back to what he told us.
 *
 * The roster is the source of truth for whether someone is a flatbed driver —
 * which decides whether Matt picks the incident up. But it is a recruiting
 * sheet: anyone hired before it existed is not in it, and the values are typed
 * by hand, so "DV - OTR", "DV- OTR" and "DV-OTR" all occur.
 *
 * So: normalise hard, match on the prefix, and if the driver is not found use
 * the answer he gave. A blank role would silently route a flatbed incident to
 * the wrong person, which is worse than trusting the driver.
 */
function lookupDriverRole_(p) {
  var told = String(p.driverRole || '').trim();
  try {
    var sheet = tab_(INC.MASTER_SHEET_ID, INC.ROSTER_ROLE_TAB);
    var last  = sheet.getLastRow();
    if (last < 2) return told;

    var data  = sheet.getRange(1, 1, last, sheet.getLastColumn()).getValues();
    var head  = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var iF = head.indexOf('first name');
    var iL = head.indexOf('last name');
    var iR = head.indexOf('role');
    if (iF < 0 || iL < 0 || iR < 0) return told;

    var wantF = String(p.driverFirstName || '').trim().toLowerCase();
    var wantL = String(p.driverLastName  || '').trim().toLowerCase();
    if (!wantF || !wantL) return told;

    for (var r = 1; r < data.length; r++) {
      if (String(data[r][iF]).trim().toLowerCase() !== wantF) continue;
      if (String(data[r][iL]).trim().toLowerCase() !== wantL) continue;
      var found = String(data[r][iR] || '').trim();
      if (found) return found;
    }
  } catch (err) {
    logError_('lookupDriverRole_', err);
  }
  return told;
}

/**
 * Flatbed or not — the one distinction that changes who handles the incident.
 *
 * Tolerates every spelling in the roster: "FLAT - OTR", "FLAT- OTR",
 * "Flatbed — Local". Anything whose collapsed form starts with FLAT counts.
 */
function isFlatbed_(role) {
  var r = String(role || '').toUpperCase().replace(/[^A-Z]/g, '');
  return r.indexOf('FLAT') === 0;
}

/**
 * Make a row safe to write.
 *
 * appendRow with an array inside it writes the Java array's identity —
 * "[Ljava.lang.Object;@10bc812f" — into the cell, silently, and the real
 * values are gone from that column. It happened once when the form started
 * sending several photos before the backend knew how to join them.
 *
 * Rather than trusting every future field to be a string, flatten anything
 * array-shaped on the way out. One line, and that whole class of bug stops
 * being possible.
 */
function rowSafe_(row) {
  return row.map(function (v) {
    if (Array.isArray(v)) {
      return v.filter(function (x) { return x !== null && x !== undefined && String(x).trim(); })
              .join('\n');
    }
    return v;
  });
}

/**
 * A photo answer, which may now be several photos.
 *
 * One shot was never enough for the ones that matter: "close-ups of damage to
 * Northern equipment" when three things are bent, or "their vehicle — all four
 * sides", which literally asks for four. The wizard sends an array; older
 * clients still send a single string.
 *
 * Newline-separated in the cell so each URL stays clickable in Sheets.
 */
function photoCell_(v) {
  if (Array.isArray(v)) {
    return v.filter(function (u) { return u && String(u).trim(); }).join('\n');
  }
  return v == null ? '' : String(v);
}

/** Every photo URL in the payload, flattened — arrays or single strings. */
function allPhotoUrls_(p) {
  var out = [];
  for (var k in p) {
    if (k.indexOf('photo') !== 0) continue;
    var v = p[k];
    var arr = Array.isArray(v) ? v : [v];
    for (var i = 0; i < arr.length; i++) {
      if (/^https?:/i.test(String(arr[i] || ''))) out.push(String(arr[i]));
    }
  }
  return out;
}

/**
 * Has this submission already been recorded?
 *
 * A driver double-taps Submit, or the network stalls and the form retries, or
 * he refreshes and resubmits a draft that should have been cleared. Any of
 * those produces two identical incidents with two case numbers — and Riley
 * calling the same driver twice about the same deer.
 *
 * The wizard mints one sessionId per submission and it rides in the payload,
 * so an exact repeat is detectable. Returns the existing case number if found.
 *
 * Scans recent rows rather than the whole sheet: a duplicate arrives seconds
 * after the original, never a year later.
 */
function existingCaseForSession_(sheet, sessionId) {
  if (!sessionId) return '';
  var last = sheet.getLastRow();
  if (last < 2) return '';

  var payCol  = colFor_(sheet, 'Payload');
  var caseCol = colFor_(sheet, 'Case Number');
  if (payCol < 0 || caseCol < 0) return '';

  var from = Math.max(2, last - 50);
  var n    = last - from + 1;
  var pays  = sheet.getRange(from, payCol,  n, 1).getValues();
  var cases = sheet.getRange(from, caseCol, n, 1).getValues();

  var needle = '"sessionId":"' + sessionId + '"';
  for (var i = pays.length - 1; i >= 0; i--) {
    if (String(pays[i][0]).indexOf(needle) > -1) return String(cases[i][0]);
  }
  return '';
}

/**
 * "Last, First" for the Driver column.
 *
 * The form now asks for first and last name separately — one combined field
 * left drivers guessing which order to type, and the sheet ended up with both.
 * Writing "Last, First" means the Driver column sorts by surname, which one
 * free-text field never allowed.
 *
 * Falls back to the old single driverName for rows submitted before the split,
 * so existing records keep rendering in the dashboard.
 */
function driverFullName_(p) {
  var first = String(p.driverFirstName || '').trim();
  var last  = String(p.driverLastName  || '').trim();
  if (first && last) return last + ', ' + first;
  return pick_(p, 'driverName', 'driver', 'driverLastName', 'driverFirstName');
}

/** Incident types arrive as an array from the checkboxes; flatten for the cell. */
function typeList_(p) {
  var t = p.incidentTypes || p.incidentType || p.types;
  if (Array.isArray(t)) return t.join(', ');
  return t ? String(t) : '';
}

/**
 * The other party still standing there — the Tier 1 trigger.
 *
 * Not "another vehicle involved". Mark's rule: a call is worth making when
 * safety can still change the outcome, and that only holds while there is
 * someone to talk to. Once they have driven off the damage keeps until morning.
 */
function otherPartyPresent_(p) {
  return String(p.otherPartyPresent || '').toLowerCase().indexOf('yes') === 0;
}

/**
 * A citation, issued or promised.
 *
 * "Officer said one is coming" counts. The alternative is a driver honestly
 * answering No and the DOT testing window closing — alcohol at 8 hours,
 * controlled substances at 32 — before anyone knows a citation was on its way.
 */
function citationLikely_(p) {
  var c = String(p.citationIssued || '').toLowerCase();
  return c.indexOf('yes') === 0 || c.indexOf('coming') > -1;
}

/** Police here, or on their way. Both mean a report is likely. */
function policeInvolved_(p) {
  var v = String(p.policeOnScene || '').toLowerCase();
  return v.indexOf('yes') === 0 || v.indexOf('not here yet') > -1;
}

/**
 * Stuck, wherever. The gate now records WHERE — shoulder, median, ditch, field,
 * dirt road, customer property, somewhere else — because a wrecker for a median
 * is a different job than a shoulder pull, and breakdown needs to know.
 *
 * The location does NOT decide the tier. Safety's reasoning: a stuck truck will
 * be exactly as stuck tomorrow, so there is no window closing and nothing for a
 * call to change. It is a text to safety and an immediate dispatch to breakdown.
 */
function isStuck_(p) {
  var v = String(p.vehicleStuck || '').trim().toLowerCase();
  if (!v || v === 'no') return false;
  return v.indexOf('yes') === 0 || v === 'true' || v === '1';
}

function yes_(v) {
  if (v === true) return true;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'y' || s === 'yes' || s === 'true' || s === '1';
}

function no_(v) {
  if (v === false) return true;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'n' || s === 'no' || s === 'false' || s === '0';
}

function tab_(spreadsheetId, sheetName) {
  var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  if (!sheet) throw new Error('Tab not found: ' + sheetName);
  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- Header-addressed columns ------------------------------------------------
// Address columns by their header name, not a fixed index, so the sheet can be
// reordered freely and the code follows. Cached per execution.
//
// NOTE: the cache is a single global not keyed by sheet, so this pair is safe
// only while one execution touches one tab. The office-side tools in
// incident-workbook-tools.gs read two tabs in a run and therefore keep their
// own colIndex_/setCell_ — do not "clean up the duplication" by merging them.
var _headerCache = null;

function colFor_(sheet, headerName) {
  if (!_headerCache) {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    _headerCache = {};
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i]).trim();
      if (h) _headerCache[h] = i + 1;
    }
  }
  var col = _headerCache[headerName];
  return col === undefined ? -1 : col;
}

/** Writes a value by header name. Logs rather than throwing if absent. */
function setByHeader_(sheet, rowNum, headerName, value) {
  var col = colFor_(sheet, headerName);
  if (col < 0) {
    logError_('setByHeader_', 'No column named "' + headerName + '"');
    return false;
  }
  sheet.getRange(rowNum, col).setValue(value);
  return true;
}

/** Row number for a given case number, or 0. */
function rowForCaseNumber_(sheet, caseNumber) {
  var col = colFor_(sheet, 'Case Number');
  if (col < 0) return 0;
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === String(caseNumber).trim()) return i + 2;
  }
  return 0;
}

function logError_(where, err) {
  try {
    SpreadsheetApp.openById(INC.ERROR_LOG_ID)
      .getSheetByName('Sheet1')
      .appendRow([new Date(), where, String(err)]);
  } catch (ignored) {}
}


/**
 * =============================================================================
 * REQUIRED CHANGE TO norlo-twilio-sms.gs
 * =============================================================================
 *
 * blastForClaim_ currently reads the group from config:
 *
 *     function blastForClaim_(rowNum, row) {
 *       var roster = rosterForGroup_(CFG.CLAIM_GROUP);
 *
 * Change it to accept the group, falling back to the old behavior so the
 * breakdown automation keeps working untouched:
 *
 *     function blastForClaim_(rowNum, row, group) {
 *       var roster = rosterForGroup_(group || CFG.CLAIM_GROUP);
 *
 * That is the only edit. Everything else — token minting, the LockService
 * first-wins claim, notifyGroupAssigned_ — already does what safety needs.
 *
 *
 * ALSO BEFORE GO-LIVE
 *   - CFG.ENFORCE_SIGNATURE is false. An unverified webhook means a forged
 *     POST can mark a Tier 1 incident as claimed by someone who never saw it.
 *     verifyTwilioSignature_ is already written; turn it on.
 *   - Strip the Account SID from the comment block in twilio.gs before that
 *     file goes anywhere near a public repo.
 *   - INC.DRY_RUN above stays true until Riley and Mark sign off on Section 3.
 * =============================================================================
 */


// =============================================================================
// SECTION 8 — KILL SWITCH
// =============================================================================

/**
 * Borrowed from the mechanics app. To shut the incident form off instantly:
 *   Apps Script → Project Settings → Script Properties
 *   Set INCIDENT_APP_ENABLED to "false"
 * No redeploy needed. Takes effect on the next request.
 *
 * If the property has never been set, the form runs. That way a fresh deploy
 * works without having to configure anything first.
 */
function isIncidentAppEnabled_() {
  if (!INC.RESPECT_KILL_SWITCH) return true;
  var val = PropertiesService.getScriptProperties().getProperty('INCIDENT_APP_ENABLED');
  return val === null || val === undefined || val === '' || val === 'true';
}


// =============================================================================
// SECTION 8b — ONE-OFF REPAIR
// =============================================================================

/**
 * Repairs photo cells that were written before the multi-photo fix deployed.
 *
 * A row submitted in that window has "[Ljava.lang.Object;@…" in a photo column
 * instead of the URLs. Nothing was lost — the Payload column holds every answer
 * including the photo arrays — so this reads them back out and rewrites the
 * cells properly.
 *
 * Run once from the editor, then never again. Logs what it changed and touches
 * nothing else.
 */
function repairPhotoCells() {
  var sheet = tab_(INC.SHEET_ID, INC.DATA_TAB);
  var last  = sheet.getLastRow();
  if (last < 2) { Logger.log('No rows.'); return; }

  var map = {
    'Photo — Scene':     'photoScene',
    'Photo — Our Truck': 'photoOurEquipment',
    'Photo — Other':     'photoOtherProperty'
  };

  var payCol = colFor_(sheet, 'Payload');
  if (payCol < 0) { Logger.log('No Payload column.'); return; }

  var fixed = 0;
  for (var r = 2; r <= last; r++) {
    var raw = sheet.getRange(r, payCol).getValue();
    if (!raw) continue;
    var p;
    try { p = JSON.parse(raw); } catch (e) { continue; }

    for (var header in map) {
      var col = colFor_(sheet, header);
      if (col < 0) continue;
      var cell = String(sheet.getRange(r, col).getValue() || '');

      // Only touch cells that are actually broken.
      if (cell.indexOf('[L') !== 0 && cell.indexOf('java.lang') < 0) continue;

      var good = photoCell_(p[map[header]]);
      sheet.getRange(r, col).setValue(good);
      Logger.log('Row %s  %s  ->  %s', r, header,
                 good ? good.split('\n').length + ' photo(s)' : 'empty');
      fixed++;
    }
  }
  Logger.log(fixed ? fixed + ' cell(s) repaired.' : 'Nothing needed repair.');
}


// =============================================================================
// SECTION 9 — SELF TEST
// =============================================================================

/**
 * Run this from the Apps Script editor BEFORE deploying.
 *
 * Select "runSelfTest" in the function dropdown, click Run, then read the
 * Execution log. It checks the sheet connection and walks computeSeverity_
 * through the tier cases. Nothing is written and nothing is sent — it only
 * reads the sheet header and calls the tier logic.
 */
function runSelfTest() {
  var pass = 0, fail = 0;

  function check(label, actual, expected) {
    if (String(actual) === String(expected)) {
      Logger.log('  PASS  %s  →  %s', label, actual);
      pass++;
    } else {
      Logger.log('  FAIL  %s  →  got %s, expected %s', label, actual, expected);
      fail++;
    }
  }

  Logger.log('--- Sheet connection ---');
  try {
    var sheet = tab_(INC.SHEET_ID, INC.DATA_TAB);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    Logger.log('  Connected to "%s", tab "%s", %s columns',
               SpreadsheetApp.openById(INC.SHEET_ID).getName(),
               INC.DATA_TAB, headers.length);
    if (headers.length < 28) {
      Logger.log('  WARNING: expected at least 28 headers, found %s', headers.length);
    }
    pass++;
  } catch (err) {
    Logger.log('  FAIL  Could not open the sheet: %s', err);
    Logger.log('  Check INC.SHEET_ID and that the tab is named exactly IncidentsData.');
    fail++;
  }

  // A fully answered, entirely unremarkable incident. Every other case below
  // starts from this and changes one thing.
  function baseline() {
    return {
      anyoneInjured: 'No', medicalAwayFromScene: 'No',
      otherVehicleInvolved: 'No', otherPartyInvolved: 'No', policeOnScene: 'No',
      citationIssued: 'No', rollover: 'No', hazmatOrFuelSpill: 'No',
      truckDrivable: 'Yes', towRequired: 'No', vehicleStuck: 'No'
    };
  }

  Logger.log('--- Tier logic ---');

  var t;

  t = baseline();
  check('Deer strike, nobody hurt, drivable', computeSeverity_(t).tier, 3);

  t = baseline(); t.citationIssued = 'Yes';
  check('Citation only, no tow, no injury', computeSeverity_(t).tier, 2);

  t = baseline(); t.truckDrivable = 'No';
  check('Not drivable — breakdown\'s problem, not a call', computeSeverity_(t).tier, 2);

  t = baseline(); t.citationIssued = 'Yes'; t.towRequired = 'Yes';
  check('Citation WITH tow (DOT testing clock)', computeSeverity_(t).tier, 1);

  t = baseline(); t.citationIssued = 'Officer said one is coming'; t.towRequired = 'Yes';
  check('Expected citation WITH tow (DOT clock)', computeSeverity_(t).tier, 1);

  t = baseline(); t.policeOnScene = 'Yes, they are here';
  check('Police taking a deer report, no party', computeSeverity_(t).tier, 3);

  // Another vehicle is a call whatever the presence answer — Michigan no-fault
  // has a carve-out for parked vehicles, so fault genuinely matters there.
  t = baseline(); t.otherPartyInvolved = 'Yes'; t.otherVehicleInvolved = 'Yes';
  t.otherPartyPresent = 'Yes, they are here';
  check('Another vehicle, driver present', computeSeverity_(t).tier, 1);

  t = baseline(); t.otherPartyInvolved = 'Yes'; t.otherVehicleInvolved = 'Yes';
  t.otherPartyPresent = 'Nobody was ever there';
  check('Legally parked car, owner absent', computeSeverity_(t).tier, 1);

  // Property is different — presence still decides.
  t = baseline(); t.otherPartyInvolved = 'Yes';
  t.otherPartyPresent = 'Yes, they are here';
  check('Property, owner standing there', computeSeverity_(t).tier, 1);

  t = baseline(); t.otherPartyInvolved = 'Yes';
  t.otherPartyPresent = 'Nobody was ever there';
  check('Property, nobody there', computeSeverity_(t).tier, 2);

  t = baseline(); t.anyoneInjured = 'Yes';
  check('Someone hurt', computeSeverity_(t).tier, 1);

  t = baseline(); delete t.truckDrivable;
  check('Gate left blank (fail upward)', computeSeverity_(t).tier, 1);

  t = baseline(); t.truckDrivable = 'Unknown';
  check('Gate answered Unknown (fail upward)', computeSeverity_(t).tier, 1);

  t = baseline(); t.otherPartyInvolved = 'Yes';   // presence never answered
  check('Other party involved, presence blank', computeSeverity_(t).tier, 1);

  t = baseline(); t.hazmatOrFuelSpill = 'Yes';
  check('Fluid leaking', computeSeverity_(t).tier, 1);

  Logger.log('--- Column lookups ---');
  // Watch the em dashes: "Photo — Scene" (em dash) will NOT match "Photo - Scene"
  // (hyphen). This check makes that mismatch fail loudly instead of silently
  // writing to the wrong cell.
  _headerCache = null; // force a fresh header read
  var cs = tab_(INC.SHEET_ID, INC.DATA_TAB);
  ['Case Number', 'Status', 'Claimed By', 'Claimed At', 'Description',
   'Office Notes', 'Photo — Scene', 'Photo — Our Truck', 'Photo — Other',
   'Photos — Folder', 'Not applicable', 'Answered no', 'Incident ID',
   'Payload'].forEach(function (h) {
    var c = colFor_(cs, h);
    if (c > 0) { Logger.log('  PASS  %s → col %s', h, c); pass++; }
    else       { Logger.log('  FAIL  %s → NOT FOUND', h); fail++; }
  });

  Logger.log('--- Case numbers ---');
  // Checking the VALUES, not the column format. Google reports "Automatic" as
  // an empty string and plain text as '@', but neither reliably tells you
  // whether a leading zero actually survived — and the value is what matters.
  // A case number is MMDDYY + a sequence of at least two: 8 characters minimum.
  // Anything shorter has been mangled by number formatting.
  try {
    var cnSheet = tab_(INC.SHEET_ID, INC.DATA_TAB);
    var lastCn  = cnSheet.getLastRow();
    if (lastCn < 2) {
      Logger.log('  (no incidents yet — nothing to check)');
    } else {
      var col  = colFor_(cnSheet, 'Case Number');
      var vals = cnSheet.getRange(2, col, lastCn - 1, 1).getValues();
      var bad  = [];
      for (var ci = 0; ci < vals.length; ci++) {
        var raw = vals[ci][0];
        if (raw === '' || raw === null) continue;
        if (typeof raw === 'number' || String(raw).length < 8) {
          bad.push('row ' + (ci + 2) + ': ' + raw);
        }
      }
      if (bad.length) {
        Logger.log('  FAIL  %s case number(s) lost a leading zero:', bad.length);
        bad.forEach(function (b) { Logger.log('          ' + b); });
        Logger.log('        Select column A → Format → Number → Plain text,');
        Logger.log('        then retype those cells with the leading zero.');
        fail++;
      } else {
        Logger.log('  PASS  All %s case number(s) intact', vals.length);
        pass++;
      }
    }
  } catch (e) {
    Logger.log('  Could not check case numbers: %s', e);
  }

  Logger.log('--- Flags ---');
  Logger.log('  DRY_RUN: %s   SMS_ENABLED: %s   BREAKDOWN_SPAWN: %s',
             INC.DRY_RUN, INC.SMS_ENABLED, INC.BREAKDOWN_SPAWN_ENABLED);
  var sumTo = summaryRecipient_();
  Logger.log('  Summary email: %s', sumTo ? sumTo : 'OFF — nothing is sent');

  Logger.log('');
  Logger.log('%s passed, %s failed', pass, fail);
  if (fail === 0) Logger.log('All good — safe to deploy.');
  else Logger.log('Fix the failures above before deploying.');
}
