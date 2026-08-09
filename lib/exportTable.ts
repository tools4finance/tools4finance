import * as XLSX from "xlsx";

// Shared Excel/PDF export helpers, factored out of the pattern first built
// for app/aidat/current-account/page.tsx. Every aidat/* list page should use
// these two functions rather than re-implementing XLSX/window.print calls
// per page, so export behavior (filenames, PDF layout, number formatting)
// stays consistent across the module.

export type ExportColumn = {
  header: string;
  // Raw value for the Excel cell (numbers stay numeric so totals work in
  // Excel) — the PDF export calls this the same way and stringifies it.
  value: (row: Record<string, unknown>) => string | number;
};

function slugify(text: string) {
  return text
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function exportRowsToExcel<T extends Record<string, unknown>>(
  rows: T[],
  columns: ExportColumn[],
  opts: { title: string; subtitle?: string; sheetName?: string }
) {
  const today = new Date();
  const generatedLabel = today.toLocaleDateString("tr-TR");

  const headerLines: (string | number)[][] = [[opts.title]];
  if (opts.subtitle) headerLines.push([opts.subtitle]);
  headerLines.push([`Oluşturma Tarihi: ${generatedLabel}`], []);

  const sheetRows: (string | number)[][] = [
    ...headerLines,
    columns.map((c) => c.header),
    ...rows.map((row) => columns.map((c) => c.value(row))),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  worksheet["!cols"] = columns.map(() => ({ wch: 18 }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, opts.sheetName ?? "Veri");

  const datePart = today.toISOString().slice(0, 10).replace(/-/g, "");
  XLSX.writeFile(workbook, `${slugify(opts.title)}-${datePart}.xlsx`);
}

export function exportRowsToPdf<T extends Record<string, unknown>>(
  rows: T[],
  columns: ExportColumn[],
  opts: { title: string; subtitle?: string }
) {
  const today = new Date();
  const generatedLabel = today.toLocaleDateString("tr-TR");

  const win = window.open("", "_blank");
  if (!win) return;

  const theadCells = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const bodyRows = rows
    .map((row) => {
      const cells = columns
        .map((c) => `<td>${escapeHtml(String(c.value(row)))}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  win.document.write(`<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #161B2E; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .subtitle { font-size: 13px; color: #545B72; margin: 0 0 2px; }
  .meta { font-size: 11px; color: #9499AC; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #DCE0E8; }
  th { background: #EAECF0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>${escapeHtml(opts.title)}</h1>
  ${opts.subtitle ? `<p class="subtitle">${escapeHtml(opts.subtitle)}</p>` : ""}
  <p class="meta">Oluşturma Tarihi: ${generatedLabel}</p>
  <table>
    <thead><tr>${theadCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`);
  win.document.close();
  setTimeout(() => win.print(), 300);
}
