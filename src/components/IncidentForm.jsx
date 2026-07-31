import { useState } from "react";
import { SECTIONS, INCIDENT_TYPES } from "../incidentSchema";
import { ENDPOINT, isEndpointConfigured } from "../config";
import Field from "./Field";
import IncidentTypeSelect from "./IncidentTypeSelect";

// A section is visible when it has no `types` (core) or when at least one of
// its `types` is currently selected. This is the org-chart branching.
function isSectionVisible(section, selectedTypes) {
  if (!section.types) return true;
  return section.types.some((t) => selectedTypes.includes(t));
}

export default function IncidentForm() {
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [values, setValues] = useState({});
  const [invalidFields, setInvalidFields] = useState({});
  const [typeInvalid, setTypeInvalid] = useState(false);
  const [warning, setWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState(false);
  const [notice, setNotice] = useState("");

  const visibleSections = SECTIONS.filter((s) =>
    isSectionVisible(s, selectedTypes)
  );

  const handleValueChange = (key, val) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    setInvalidFields((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const toggleType = (key) => {
    setTypeInvalid(false);
    setSelectedTypes((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const resetForm = () => {
    setSelectedTypes([]);
    setValues({});
    setInvalidFields({});
    setTypeInvalid(false);
    setWarning(false);
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setNotice("");

    // Validate only required fields that are currently visible, plus the
    // incident type. A field hidden by branching is never required.
    const newInvalid = {};
    for (const section of visibleSections) {
      for (const field of section.fields) {
        if (field.required && !String(values[field.key] ?? "").trim()) {
          newInvalid[field.key] = true;
        }
      }
    }
    const noType = selectedTypes.length === 0;

    if (Object.keys(newInvalid).length > 0 || noType) {
      setInvalidFields(newInvalid);
      setTypeInvalid(noType);
      setWarning(true);
      return;
    }

    const payload = {
      incidentTypes: selectedTypes.map(
        (k) => INCIDENT_TYPES.find((t) => t.key === k)?.label ?? k
      ),
      ...values,
    };

    // eslint-disable-next-line no-console
    console.log("Incident payload:", payload);

    if (!isEndpointConfigured()) {
      setNotice(
        "Backend not configured yet. The incident was NOT submitted. " +
          "Set ENDPOINT in src/config.js to your Apps Script /exec URL. " +
          "(The payload was logged to the console.)"
      );
      return;
    }

    try {
      setSubmitting(true);
      // Send the body as a string so the browser uses a text/plain content
      // type. That keeps this a CORS "simple request" and avoids the OPTIONS
      // preflight that Google Apps Script does not answer.
      const res = await fetch(ENDPOINT + "?route=createIncident", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      resetForm();
      setSuccessMessage(true);
      setTimeout(() => setSuccessMessage(false), 4000);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setNotice("Submission failed. Please try again or contact the office.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 pb-12">
      {successMessage && (
        <div className="rounded-md bg-green-50 p-4" id="message">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-green-400"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-green-800">
                Incident report submitted
              </p>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="rounded-md bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">{notice}</p>
        </div>
      )}

      {/* Incident Type drives the branching below */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <IncidentTypeSelect
          selected={selectedTypes}
          onToggle={toggleType}
          isInvalid={typeInvalid}
        />
      </div>

      {visibleSections.map((section) => (
        <fieldset
          key={section.id}
          className="rounded-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <legend className="px-1 text-base font-semibold text-gray-900 dark:text-gray-100">
            {section.title}
          </legend>
          <div className="space-y-4">
            {section.fields.map((field) => (
              <Field
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={handleValueChange}
                invalid={!!invalidFields[field.key]}
              />
            ))}
          </div>
        </fieldset>
      ))}

      {warning && (
        <p className="text-sm text-red-600" id="form-error">
          Complete the required fields marked with *
        </p>
      )}

      <div className="flex justify-center items-center">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-emerald-700 px-12 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:opacity-60"
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </div>
    </form>
  );
}
