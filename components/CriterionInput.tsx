"use client";

import { fieldKind, type CustomerFieldName } from "@/lib/customerScoring";

// Renders the right input type for a criterion's source_field (text/number/
// checkbox) — shared by the customer detail scorecard and the standalone
// calculator, since criteria (and therefore which fields need inputs) are
// now fully user-defined rather than a fixed set each page hardcoded.
export default function CriterionInput({
  field,
  value,
  onChange,
}: {
  field: CustomerFieldName;
  value: string | number | boolean | null;
  onChange: (value: string | number | boolean | null) => void;
}) {
  const kind = fieldKind(field);

  if (kind === "boolean") {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        Yes
      </label>
    );
  }

  if (kind === "number" || kind === "fraction") {
    return (
      <input
        type="number"
        step="any"
        value={value === null || value === undefined ? "" : (value as number)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        style={{ width: 110 }}
      />
    );
  }

  return (
    <input
      value={(value as string) ?? ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: 130 }}
    />
  );
}
