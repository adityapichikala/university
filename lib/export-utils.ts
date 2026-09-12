/**
 * Server-side export helpers.
 *
 * The client already exports whatever is on screen (`components/ui/data-table.tsx`).
 * This module is the other half: an authoritative export built from the
 * database, for exports that must be complete (every user, not just the 25 on
 * page 1), auditable, or produced without a browser.
 *
 * Deliberately dependency-free. A CSV is a text file, and a PDF with one table
 * and no graphics is a few hundred bytes of PostScript — pulling in a PDF
 * library for that adds a supply-chain surface far larger than the problem.
 */

/** Escape one field per RFC 4180: quote it, and double any embedded quote. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = value instanceof Date ? value.toISOString() : String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export interface CsvColumn<T> {
  header: string
  /** Read the value from a row. Return a Date and it is ISO-formatted. */
  value: (row: T) => unknown
}

/**
 * Render rows as CSV text, with a UTF-8 BOM.
 *
 * The BOM is not optional: without it Excel on Windows opens a UTF-8 CSV as
 * the system codepage and mangles every non-ASCII name.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(',')
  const body = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(','))
  // CRLF per RFC 4180 — Excel and Postgres COPY both prefer it.
  return `\ufeff${[head, ...body].join('\r\n')}\r\n`
}

export interface CsvFile {
  body: string
  contentType: string
  filename: string
}

export function csvFile<T>(rows: T[], columns: CsvColumn<T>[], basename: string): CsvFile {
  return {
    body: toCsv(rows, columns),
    contentType: 'text/csv; charset=utf-8',
    filename: `${basename}-${stamp()}.csv`,
  }
}

/** `2026-09-12-0830` — sortable, and obvious which export is which. */
export function stamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`
  )
}

// ── Minimal PDF ─────────────────────────────────────────────────────────────

const PDF_PAGE_W = 842 // A4 landscape, points
const PDF_PAGE_H = 595
const MARGIN = 32
const FONT_SIZE = 8
const LEADING = 12
/** Helvetica is proportional; 0.5 em per glyph is the safe upper bound. */
const CHAR_W = FONT_SIZE * 0.5

export interface PdfColumn<T> {
  header: string
  value: (row: T) => unknown
  /** Relative width. Column widths are apportioned across the usable width. */
  weight?: number
}

/**
 * A single-page, table-only PDF writer.
 *
 * Scope is intentionally narrow: a title, a subtitle, and a table laid out at
 * fixed column starts. Anything richer — text wrapping, images, multiple
 * pages — needs a real typesetting engine and should use one.
 *
 * Each row is drawn as an explicit `Td` per column, so no state survives from
 * one row to the next and column alignment cannot drift.
 */
export function toPdf<T>(
  rows: T[],
  columns: PdfColumn<T>[],
  options: { title: string; subtitle?: string }
): string {
  const usable = PDF_PAGE_W - MARGIN * 2
  const totalWeight = columns.reduce((sum, c) => sum + (c.weight ?? 1), 0)
  // Absolute x offsets per column, derived once.
  const columnX: number[] = []
  let running = 0
  for (const column of columns) {
    columnX.push(running)
    running += ((column.weight ?? 1) / totalWeight) * usable
  }
  const columnW = columns.map((c) => ((c.weight ?? 1) / totalWeight) * usable)

  const ops: string[] = []
  let y = PDF_PAGE_H - MARGIN

  /** Emit one text line, optionally placed at an absolute x offset. */
  function line(text: string, opts: { bold?: boolean; size?: number; at?: number } = {}) {
    const font = opts.bold ? 'F2' : 'F1'
    const size = opts.size ?? FONT_SIZE
    const at = opts.at ?? 0
    // 1 0 0 1 x y Tm sets the text matrix absolutely — no accumulated drift.
    ops.push('BT', `/${font} ${size} Tf`, `1 0 0 1 ${(MARGIN + at).toFixed(2)} ${y.toFixed(2)} Tm`)
    ops.push(`(${escapePdf(text)}) Tj`, 'ET')
    y -= opts.size && opts.size > FONT_SIZE ? LEADING + 4 : LEADING
  }

  function tableRow(cells: string[], bold: boolean) {
    const font = bold ? 'F2' : 'F1'
    ops.push('BT', `/${font} ${FONT_SIZE} Tf`)
    for (const [index, cell] of cells.entries()) {
      const x = MARGIN + columnX[index]
      ops.push(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`, `(${escapePdf(cell)}) Tj`)
    }
    ops.push('ET')
    y -= LEADING
  }

  function rule() {
    const ry = (y + LEADING / 2).toFixed(2)
    ops.push(
      `${MARGIN} ${ry} m ${(PDF_PAGE_W - MARGIN).toFixed(2)} ${ry} l S`
    )
  }

  line(options.title, { bold: true, size: 14 })
  if (options.subtitle) line(options.subtitle, { size: 9 })
  y -= 6

  tableRow(columns.map((c, i) => fit(c.header, columnW[i])), true)
  rule()

  const available = y - MARGIN - LEADING * 3
  const maxRows = Math.max(1, Math.floor(available / LEADING))
  const shown = rows.slice(0, maxRows)

  for (const row of shown) {
    tableRow(
      columns.map((c, i) => fit(text(c.value(row)), columnW[i])),
      false
    )
  }

  if (rows.length > shown.length) {
    y -= 6
    line(`… ${rows.length - shown.length} more row(s) omitted from this page.`, { size: 8 })
  }

  return assemblePdf(ops.join('\n'))
}

export function pdfFile<T>(
  rows: T[],
  columns: PdfColumn<T>[],
  options: { title: string; subtitle?: string; basename: string }
): CsvFile {
  return {
    body: toPdf(rows, columns, options),
    contentType: 'application/pdf',
    filename: `${options.basename}-${stamp()}.pdf`,
  }
}

/** Truncate to what fits, with an ellipsis marking the cut. */
function fit(value: string, width: number): string {
  const max = Math.max(1, Math.floor(width / CHAR_W) - 1)
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

function escapePdf(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // The base-14 fonts use WinAnsi; anything outside ASCII is dropped rather
    // than emitting a byte the font cannot map. A real Unicode font is a
    // different trade-off than this helper is making.
    .replace(/[^\x20-\x7E]/g, '?')
}

/** Objects + xref, with byte offsets computed from the real content length. */
function assemblePdf(content: string): string {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_W} ${PDF_PAGE_H}] ` +
      `/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, body] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  }

  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefStart}\n%%EOF\n`

  return pdf
}

/**
 * A filename safe to put in a `Content-Disposition` header.
 *
 * Quotes and newlines in a filename are a header-injection vector, and the
 * RFC 5987 form plus a plain fallback is what every browser actually accepts.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
