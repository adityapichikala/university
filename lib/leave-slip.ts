import { deflateSync } from 'node:zlib'
import QRCode from 'qrcode'

/**
 * Hostel leave slip: the QR payload, and the downloadable PDF.
 *
 * The QR encodes the facts the slip asserts, so a guard who scans it can see
 * the same dates and status the paper shows. That is what makes the slip
 * tamper-evident in practice: altering the printed dates no longer matches the
 * code printed beside them.
 *
 * There is no public verification endpoint on purpose. A URL in the QR would
 * have to be readable by someone with no account, which means exposing a
 * student's leave record to anyone who guesses an id. A self-describing payload
 * needs no such endpoint and leaks nothing that is not already on the paper.
 */

/** Short, quotable slip id. Derived from the row id, never invented. */
export function leaveSlipReference(id: string): string {
  return `LS-${id.slice(-8).toUpperCase()}`
}

export interface LeaveSlipFacts {
  id: string
  studentName: string
  regno: string
  roomLabel: string | null
  block: string | null
  fromDate: string
  toDate: string
  nights: number
  reason: string
  status: string
  decidedByName: string | null
  decidedAt: string | null
  note: string | null
}

/**
 * Pipe-delimited, uppercase, no whitespace runs — a compact and scannable
 * payload. Prefixed so a scan is self-identifying rather than looking like
 * arbitrary text.
 */
export function leaveSlipPayload(facts: LeaveSlipFacts): string {
  return [
    'APEX-HOSTEL-LEAVE',
    leaveSlipReference(facts.id),
    facts.regno,
    facts.fromDate,
    facts.toDate,
    String(facts.nights),
    facts.status.toUpperCase(),
  ].join('|')
}

/** The QR as an SVG string — crisp at any size, and no bitmap encoder needed. */
export async function leaveSlipQrSvg(facts: LeaveSlipFacts): Promise<string> {
  return QRCode.toString(leaveSlipPayload(facts), {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  })
}

/** The same QR as a data URL, so it can sit in an <img> without innerHTML. */
export async function leaveSlipQrDataUrl(facts: LeaveSlipFacts): Promise<string> {
  const svg = await leaveSlipQrSvg(facts)
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

// ── Downloadable PDF ────────────────────────────────────────────────────────

const PAGE_W = 595 // A4 portrait
const PAGE_H = 842
const MARGIN = 48
const QR_SCALE = 5 // points per module

/**
 * Render the slip as a one-page PDF with the QR embedded as an image.
 *
 * The QR goes in as a 1-bit Flate-compressed image XObject built from the
 * module matrix directly. That avoids a PNG encoder and, more importantly,
 * keeps the code in the PDF exactly the code on screen — the two cannot drift,
 * because both come from the same matrix.
 */
export function buildLeaveSlipPdf(facts: LeaveSlipFacts): Buffer {
  const qr = QRCode.create(leaveSlipPayload(facts), { errorCorrectionLevel: 'M' })
  const size = qr.modules.size
  const modules = qr.modules.data
  const qrPoints = size * QR_SCALE

  const qrImage = buildQrImageXObject(size, modules, QR_SCALE)

  const ops: string[] = []
  let y = PAGE_H - MARGIN

  function text(value: string, opts: { size?: number; bold?: boolean; x?: number; dy?: number } = {}) {
    const sz = opts.size ?? 10
    const font = opts.bold ? 'F2' : 'F1'
    const x = MARGIN + (opts.x ?? 0)
    y -= opts.dy ?? 0
    ops.push(
      'BT',
      `/${font} ${sz} Tf`,
      `1 0 0 1 ${x} ${y.toFixed(2)} Tm`,
      `(${escapePdf(value)}) Tj`,
      'ET'
    )
  }

  function rule() {
    ops.push(`${MARGIN} ${y.toFixed(2)} m ${PAGE_W - MARGIN} ${y.toFixed(2)} l S`)
  }

  // ── Header ────────────────────────────────────────────────────────────────
  text('Apex University', { size: 18, bold: true })
  text('Office of the Hostel Warden', { size: 9 })
  y -= 8
  text('HOSTEL LEAVE SLIP', { size: 11, bold: true })
  text(leaveSlipReference(facts.id), { size: 9 })
  y -= 6
  rule()
  y -= 20

  // ── Details, two columns ──────────────────────────────────────────────────
  const left = [
    ['Student', facts.studentName],
    ['Registration no.', facts.regno],
    ['Room', facts.roomLabel ?? 'Not allocated'],
  ]
  const right = [
    ['Block', facts.block ?? '—'],
    ['Departure', facts.fromDate],
    ['Return', facts.toDate],
  ]

  for (let i = 0; i < left.length; i += 1) {
    const rowY = y
    text(left[i][0].toUpperCase(), { size: 7, x: 0, dy: 0 })
    text(left[i][1], { size: 10, x: 0, dy: 11 })
    y = rowY
    text(right[i][0].toUpperCase(), { size: 7, x: 260 })
    text(right[i][1], { size: 10, x: 260, dy: 11 })
    y -= 30
  }

  text('NIGHTS', { size: 7 })
  text(String(facts.nights), { size: 10, dy: 11 })
  y -= 30

  // ── Reason ────────────────────────────────────────────────────────────────
  text('REASON', { size: 7 })
  for (const line of wrap(facts.reason, 92)) {
    text(line, { size: 10, dy: 12 })
  }
  y -= 10

  // ── Acceptance ────────────────────────────────────────────────────────────
  rule()
  y -= 16
  text('ACCEPTANCE', { size: 7 })
  text(
    facts.status.toUpperCase() === 'APPROVED' ? 'Accepted by the warden' : facts.status,
    { size: 11, bold: true, dy: 12 }
  )
  if (facts.decidedByName) text(`By ${facts.decidedByName}`, { size: 9, dy: 12 })
  if (facts.decidedAt) text(`On ${facts.decidedAt}`, { size: 9, dy: 12 })
  if (facts.note) {
    for (const line of wrap(`Note: ${facts.note}`, 92)) text(line, { size: 9, dy: 12 })
  }

  // ── QR, bottom-right ──────────────────────────────────────────────────────
  const qrX = PAGE_W - MARGIN - qrPoints
  const qrY = MARGIN + 40
  ops.push(
    'q',
    `${qrPoints} 0 0 ${qrPoints} ${qrX.toFixed(2)} ${qrY.toFixed(2)} cm`,
    '/QR Do',
    'Q'
  )
  ops.push(
    'BT',
    '/F1 7 Tf',
    `1 0 0 1 ${qrX.toFixed(2)} ${(qrY - 10).toFixed(2)} Tm`,
    `(${escapePdf('Scan to verify')}) Tj`,
    'ET'
  )

  // ── Footer ────────────────────────────────────────────────────────────────
  ops.push(
    'BT',
    '/F1 8 Tf',
    `1 0 0 1 ${MARGIN} ${(MARGIN + 20).toFixed(2)} Tm`,
    `(${escapePdf('Present this slip at the gate on departure and on return. Valid only for the dates shown.')}) Tj`,
    'ET'
  )

  return assembleSlipPdf(ops.join('\n'), qrImage)
}

/**
 * Build the QR as a 1-bit DeviceGray image XObject.
 *
 * `BitsPerComponent 1` with `/Decode [1 0]` means a set bit renders black,
 * which is the conventional QR polarity. Rows are padded to a byte boundary as
 * the PDF spec requires — getting that wrong shears the image.
 */
function buildQrImageXObject(
  size: number,
  modules: Uint8Array,
  scale: number
): { dict: string; stream: Buffer } {
  const dim = size * scale
  const rowBytes = Math.ceil(dim / 8)
  const raw = Buffer.alloc(rowBytes * dim)

  for (let my = 0; my < size; my += 1) {
    for (let mx = 0; mx < size; mx += 1) {
      // qrcode stores 1 for a dark module.
      if (!modules[my * size + mx]) continue
      for (let sy = 0; sy < scale; sy += 1) {
        const py = my * scale + sy
        for (let sx = 0; sx < scale; sx += 1) {
          const px = mx * scale + sx
          const byteIndex = py * rowBytes + (px >> 3)
          // Most-significant bit first.
          raw[byteIndex] |= 0x80 >> (px & 7)
        }
      }
    }
  }

  const compressed = deflateSync(raw)

  return {
    dict:
      `<< /Type /XObject /Subtype /Image /Width ${dim} /Height ${dim} ` +
      `/ColorSpace /DeviceGray /BitsPerComponent 1 /Decode [1 0] ` +
      `/Filter /FlateDecode /Length ${compressed.length} >>`,
    stream: compressed,
  }
}

/** Wrap the content stream and the QR image into a valid single-page PDF. */
function assembleSlipPdf(content: string, qr: { dict: string; stream: Buffer }): Buffer {
  const contentBuf = Buffer.from(content, 'latin1')

  const parts: Buffer[] = []
  const offsets: number[] = []
  let cursor = 0

  function push(chunk: Buffer | string) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk
    parts.push(buf)
    cursor += buf.length
  }

  function object(body: Buffer | string) {
    offsets.push(cursor)
    push(`${offsets.length} 0 obj\n`)
    push(body)
    push('\nendobj\n')
  }

  push('%PDF-1.4\n')
  object('<< /Type /Catalog /Pages 2 0 R >>')
  object('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /QR 6 0 R >> >> ` +
      `/Contents 7 0 R >>`
  )
  object('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  object('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
  object(Buffer.concat([Buffer.from(`${qr.dict}\nstream\n`, 'latin1'), qr.stream, Buffer.from('\nendstream', 'latin1')]))
  object(Buffer.concat([Buffer.from(`<< /Length ${contentBuf.length} >>\nstream\n`, 'latin1'), contentBuf, Buffer.from('\nendstream', 'latin1')]))

  const xrefStart = cursor
  push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`)
  for (const offset of offsets) push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)

  return Buffer.concat(parts)
}

/** Greedy word wrap; the base-14 fonts are proportional, so this is approximate. */
function wrap(value: string, maxChars: number): string[] {
  const out: string[] = []
  for (const paragraph of value.split('\n')) {
    if (paragraph.trim() === '') continue
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      if (line === '') line = word
      else if (`${line} ${word}`.length <= maxChars) line = `${line} ${word}`
      else {
        out.push(line)
        line = word
      }
    }
    if (line) out.push(line)
  }
  return out.length > 0 ? out : ['']
}

function escapePdf(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // The base-14 fonts are WinAnsi; anything outside ASCII becomes a
    // placeholder rather than an unmapped byte.
    .replace(/[^\x20-\x7E]/g, '?')
}
