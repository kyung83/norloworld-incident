/**
 * =============================================================================
 * incident-api.gs  —  Norlo Driver Incident Report
 * =============================================================================
 *
 * Companion to the existing Breakdowns API. Deliberately mirrors the idioms
 * already in use at Norlo:
 *   - doGet / doPost switch on a ?route= parameter
 *   - convert2DArrayToObjects() for sheet reads
 *   - category/subcategory dropdowns driven from a sheet tab, not from code
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
  // "2026 Incident Report Updated" — where driver submissions land.
  SHEET_ID:        '1eet9u2Bb9m_8Aj-TFymxAwouK2z-O1AmAwt5KajVu0w',

  // Breakdown workbook. Only used by spawnBreakdown_, which is disabled below
  // until the incident side is proven out.
  BREAKDOWN_SHEET_ID: '1ni51WDxpEeYSnf2f4UmtOAp1Dsvtv8uWHPVkvjCijLI',

  MASTER_SHEET_ID: '1zFDdVqpb51u7BPAE9RA6v7e-ew8fR-E4fHcTMWDNg-g',
  ERROR_LOG_ID:    '10amkhYmOGsrUL2PAl7XqId2i-G63gXdBNirWnR66tGc',

  DATA_TAB:       'IncidentsData',
  CATEGORIES_TAB: 'Incident Categories',   // same shape as 'Breakdowns Categories'
  ROSTER_TAB:     'Roster',

  // Drive folder (created in the deploying account's My Drive) holding incident
  // photos — one subfolder per incident. Created on first upload.
  PHOTO_ROOT_FOLDER: 'Incident Photos',

  // Roster groups. rosterForGroup_() compares as trimmed strings, so named
  // groups coexist with the numeric breakdown stages already in the sheet.
  GROUP_SAFETY_NOW: 'SAFETY-NOW',   // Riley + Mark — Tier 1 only
  GROUP_BREAKDOWN:  '1',            // existing Stage 1 breakdown roster

  TIMEZONE: 'America/Detroit',

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
        categories: getIncidentCategories(),
        drivers:    getDrivers(),
        states:     getStates()
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
 * Layout:  Incident Photos / "YYYY-MM-DD DriverName" / YYYY-MM-DD_DriverName_slot.jpg
 * Payload: { dataUrl | content, contentType?, slot, driverName, dateOfIncident }
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

    var driver  = sanitizeName_(pick_(p, 'driverName', 'driver')) || 'Unknown';
    var dateStr = photoDateStr_(p.dateOfIncident);
    var slot    = sanitizeName_(p.slot || 'photo');
    var ext     = contentType.indexOf('png') > -1 ? 'png' : 'jpg';
    var name    = dateStr + '_' + driver + '_' + slot + '.' + ext;
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
  var hasPhoto = false;
  for (var k in p) {
    if (k.indexOf('photo') === 0 && /^https?:/i.test(String(p[k] || ''))) { hasPhoto = true; break; }
  }
  if (!hasPhoto) return '';
  try {
    var driver  = sanitizeName_(pick_(p, 'driverName', 'driver')) || 'Unknown';
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
        var cn = String(nums[i][0] || '');
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
  if (yes_(p.otherVehicleInvolved))  reasons.push('Another vehicle involved');
  if (yes_(p.pedestrianInvolved))    reasons.push('Pedestrian or cyclist involved');
  if (yes_(p.rollover))              reasons.push('Rollover or jackknife');
  if (yes_(p.hazmatOrFuelSpill))     reasons.push('Fuel, oil, or hazmat spill');
  if (yes_(p.driverRequestsContact)) reasons.push('Driver asked to be contacted now');

  // Police attending a parking-lot scrape is not by itself a wakeup. Police
  // attending something with another party in it is.
  if (yes_(p.policeOnScene) && yes_(p.otherPartyInvolved)) {
    reasons.push('Police on scene with another party involved');
  }

  // 49 CFR 382.303. A citation on its own is a morning problem. A citation
  // combined with a tow-away or an injury starts a testing clock: alcohol is
  // abandoned at 8 hours, controlled substances at 32. This cannot wait for
  // the morning queue, which is exactly why it is checked as a COMBINATION
  // and not as a property of the citation field alone.
  if (yes_(p.citationIssued) && (yes_(p.towRequired) || yes_(p.medicalAwayFromScene))) {
    reasons.push('Citation with tow or injury — DOT post-accident testing clock started');
  }

  if (reasons.length) {
    return { tier: 1, reasons: reasons, lane: laneFor_(p, 1) };
  }

  // ---- FAIL UPWARD ----------------------------------------------------------
  // A gate the driver skipped, closed the form on, or answered "unsure" is
  // not evidence of absence. Escalate rather than assume.

  var gates = [
    'anyoneInjured', 'medicalAwayFromScene', 'pedestrianInvolved',
    'otherVehicleInvolved', 'otherPartyInvolved', 'policeOnScene',
    'citationIssued', 'rollover', 'hazmatOrFuelSpill',
    'truckDrivable', 'towRequired', 'vehicleStuck'
  ];
  var missing = [];
  for (var i = 0; i < gates.length; i++) {
    var v = p[gates[i]];
    if (v === undefined || v === null || String(v).trim() === '' ||
        ['unsure','unknown','n/a'].indexOf(String(v).trim().toLowerCase()) > -1) {
      missing.push(gates[i]);
    }
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

  if (yes_(p.citationIssued))      reasons.push('Citation issued, no tow or injury');
  if (yes_(p.freightDamaged))      reasons.push('Freight damaged');
  if (no_(p.truckDrivable))        reasons.push('Truck not drivable');
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

  var needsBreakdown = no_(p.truckDrivable) || yes_(p.towRequired) || yes_(p.vehicleStuck);
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
    var id    = 'INC-' + Utilities.formatDate(new Date(), INC.TIMEZONE, 'yyyyMMdd-HHmmss');

    // Case number + append run under a lock so two submissions at the same
    // moment get distinct sequential numbers.
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    var caseNumber, rowNum, photoFolderUrl;
    try {
    caseNumber = nextCaseNumber_(sheet);
    // One folder link opens every photo for this incident (up to ten). The
    // upload folder was named by session ID because the case number did not
    // exist yet; now that it does, rename it. Only when a photo came back.
    photoFolderUrl = incidentPhotoFolderFinal_(p, caseNumber);
    // Column order matches the IncidentsData header row: human-readable up
    // front (A–T), photos + plumbing at the back. Photo URLs are written inline
    // here because the wizard uploads them during the checklist and sends the
    // URLs in this payload (there is no separate savePhotoUrls step).
    sheet.appendRow([
      caseNumber,                                         // A  Case Number
      new Date(),                                         // B  Timestamp
      pick_(p, 'driverName', 'driver'),                   // C  Driver
      pick_(p, 'driverPhone', 'driverContact', 'phone'),  // D  Driver Phone
      pick_(p, 'truck', 'truckNumber'),                   // E  Truck
      pick_(p, 'trailer', 'trailerNumber'),               // F  Trailer
      typeList_(p),                                       // G  Type
      pick_(p, 'subCategory', 'subcategory'),             // H  Subcategory
      pick_(p, 'locationName', 'siteName', 'location', 'streetAddress'), // I  Location
      pick_(p, 'city'),                                   // J  City
      pick_(p, 'state'),                                  // K  State
      pick_(p, 'description', 'otherExplain', 'notes'),   // L  Description
      sev.tier,                                           // M  Tier
      sev.reasons.join(' | '),                            // N  Tier Reasons
      sev.lane,                                           // O  Lane
      'New',                                              // P  Status
      '',                                                 // Q  Claimed By
      '',                                                 // R  Claimed At
      pick_(p, 'notApplicable'),                          // S  Not applicable
      pick_(p, 'answeredNo'),                             // T  Answered no
      pick_(p, 'photoScene'),                             // U  Photo — Scene
      pick_(p, 'photoOurEquipment'),                      // V  Photo — Our Truck
      pick_(p, 'photoOtherProperty'),                     // W  Photo — Other
      photoFolderUrl,                                     // X  Photos — Folder
      '',                                                 // Y  Office Notes
      pick_(p, 'breakdownId'),                            // Z  Breakdown ID
      id,                                                 // AA Incident ID
      JSON.stringify(p)                                   // AB Payload (hidden)
    ]);
    rowNum = sheet.getLastRow();
    // Keep the case number as text. Sheets otherwise reads 08042601 as a number
    // and drops the leading zero, breaking both the number people quote and the
    // dashboard's MMDDYY month parsing.
    sheet.getRange(rowNum, 1).setNumberFormat('@').setValue(caseNumber);
    } finally {
      lock.releaseLock();
    }

    // Only Tier 1 makes a phone buzz. This single condition is the difference
    // between the current situation and the one you asked for.
    var notify = { sent: false, reason: 'Tier ' + sev.tier + ' — queued, no SMS' };
    if (sev.tier === 1) {
      notify = notifyTier1_(rowNum, id, p, sev);
    }

    // A disabled truck is a breakdown job whatever the tier says.
    var spawned = null;
    if (INC.BREAKDOWN_SPAWN_ENABLED &&
        (sev.lane === 'BREAKDOWN' || sev.lane === 'BOTH')) {
      spawned = spawnBreakdown_(id, p);
    }

    return {
      ok: true,
      incidentId: id,
      caseNumber: caseNumber,
      tier: sev.tier,
      reasons: sev.reasons,
      lane: sev.lane,
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
function notifyTier1_(rowNum, id, p, sev) {
  if (!INC.SMS_ENABLED) {
    Logger.log('[SMS OFF] Tier 1 %s — %s', id, sev.reasons.join(' | '));
    return { sent: false, reason: 'SMS not wired up yet' };
  }

  if (INC.DRY_RUN) {
    Logger.log('[DRY_RUN] Tier 1 %s would blast %s: %s',
               id, INC.GROUP_SAFETY_NOW, sev.reasons.join(' | '));
    return { sent: false, reason: 'DRY_RUN' };
  }

  var body = [
    'TIER 1 INCIDENT ' + id,
    (p.driverName || 'Unknown driver') + '  ' + (p.driverPhone || ''),
    'Truck ' + (p.truck || '?') + '  Trailer ' + (p.trailer || '?'),
    (p.locationName || '') + ' ' + (p.city || '') + ' ' + (p.state || ''),
    sev.reasons.join('; ')
  ].join('\n');

  try {
    // blastForClaim_ mints the token, texts the roster, and opens the Claim Log
    // row. Passing the group explicitly is the only modification needed.
    return blastForClaim_(rowNum, { _incidentBody: body }, INC.GROUP_SAFETY_NOW);
  } catch (err) {
    logError_('notifyTier1_', err);
    // A failed page must be loud. Fall back to email rather than fail silently.
    MailApp.sendEmail({
      to: 'breakdown@norloworld.com',
      subject: 'TIER 1 INCIDENT ' + id + ' — SMS FAILED',
      body: body + '\n\nSMS dispatch threw: ' + err
    });
    return { sent: false, reason: 'SMS failed, email fallback sent' };
  }
}


/** Opens a matching row on BreakdownsData so the breakdown team sees it too. */
function spawnBreakdown_(incidentId, p) {
  try {
    var sheet = tab_(INC.BREAKDOWN_SHEET_ID, 'BreakdownsData');
    sheet.appendRow([
      '',
      Utilities.formatDate(new Date(), 'GMT', 'yyyy-MM-dd'),
      p.driverName || '',
      p.truck      || '',
      p.trailer    || '',
      p.state      || '',
      p.city       || '',
      'Incident',
      'Spawned from incident ' + incidentId + ' — ' + (p.description || '')
    ]);
    return { ok: true, row: sheet.getLastRow() };
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
// SECTION 6 — CATEGORIES
// =============================================================================

/**
 * Identical in shape to getAllCategoriesAndSubCategories() on the breakdown
 * side: row 1 holds the incident types, each column below holds that type's
 * sub-questions. Riley and Mark reword dropdowns by editing the sheet — no
 * deploy, no ticket to IT.
 */
function getIncidentCategories(sheetName) {
  sheetName = sheetName || INC.CATEGORIES_TAB;
  var sheet = tab_(INC.MASTER_SHEET_ID, sheetName);

  var lastColumn = sheet.getLastColumn();
  var lastRow    = sheet.getLastRow();
  if (lastRow < 2 || lastColumn < 2) return {};

  var categoryRow     = sheet.getRange(1, 2, 1, lastColumn - 1).getValues()[0];
  var subCategoryRows = sheet.getRange(2, 2, lastRow - 1, lastColumn - 1).getValues();

  var categoryData = {};
  categoryRow.forEach(function (category, columnIndex) {
    if (category !== '') {
      categoryData[category] = [];
      subCategoryRows.forEach(function (row) {
        if (row[columnIndex] !== '') categoryData[category].push(row[columnIndex]);
      });
    }
  });

  return categoryData;
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

/** Incident types arrive as an array from the checkboxes; flatten for the cell. */
function typeList_(p) {
  var t = p.incidentTypes || p.incidentType || p.types;
  if (Array.isArray(t)) return t.join(', ');
  return t ? String(t) : '';
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
// SECTION 9 — SELF TEST
// =============================================================================

/**
 * Run this from the Apps Script editor BEFORE deploying.
 *
 * Select "runSelfTest" in the function dropdown, click Run, then read the
 * Execution log. It checks the sheet connection and walks computeSeverity_
 * through the seven cases from the runbook. Nothing is written and nothing is
 * sent — it only reads the sheet header and calls the tier logic.
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
      Logger.log('  WARNING: expected 28 headers, found %s', headers.length);
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
      anyoneInjured: 'No', medicalAwayFromScene: 'No', pedestrianInvolved: 'No',
      otherVehicleInvolved: 'No', otherPartyInvolved: 'No', policeOnScene: 'No',
      citationIssued: 'No', rollover: 'No', hazmatOrFuelSpill: 'No',
      truckDrivable: 'Yes', towRequired: 'No', vehicleStuck: 'No',
      driverRequestsContact: 'No'
    };
  }

  Logger.log('--- Tier logic ---');

  var t;

  t = baseline();
  check('Deer strike, nobody hurt, drivable', computeSeverity_(t).tier, 3);

  t = baseline(); t.citationIssued = 'Yes';
  check('Citation only, no tow, no injury', computeSeverity_(t).tier, 2);

  t = baseline(); t.truckDrivable = 'No';
  check('Not drivable, nothing else', computeSeverity_(t).tier, 2);

  t = baseline(); t.citationIssued = 'Yes'; t.towRequired = 'Yes';
  check('Citation WITH tow (DOT testing clock)', computeSeverity_(t).tier, 1);

  t = baseline(); t.otherVehicleInvolved = 'Yes';
  check('Another vehicle involved', computeSeverity_(t).tier, 1);

  t = baseline(); t.anyoneInjured = 'Yes';
  check('Someone hurt', computeSeverity_(t).tier, 1);

  t = baseline(); delete t.truckDrivable;
  check('Gate left blank (fail upward)', computeSeverity_(t).tier, 1);

  t = baseline(); t.citationIssued = 'Unknown';
  check('Gate answered Unknown (fail upward)', computeSeverity_(t).tier, 1);

  t = baseline(); t.driverRequestsContact = 'Yes';
  check('Driver asks to be called', computeSeverity_(t).tier, 1);

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

  Logger.log('--- Flags ---');
  Logger.log('  DRY_RUN: %s   SMS_ENABLED: %s   BREAKDOWN_SPAWN: %s',
             INC.DRY_RUN, INC.SMS_ENABLED, INC.BREAKDOWN_SPAWN_ENABLED);

  Logger.log('');
  Logger.log('%s passed, %s failed', pass, fail);
  if (fail === 0) Logger.log('All good — safe to deploy.');
  else Logger.log('Fix the failures above before deploying.');
}
