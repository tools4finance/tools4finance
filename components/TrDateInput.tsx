"use client";

import { useEffect, useState } from "react";

// Native <input type="date"> renders/parses using the BROWSER's own UI
// language (Chrome's language setting), not the page's `lang` attribute —
// setting lang="tr" on the input has no effect on Chromium's date format,
// so a user whose browser is set to English sees/must type MM/DD/YYYY no
// matter what the page says. This is a plain text field instead: it always
// displays and parses gg.aa.yyyy regardless of the visitor's browser
// language, trading the native calendar-picker popup for a format that
// actually matches the rest of the site.
function isoToTr(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}.${m}.${y}`;
}

function trToIso(tr: string): string | null {
  const match = tr.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function TrDateInput({
  value,
  onChange,
  className,
  required,
}: {
  value: string; // ISO yyyy-mm-dd, "" when empty
  onChange: (isoValue: string) => void;
  className?: string;
  required?: boolean;
}) {
  const [text, setText] = useState(() => isoToTr(value));

  // Keep the typed text in sync when the value changes from outside (e.g. a
  // "bugün" button, or the two-way min/max correction some callers do).
  useEffect(() => {
    setText(isoToTr(value));
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setText(raw);
    const iso = trToIso(raw);
    if (iso) onChange(iso);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="gg.aa.yyyy"
      value={text}
      onChange={handleChange}
      className={className}
      required={required}
    />
  );
}
