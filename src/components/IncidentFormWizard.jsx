import { useState, useEffect, useMemo, useCallback } from "react";
import { SECTIONS, INCIDENT_TYPES, CHECKLISTS } from "../incidentSchema";
import { ENDPOINT } from "../config";

// =============================================================================
// IncidentFormWizard.jsx
// =============================================================================
//
// Drop-in replacement for IncidentForm.jsx. Same schema, same field keys, same
// payload — only the rendering changes. Nothing in apps-script/ needs to know.
//
// WHY A WIZARD
//   A <select> is two taps plus a scroll. A pair of buttons is one tap. Across
//   thirteen gates that's the difference between a minute of fiddling and about
//   twenty seconds, with no keyboard and no scrolling.
//
// SCREEN ORDER — deliberate
//   1. "Is anyone hurt?"        the only question that can't wait
//   2. Name / truck / trailer   so an abandoned form still identifies who
//   3. Remaining gates          one per screen
//   4. Incident types           the org-chart fork
//   5. Branch sections          only the ones their types revealed
//   6. Review + submit
//
// A driver who quits after screen 2 still leaves a usable record. That is the
// whole reason identity sits second instead of first or last.
//
// =============================================================================

const DRAFT_KEY = "norlo-incident-draft-v1";
const FIRST_GATE = "anyoneInjured";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","ON","QC",
];

export default function IncidentFormWizard() {
  const [values, setValues] = useState({});
  const [types, setTypes] = useState([]);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(null);

  // --- draft restore -------------------------------------------------------
  // Tablets sleep, Eleos backgrounds the webview, drivers take calls. None of
  // that should cost anything already typed.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.values) setValues(d.values);
      if (d.types) setTypes(d.types);
      if (typeof d.step === "number") setStep(d.step);
    } catch {
      // corrupt draft is not worth blocking the form over
    }
  }, []);

  useEffect(() => {
    if (!Object.keys(values).length && !types.length) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ values, types, step }));
      setSavedAt(Date.now());
    } catch {}
  }, [values, types, step]);

  const set = useCallback((key, val) => {
    setValues((v) => ({ ...v, [key]: val }));
  }, []);

  // --- build the screen list ------------------------------------------------
  const gatesSection = SECTIONS.find((s) => s.id === "gates");
  const identitySection = SECTIONS.find((s) => s.id === "identity");

  const steps = useMemo(() => {
    const out = [];
    const gateFields = gatesSection ? gatesSection.fields : [];

    const first = gateFields.find((f) => f.key === FIRST_GATE);
    if (first) out.push({ kind: "gate", field: first });

    if (identitySection) {
      out.push({ kind: "group", title: "Who and what", fields: identitySection.fields });
    }

    gateFields
      .filter((f) => f.key !== FIRST_GATE)
      .forEach((f) => out.push({ kind: "gate", field: f }));

    out.push({ kind: "types" });

    // FIX (applied when wiring in — flag for the source chat): `types` holds
    // incident-type LABELS (that is what gets submitted), but each section's
    // `types` are KEYS. Comparing them directly meant no branch section ever
    // matched. Translate labels -> keys before the visibility test.
    const selectedKeys = types
      .map((label) => INCIDENT_TYPES.find((t) => t.label === label)?.key)
      .filter(Boolean);

    SECTIONS.forEach((s) => {
      if (s.id === "gates" || s.id === "identity") return;
      const visible = s.types === null || s.types.some((t) => selectedKeys.includes(t));
      if (!visible) return;
      out.push({ kind: "group", title: s.title, fields: s.fields, sectionId: s.id });
    });

    out.push({ kind: "review" });
    return out;
  }, [types, gatesSection, identitySection]);

  const current = steps[Math.min(step, steps.length - 1)];
  const pct = Math.round(((step + 1) / steps.length) * 100);

  // --- validation -----------------------------------------------------------
  // Blocks Next rather than failing at submit. A driver should never fill six
  // more screens only to be told screen two was wrong.
  const blocked = useMemo(() => {
    if (!current) return false;
    if (current.kind === "gate") return !values[current.field.key];
    if (current.kind === "types") return types.length === 0;
    if (current.kind === "group") {
      return current.fields.some((f) => f.required && !values[f.key]);
    }
    return false;
  }, [current, values, types]);

  // --- submit ---------------------------------------------------------------
  async function submit() {
    setStatus("sending");
    setError("");
    const payload = { ...values, incidentTypes: types, submittedAt: new Date().toISOString() };

    try {
      // text/plain keeps this a CORS simple request — Apps Script does not
      // answer the preflight that application/json would trigger.
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
      setValues({ _incidentId: data.incidentId, _tier: data.tier });
    } catch (err) {
      setStatus("error");
      setError(String(err.message || err));
    }
  }

  // --- confirmation ---------------------------------------------------------
  if (status === "done") {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-xl font-medium">Report submitted</h1>
        <p className="mt-2 text-sm text-gray-600">
          Reference {values._incidentId}
        </p>
        <p className="mt-4 text-sm text-gray-600">
          {values._tier === 1
            ? "Safety has been notified and will contact you shortly. Stay where you are if it is safe to do so."
            : "Safety will review this and reach out if they need anything further."}
        </p>
        <CallBar />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col p-4">
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

        {current?.kind === "types" && (
          <TypesScreen types={types} setTypes={setTypes} />
        )}

        {current?.kind === "group" && (
          <GroupScreen
            title={current.title}
            fields={current.fields}
            values={values}
            set={set}
            sectionId={current.sectionId}
            selectedTypes={types}
          />
        )}

        {current?.kind === "review" && (
          <ReviewScreen values={values} types={types} onJump={setStep} />
        )}
      </div>

      <div className="mt-6 flex items-center gap-3">
        {step > 0 && (
          <button
            onClick={() => setStep((s) => s - 1)}
            className="rounded border border-gray-300 px-5 py-3 text-base"
          >
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
            disabled={status === "sending"}
            onClick={submit}
            className="flex-1 rounded bg-blue-600 px-5 py-4 text-base font-medium text-white disabled:bg-gray-300"
          >
            {status === "sending" ? "Sending…" : "Submit report"}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {savedAt && (
        <p className="mt-3 text-xs text-gray-500">Saved — safe to close and come back</p>
      )}

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
          {banner}
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

function GroupScreen({ title, fields, values, set, sectionId, selectedTypes }) {
  // Surface the paper checklist alongside the photo step — same guidance the
  // drivers already have, at the moment they need it.
  const checklist =
    sectionId === "media"
      ? selectedTypes.some((t) => t.startsWith("Accident"))
        ? CHECKLISTS.accident
        : CHECKLISTS.propertyDamage
      : null;

  return (
    <div>
      <h1 className="text-xl font-medium">{title}</h1>
      {checklist && (
        <a
          href={checklist}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-sm text-blue-700 underline"
        >
          Open the printed checklist
        </a>
      )}
      <div className="mt-5 flex flex-col gap-5">
        {fields.map((f) => (
          <Field key={f.key} field={f} value={values[f.key]} set={set} />
        ))}
      </div>
    </div>
  );
}

function Field({ field, value, set }) {
  const base = "w-full rounded border border-gray-300 px-3 py-3 text-base";

  // Photo fields capture the image instead of asking whether one was taken.
  // capture="environment" opens the rear camera directly on Android.
  if (field.type === "photo") {
    return (
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{field.label}</span>
        {field.hint && <span className="mb-2 block text-xs text-gray-600">{field.hint}</span>}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => set(field.key, reader.result);
            reader.readAsDataURL(file);
          }}
          className={base}
        />
        {value && <span className="mt-1 block text-xs text-green-700">Photo attached</span>}
      </label>
    );
  }

  if (field.type === "select") {
    const opts = field.key === "state" ? US_STATES : field.options || [];
    return (
      <label className="block">
        <span className="mb-1 block text-sm font-medium">
          {field.label}
          {field.required && <span className="text-red-600"> *</span>}
        </span>
        <select value={value || ""} onChange={(e) => set(field.key, e.target.value)} className={base}>
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
        <span className="mb-1 block text-sm font-medium">
          {field.label}
          {field.required && <span className="text-red-600"> *</span>}
        </span>
        <textarea
          rows={5}
          value={value || ""}
          onChange={(e) => set(field.key, e.target.value)}
          className={base}
          placeholder="You can use the microphone on your keyboard instead of typing."
        />
      </label>
    );
  }

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">
        {field.label}
        {field.required && <span className="text-red-600"> *</span>}
      </span>
      <input
        type={field.type === "date" ? "date" : field.type === "time" ? "time" : "text"}
        value={value || ""}
        onChange={(e) => set(field.key, e.target.value)}
        className={base}
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
  // Always present, every screen, never gated by form state. A driver who
  // knows something is wrong should not have to find the right dropdown.
  //
  // TEMPORARY: this is a test number (Brandon's cell) for bug-shakeout only.
  // TODO(before drivers use this): replace with the REAL safety line(s).
  // Shipping a wrong "Call safety now" number is the one failure mode this bar
  // exists to prevent.
  return (
    <a
      href="tel:+19894297145"
      className="mt-6 block rounded border border-red-300 bg-red-50 py-3 text-center text-sm font-medium text-red-800"
    >
      Call safety now
    </a>
  );
}
