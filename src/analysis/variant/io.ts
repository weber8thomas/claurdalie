// Lightweight variants file I/O — CSV or TSV, columns: seq,pos,from,to,label.
//
// Deliberately dependency-free and tolerant: an optional header is auto-detected
// and skipped, blank and `#` comment lines are ignored, the delimiter (comma or
// tab) is sniffed per line, and a malformed row records a per-line error instead
// of aborting the whole import. `formatVariants` round-trips `parseVariants`.

import type { Variant } from './types'

export interface ParseError {
  line: number // 1-based line number in the input
  message: string
}

export interface ParseResult {
  variants: Variant[]
  errors: ParseError[]
}

const HEADER_FIELDS = new Set(['seq', 'pos', 'from', 'to', 'label'])

function splitFields(line: string): string[] {
  // Sniff the delimiter: a tab if present, else a comma.
  const delim = line.includes('\t') ? '\t' : ','
  return line.split(delim).map((f) => f.trim())
}

function looksLikeHeader(fields: string[]): boolean {
  // A header row is all known field names (in any order/subset), never numeric.
  return fields.length >= 2 && fields.every((f) => HEADER_FIELDS.has(f.toLowerCase()))
}

/** Is `s` a single residue letter or a gap? (validation for `from`/`to`). */
function isResidue(s: string): boolean {
  return /^[A-Za-z*-]$/.test(s)
}

/**
 * Parse a CSV/TSV variants file into typed Variants + per-line errors. Expected
 * column order: seq, pos, from, to, label — `from` and `label` may be blank.
 */
export function parseVariants(text: string): ParseResult {
  const variants: Variant[] = []
  const errors: ParseError[] = []
  const lines = text.split(/\r?\n/)

  lines.forEach((raw, i) => {
    const lineNo = i + 1
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const fields = splitFields(line)
    if (i === 0 && looksLikeHeader(fields)) return // skip a header on the first line

    if (fields.length < 3) {
      errors.push({ line: lineNo, message: `expected at least seq,pos,to — got ${fields.length} field(s)` })
      return
    }
    // Canonical layout is seq,pos,from,to,label. A 3-field short form
    // seq,pos,to omits the reference residue (the scorer falls back to the
    // column consensus).
    const [seqName, posStr, third, fourth, ...rest] = fields
    let from: string | undefined
    let to: string
    let label: string | undefined
    if (fields.length === 3) {
      from = undefined
      to = third
      label = undefined
    } else {
      from = third ? third.toUpperCase() : undefined
      to = fourth
      label = rest.length ? rest.join(' ') : undefined
    }

    if (!seqName) {
      errors.push({ line: lineNo, message: 'missing sequence name' })
      return
    }
    const pos = Number(posStr)
    if (!Number.isInteger(pos) || pos < 1) {
      errors.push({ line: lineNo, message: `position "${posStr}" is not a positive integer` })
      return
    }
    if (!to || !isResidue(to)) {
      errors.push({ line: lineNo, message: `alt residue "${to ?? ''}" is not a single residue` })
      return
    }
    if (from && !isResidue(from)) {
      errors.push({ line: lineNo, message: `ref residue "${from}" is not a single residue` })
      return
    }

    variants.push({
      seqName,
      position: pos,
      from: from ? from.toUpperCase() : undefined,
      to: to === '-' ? '-' : to.toUpperCase(),
      label: label || undefined,
    })
  })

  return { variants, errors }
}

/** Serialize variants to CSV (header + one row each). Round-trips parseVariants. */
export function formatVariants(variants: Variant[]): string {
  const rows = variants.map((v) => [v.seqName, String(v.position), v.from ?? '', v.to, v.label ?? ''].join(','))
  return ['seq,pos,from,to,label', ...rows].join('\n')
}
