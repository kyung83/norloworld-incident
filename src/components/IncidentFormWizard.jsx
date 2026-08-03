import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { SECTIONS, INCIDENT_TYPES, CHECKLISTS } from "../incidentSchema";
import { ENDPOINT } from "../config";

// =============================================================================
// IncidentFormWizard.jsx — one question per screen, plus a checklist screen of
// Yes/No/N-A rows with reveal-on-answer and per-photo upload+retry.
// =============================================================================

const DRAFT_KEY = "norlo-incident-draft-v1";
const FIRST_GATE = "anyoneInjured";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","ON","QC",
];

const SLOT_LABEL = {
  photoScene: "scene",
  photoOurEquipment: "our-truck",
  photoOtherProperty: "other-property",
  photoOtherId: "other-id",
  photoOtherInsurance: "other-insurance",
  photoOtherVehicle: "other-vehicle",
  photoTicket: "ticket",
  photoPoliceReport: "police-report",
  photoLoadWide: "load-wide",
  photoLoadDamage: "load-damage",
};

const CHECKLIST_SECTION = SECTIONS.find((s) => s.id === "checklist");
const ALL_PHOTO_KEYS = CHECKLIST_SECTION
  ? CHECKLIST_SECTION.rows.flatMap((r) =>
      (r.fields || []).filter((f) => f.type === "photo").map((f) => f.key)
    )
  : [];

const INPUT =
  "w-full rounded border border-gray-300 bg-white px-3 py-3 text-base text-gray-900 placeholder-gray-500";

// --- pure helpers -----------------------------------------------------------

function keysFromTypes(types) {
  return types
    .map((label) => INCIDENT_TYPES.find((t) => t.label === label)?.key)
    .filter(Boolean);
}

function sectionVisible(s, values, selectedKeys) {
  const typeOk = s.types === null || s.types.some((t) => selectedKeys.includes(t));
  const ifOk = !s.showIf || values[s.showIf.key] === s.showIf.equals;
  return typeOk && ifOk;
}

function isRequired(f, values) {
  if (f.required) return true;
  if (f.requiredIf) return values[f.requiredIf.key] === f.requiredIf.equals;
  return false;
}

// A field is satisfied when: not required, OR a photo whose upload is done, OR
// a non-photo with a non-empty value.
function fieldOk(f, values, photoStatus) {
  if (!isRequired(f, values)) return true;
  if (f.type === "photo") return photoStatus[f.key] === "done";
  return !!(values[f.key] && String(values[f.key]).trim());
}

function rowVisible(row, values, selectedKeys) {
  if (row.showIf && values[row.showIf.key] !== row.showIf.equals) return false;
  if (row.showIfTypes && !row.showIfTypes.some((t) => selectedKeys.includes(t))) return false;
  return true;
}

// Effective answer for a row: a locked row reads its gate; an asked row reads
// its own key.
function rowAnswer(row, values) {
  return row.answeredBy ? values[row.answeredBy] : values[row.key];
}

// N/A path complete: a reason chosen, follow-up fields filled if the reason
// triggers them, and a real note (>= 15 chars) for any "Other" reason.
function naComplete(row, values) {
  const reason = values[row.key + "_naReason"];
  if (!reason) return false;
  if (row.naFollowUp && reason === row.naFollowUp.when) {
    if (!row.naFollowUp.fields.every((f) => values[f.key] && String(values[f.key]).trim()))
      return false;
  }
  if (/^Other/i.test(reason)) {
    if (String(values[row.key + "_naNote"] || "").trim().length < 15) return false;
  }
  return true;
}

function fieldsOk(row, values, photoStatus) {
  return (row.fields || []).every((f) => fieldOk(f, values, photoStatus));
}

function rowComplete(row, values, photoStatus) {
  if (row.type === "alwaysRequired") return fieldsOk(row, values, photoStatus);

  const reveal = row.revealOn || "Yes";
  const ans = rowAnswer(row, values);

  if (row.answeredBy) {
    // Locked to a gate. Nothing to do unless the gate revealed the row.
    if (ans !== reveal) return true;
    if (fieldsOk(row, values, photoStatus)) return true;
    if (row.naReasons && naComplete(row, values)) return true; // couldn't-provide escape
    return false;
  }

  if (ans === "No") return true;
  if (ans === "N/A") return naComplete(row, values);
  if (ans === reveal) return fieldsOk(row, values, photoStatus);
  return false; // unanswered
}

function checklistComplete(section, values, photoStatus, selectedKeys) {
  return section.rows
    .filter((r) => rowVisible(r, values, selectedKeys))
    .every((r) => rowComplete(r, values, photoStatus));
}

// Build the two sheet summaries + the count of vague "Other" N/A reasons.
function checklistSummary(section, values, selectedKeys) {
  const na = [];
  const no = [];
  let otherNaCount = 0;
  section.rows
    .filter((r) => rowVisible(r, values, selectedKeys))
    .forEach((r) => {
      if (r.type === "alwaysRequired") return;
      const reveal = r.revealOn || "Yes";
      const ans = rowAnswer(r, values);
      const reason = values[r.key + "_naReason"];
      if (ans === "No") {
        no.push(r.label);
      } else if (ans === "N/A" && reason) {
        const note = values[r.key + "_naNote"];
        na.push(r.label + " — " + reason + (note ? " (" + note + ")" : ""));
        if (/^Other/i.test(reason)) otherNaCount++;
      } else if (r.answeredBy && ans === reveal && r.naReasons && reason) {
        // locked + revealed, satisfied via the couldn't-provide escape
        na.push(r.label + " — " + reason);
        if (/^Other/i.test(reason)) otherNaCount++;
      }
    });
  return { notApplicable: na.join("\n"), answeredNo: no.join("\n"), otherNaCount };
}

async function downscaleImage(file, maxEdge = 1600, quality = 0.7) {
  const readAsDataUrl = (f) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(f);
    });
  const original = await readAsDataUrl(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = original;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return original;
  }
}

async function uploadPhoto(slot, dataUrl, ctx) {
  const res = await fetch(`${ENDPOINT}?route=savePhoto`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      slot: SLOT_LABEL[slot] || slot,
      driverName: ctx.driverName || "",
      dateOfIncident: ctx.dateOfIncident || "",
      dataUrl,
    }),
    redirect: "follow",
  });
  const data = await res.json();
  if (!data.ok || !data.url) throw new Error(data.error || "photo upload failed");
  return data.url;
}

// =============================================================================

export default function IncidentFormWizard() {
  const [values, setValues] = useState({});
  const [types, setTypes] = useState([]);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(null);
  const [photoStatus, setPhotoStatus] = useState({}); // key -> uploading|done|failed
  const [photoData, setPhotoData] = useState({}); // key -> in-memory data URL (retry)

  const valuesRef = useRef(values);
  valuesRef.current = values;
  const photoDataRef = useRef(photoData);
  photoDataRef.current = photoData;

  // --- draft restore -------------------------------------------------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.values) {
        setValues(d.values);
        const ps = {};
        ALL_PHOTO_KEYS.forEach((k) => {
          if (/^https?:/.test(String(d.values[k] || ""))) ps[k] = "done";
        });
        setPhotoStatus(ps);
      }
      if (d.types) setTypes(d.types);
      if (typeof d.step === "number") setStep(d.step);
    } catch {
      // corrupt draft is not worth blocking the form over
    }
  }, []);

  useEffect(() => {
    if (!Object.keys(values).length && !types.length) return;
    try {
      // Photo image data is never persisted (keeps the draft small); their
      // Drive URLs live in `values` and are restored above.
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ values, types, step }));
      setSavedAt(Date.now());
    } catch {}
  }, [values, types, step]);

  const set = useCallback((key, val) => {
    setValues((v) => ({ ...v, [key]: val }));
  }, []);

  // --- photo upload state machine ------------------------------------------
  const doUpload = useCallback(async (fieldKey, dataUrl) => {
    setPhotoStatus((s) => ({ ...s, [fieldKey]: "uploading" }));
    try {
      const ctx = {
        driverName: valuesRef.current.driverName,
        dateOfIncident: valuesRef.current.dateOfIncident,
      };
      const url = await uploadPhoto(fieldKey, dataUrl, ctx);
      setValues((v) => ({ ...v, [fieldKey]: url }));
      setPhotoStatus((s) => ({ ...s, [fieldKey]: "done" }));
    } catch {
      setPhotoStatus((s) => ({ ...s, [fieldKey]: "failed" }));
    }
  }, []);

  const capturePhoto = useCallback(
    async (fieldKey, file) => {
      const dataUrl = await downscaleImage(file);
      setPhotoData((d) => ({ ...d, [fieldKey]: dataUrl }));
      doUpload(fieldKey, dataUrl);
    },
    [doUpload]
  );

  const retryPhoto = useCallback(
    (fieldKey) => {
      const dataUrl = photoDataRef.current[fieldKey];
      if (dataUrl) doUpload(fieldKey, dataUrl);
    },
    [doUpload]
  );

  const anyUploading = Object.values(photoStatus).some((s) => s === "uploading");
  const uploadDone = Object.values(photoStatus).filter((s) => s === "done").length;
  const uploadTracked = Object.keys(photoStatus).length;

  // --- build the screen list ------------------------------------------------
  const gatesSection = SECTIONS.find((s) => s.id === "gates");
  const identitySection = SECTIONS.find((s) => s.id === "identity");
  const selectedKeys = useMemo(() => keysFromTypes(types), [types]);

  const steps = useMemo(() => {
    const out = [];
    const gateFields = gatesSection ? gatesSection.fields : [];

    const first = gateFields.find((f) => f.key === FIRST_GATE);
    if (first) out.push({ kind: "gate", field: first });

    if (identitySection) {
      out.push({ kind: "group", title: identitySection.title, fields: identitySection.fields });
    }

    gateFields
      .filter((f) => f.key !== FIRST_GATE)
      .forEach((f) => out.push({ kind: "gate", field: f }));

    out.push({ kind: "types" });

    SECTIONS.forEach((s) => {
      if (s.id === "gates" || s.id === "identity") return;
      if (!sectionVisible(s, values, selectedKeys)) return;
      if (s.rows) {
        out.push({ kind: "checklist", section: s, sectionId: s.id });
      } else {
        out.push({ kind: "group", title: s.title, subtitle: s.subtitle, fields: s.fields, sectionId: s.id });
      }
    });

    out.push({ kind: "review" });
    return out;
  }, [values, selectedKeys, gatesSection, identitySection]);

  const current = steps[Math.min(step, steps.length - 1)];
  const pct = Math.round(((step + 1) / steps.length) * 100);

  const goToGate = useCallback(
    (gateKey) => {
      const idx = steps.findIndex((s) => s.kind === "gate" && s.field.key === gateKey);
      if (idx >= 0) setStep(idx);
    },
    [steps]
  );

  // --- validation -----------------------------------------------------------
  const blocked = useMemo(() => {
    if (!current) return false;
    if (current.kind === "gate") return !values[current.field.key];
    if (current.kind === "types") return types.length === 0;
    if (current.kind === "group") {
      return current.fields.some((f) => !fieldOk(f, values, photoStatus));
    }
    if (current.kind === "checklist") {
      return anyUploading || !checklistComplete(current.section, values, photoStatus, selectedKeys);
    }
    return false;
  }, [current, values, types, photoStatus, anyUploading, selectedKeys]);

  // --- submit ---------------------------------------------------------------
  async function submit() {
    setStatus("sending");
    setError("");

    const summary = CHECKLIST_SECTION
      ? checklistSummary(CHECKLIST_SECTION, values, selectedKeys)
      : { notApplicable: "", answeredNo: "", otherNaCount: 0 };

    const payload = {
      ...values,
      incidentTypes: types,
      submittedAt: new Date().toISOString(),
      notApplicable: summary.notApplicable,
      answeredNo: summary.answeredNo,
      otherNaCount: summary.otherNaCount,
    };

    try {
      const res = await fetch(`${ENDPOINT}?route=createIncident`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: "follow",
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Submission failed");

      localStorage.removeItem(DRAFT_KEY);
      setStatus("done");
      setValues({ _incidentId: data.incidentId, _caseNumber: data.caseNumber, _tier: data.tier });
    } catch (err) {
      setStatus("error");
      setError(String(err.message || err));
    }
  }

  // --- confirmation ---------------------------------------------------------
  if (status === "done") {
    return (
      <div className="mx-auto my-6 w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-900 shadow-lg">
        <h1 className="text-xl font-medium">Report submitted</h1>
        {values._caseNumber && (
          <>
            <p className="mt-3 text-xs uppercase tracking-wide text-gray-500">Case number</p>
            <p className="text-3xl font-bold tracking-wider">{values._caseNumber}</p>
          </>
        )}
        <p className="mt-2 text-xs text-gray-500">Reference {values._incidentId}</p>
        <p className="mt-4 text-sm text-gray-600">
          {values._tier === 1
            ? "Safety has this now and will call you. Stay where you are if it is safe to do so. You do not need to text it."
            : "Safety will pick this up. No need to text or call unless something changes."}
        </p>
        <CallBar />
      </div>
    );
  }

  const submitting = status === "sending";

  return (
    <div className="mx-auto my-6 flex w-full max-w-md flex-col rounded-xl border border-gray-200 bg-white p-6 text-gray-900 shadow-lg">
      <div className="mb-1 text-xs text-gray-500">
        Step {step + 1} of {steps.length}
      </div>
      <div className="mb-5 h-1 w-full rounded bg-gray-200">
        <div className="h-1 rounded bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="flex-1">
        {current?.kind === "gate" && (
          <GateScreen
            field={current.field}
            value={values[current.field.key]}
            onPick={(v) => {
              set(current.field.key, v);
              setTimeout(() => setStep((s) => s + 1), 120);
            }}
            banner={current.field.key === FIRST_GATE ? gatesSection?.subtitle : null}
          />
        )}

        {current?.kind === "types" && <TypesScreen types={types} setTypes={setTypes} />}

        {current?.kind === "group" && (
          <GroupScreen title={current.title} subtitle={current.subtitle} fields={current.fields} values={values} set={set} />
        )}

        {current?.kind === "checklist" && (
          <ChecklistScreen
            section={current.section}
            values={values}
            set={set}
            selectedTypes={types}
            selectedKeys={selectedKeys}
            photoStatus={photoStatus}
            photoData={photoData}
            onCapture={capturePhoto}
            onRetry={retryPhoto}
            goToGate={goToGate}
          />
        )}

        {current?.kind === "review" && <ReviewScreen values={values} types={types} onJump={setStep} />}
      </div>

      {anyUploading && (
        <p className="mt-4 text-sm text-blue-700">Uploading photos… {uploadDone} of {uploadTracked}</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        {step > 0 && (
          <button onClick={() => setStep((s) => s - 1)} className="rounded border border-gray-300 px-5 py-3 text-base">
            Back
          </button>
        )}
        {current?.kind !== "review" ? (
          <button
            disabled={blocked}
            onClick={() => setStep((s) => s + 1)}
            className="flex-1 rounded bg-blue-600 px-5 py-3 text-base font-medium text-white disabled:bg-gray-300"
          >
            Next
          </button>
        ) : (
          <button
            disabled={submitting || anyUploading}
            onClick={submit}
            className="flex-1 rounded bg-blue-600 px-5 py-4 text-base font-medium text-white disabled:bg-gray-300"
          >
            {submitting ? "Sending…" : anyUploading ? "Waiting on photos…" : "Submit report"}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {savedAt && <p className="mt-3 text-xs text-gray-500">Saved — safe to close and come back</p>}

      <CallBar />
    </div>
  );
}

// =============================================================================
// SCREENS
// =============================================================================

function GateScreen({ field, value, onPick, banner }) {
  const opts = field.options || ["Yes", "No"];
  return (
    <div>
      {banner && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div>{banner}</div>
          <a href="tel:+19898027135" className="mt-1 block font-semibold underline">
            Driver Line: (989) 802-7135
          </a>
        </div>
      )}
      <h1 className="text-2xl font-medium leading-snug">{field.label}</h1>
      <div className="mt-6 flex flex-col gap-3">
        {opts.map((o) => (
          <button
            key={o}
            onClick={() => onPick(o)}
            className={`rounded border-2 px-4 py-5 text-lg font-medium ${
              value === o ? "border-blue-600 bg-blue-50" : "border-gray-300"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function TypesScreen({ types, setTypes }) {
  const toggle = (label) =>
    setTypes(types.includes(label) ? types.filter((t) => t !== label) : [...types, label]);
  return (
    <div>
      <h1 className="text-2xl font-medium leading-snug">What happened?</h1>
      <p className="mt-2 text-sm text-gray-600">Pick everything that applies.</p>
      <div className="mt-6 flex flex-col gap-3">
        {INCIDENT_TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => toggle(t.label)}
            className={`rounded border-2 px-4 py-5 text-left text-lg font-medium ${
              types.includes(t.label) ? "border-blue-600 bg-blue-50" : "border-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function GroupScreen({ title, subtitle, fields, values, set }) {
  return (
    <div>
      <h1 className="text-xl font-medium">{title}</h1>
      {subtitle && (
        <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{subtitle}</p>
      )}
      <div className="mt-5 flex flex-col gap-5">
        {fields.map((f) => (
          <Field key={f.key} field={f} values={values} set={set} />
        ))}
      </div>
    </div>
  );
}

function ChecklistScreen({ section, values, set, selectedTypes, selectedKeys, photoStatus, photoData, onCapture, onRetry, goToGate }) {
  const checklistLink = selectedTypes.some((t) => t.startsWith("Accident"))
    ? CHECKLISTS.accident
    : selectedTypes.some((t) => t.toLowerCase().includes("someone else"))
    ? CHECKLISTS.damageTheirs
    : null;

  const rows = section.rows.filter((r) => rowVisible(r, values, selectedKeys));

  return (
    <div>
      <h1 className="text-xl font-medium">{section.title}</h1>
      {section.subtitle && (
        <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{section.subtitle}</p>
      )}
      {checklistLink && (
        <a href={checklistLink} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-blue-700 underline">
          Open the printed checklist
        </a>
      )}
      <div className="mt-5 flex flex-col gap-4">
        {rows.map((row) => (
          <ChecklistRow
            key={row.key}
            row={row}
            values={values}
            set={set}
            photoStatus={photoStatus}
            photoData={photoData}
            onCapture={onCapture}
            onRetry={onRetry}
            goToGate={goToGate}
          />
        ))}
      </div>
    </div>
  );
}

function ChecklistRow({ row, values, set, photoStatus, photoData, onCapture, onRetry, goToGate }) {
  const reveal = row.revealOn || "Yes";
  const complete = rowComplete(row, values, photoStatus);
  const border = complete ? "border-gray-200" : "border-amber-300";

  const renderFields = (fields) => (
    <div className="mt-3 flex flex-col gap-4">
      {fields.map((f) =>
        f.type === "photo" ? (
          <PhotoField
            key={f.key}
            field={f}
            status={photoStatus[f.key]}
            hasData={!!photoData[f.key]}
            onCapture={onCapture}
            onRetry={onRetry}
          />
        ) : (
          <Field key={f.key} field={f} values={values} set={set} forceRequired />
        )
      )}
    </div>
  );

  // NA reason picker (asked rows in N/A, or locked-revealed couldn't-provide)
  const renderNaReasons = () => {
    const reasonKey = row.key + "_naReason";
    const reason = values[reasonKey];
    return (
      <div className="mt-3 flex flex-col gap-2">
        {row.naReasons.map((rr) => (
          <button
            key={rr}
            type="button"
            onClick={() => set(reasonKey, rr)}
            className={`rounded border px-3 py-2 text-left text-sm ${
              reason === rr ? "border-blue-600 bg-blue-50 font-medium" : "border-gray-300"
            }`}
          >
            {rr}
          </button>
        ))}
        {/^Other/i.test(reason || "") && (
          <textarea
            rows={2}
            value={values[row.key + "_naNote"] || ""}
            onChange={(e) => set(row.key + "_naNote", e.target.value)}
            placeholder="Explain in a sentence (required)"
            className={INPUT}
          />
        )}
        {row.naFollowUp && reason === row.naFollowUp.when && (
          <div className="mt-1 flex flex-col gap-4">
            {row.naFollowUp.fields.map((f) => (
              <Field key={f.key} field={f} values={values} set={set} forceRequired />
            ))}
          </div>
        )}
      </div>
    );
  };

  // --- Always required: no buttons -----------------------------------------
  if (row.type === "alwaysRequired") {
    return (
      <div className={`rounded-lg border ${border} p-3`}>
        <p className="text-sm font-semibold">{row.label}</p>
        {renderFields(row.fields)}
      </div>
    );
  }

  // --- Locked: read the gate, show the answer ------------------------------
  if (row.answeredBy) {
    const ans = values[row.answeredBy];
    const revealed = ans === reveal;
    return (
      <div className={`rounded-lg border ${border} p-3`}>
        <p className="text-sm font-semibold">{row.label}</p>
        <div className="mt-1 flex items-center gap-2 text-sm">
          <span className="rounded bg-gray-100 px-2 py-0.5 font-medium">{ans || "—"} — from your earlier answer</span>
          <button type="button" onClick={() => goToGate(row.answeredBy)} className="text-blue-700 underline">
            change
          </button>
        </div>
        {revealed && renderFields(row.fields)}
        {revealed && row.naReasons && !fieldsOk(row, values, photoStatus) && (
          <div className="mt-3">
            <p className="text-xs text-gray-600">Can&apos;t provide this? Choose a reason:</p>
            {renderNaReasons()}
          </div>
        )}
      </div>
    );
  }

  // --- Asked: three buttons ------------------------------------------------
  const ans = values[row.key];
  const btns = row.naReasons ? [reveal, "No", "N/A"] : [reveal, "No"];
  return (
    <div className={`rounded-lg border ${border} p-3`}>
      <p className="text-sm font-semibold">{row.label}</p>
      {row.sublabel && <p className="text-xs text-gray-600">{row.sublabel}</p>}
      <div className="mt-2 flex gap-2">
        {btns.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => set(row.key, b)}
            className={`flex-1 rounded border-2 px-3 py-2 text-sm font-medium ${
              ans === b ? "border-blue-600 bg-blue-50" : "border-gray-300"
            }`}
          >
            {b}
          </button>
        ))}
      </div>
      {ans === reveal && renderFields(row.fields)}
      {ans === "N/A" && row.naReasons && renderNaReasons()}
    </div>
  );
}

function PhotoField({ field, status, hasData, onCapture, onRetry }) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium">
        {field.label}
        {field.required && <span className="text-red-600"> *</span>}
      </span>
      {field.hint && <span className="mb-2 block text-xs text-gray-600">{field.hint}</span>}

      {status === "done" ? (
        <div className="text-sm font-medium text-green-700">✓ Photo uploaded</div>
      ) : status === "uploading" ? (
        <div className="text-sm text-gray-600">Uploading…</div>
      ) : status === "failed" ? (
        <div>
          <p className="text-sm font-medium text-red-700">Upload failed — your photo is still saved on this form.</p>
          <button
            type="button"
            onClick={() => onRetry(field.key)}
            className="mt-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white"
          >
            Retry upload
          </button>
          <label className="mt-2 block text-xs text-gray-600">
            or take a different photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onCapture(field.key, f);
              }}
              className={INPUT}
            />
          </label>
        </div>
      ) : (
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onCapture(field.key, f);
          }}
          className={INPUT}
        />
      )}
    </div>
  );
}

function Field({ field, values, set, forceRequired }) {
  const value = values[field.key];
  const required = forceRequired ? !!(field.required || field.requiredIf) && isRequired(field, values) : isRequired(field, values);

  const labelEl = (
    <span className="mb-1 block text-sm font-medium">
      {field.label}
      {required && <span className="text-red-600"> *</span>}
    </span>
  );

  if (field.type === "select") {
    const opts = field.key === "state" ? US_STATES : field.options || [];
    return (
      <label className="block">
        {labelEl}
        <select value={value || ""} onChange={(e) => set(field.key, e.target.value)} className={INPUT}>
          <option value="">Choose…</option>
          {opts.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <label className="block">
        {labelEl}
        <textarea
          rows={4}
          value={value || ""}
          onChange={(e) => set(field.key, e.target.value)}
          className={INPUT}
          placeholder={field.placeholder || "You can use the microphone on your keyboard instead of typing."}
        />
      </label>
    );
  }

  return (
    <label className="block">
      {labelEl}
      <input
        type={field.type === "date" ? "date" : field.type === "time" ? "time" : "text"}
        value={value || ""}
        placeholder={field.placeholder}
        onChange={(e) => set(field.key, e.target.value)}
        className={INPUT}
      />
    </label>
  );
}

function ReviewScreen({ values, types, onJump }) {
  const filled = Object.entries(values).filter(
    ([k, v]) => v && !k.startsWith("_") && typeof v === "string" && !v.startsWith("data:")
  );
  return (
    <div>
      <h1 className="text-xl font-medium">Check before sending</h1>
      <p className="mt-2 text-sm text-gray-600">{types.join(", ") || "No type selected"}</p>
      <dl className="mt-4 divide-y divide-gray-200 border-y border-gray-200">
        {filled.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2">
            <dt className="text-sm text-gray-600">{k}</dt>
            <dd className="text-sm font-medium">{String(v).slice(0, 60)}</dd>
          </div>
        ))}
      </dl>
      <button onClick={() => onJump(0)} className="mt-4 text-sm text-blue-700 underline">
        Start over from the first question
      </button>
    </div>
  );
}

function CallBar() {
  // TEMPORARY: test number (Brandon's cell). Replace with the real safety
  // line(s) before drivers use this.
  return (
    <a
      href="tel:+19894297145"
      className="mt-6 block rounded border border-red-300 bg-red-50 py-3 text-center text-sm font-medium text-red-800"
    >
      Call safety now
    </a>
  );
}
