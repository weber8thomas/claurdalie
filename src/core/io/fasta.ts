import { charCodeToResidue, CODE_TO_CHAR } from '../alphabet'

export interface ParsedSequence {
  name: string
  codes: Uint8Array
}

/**
 * Parse FASTA text into sequences of residue codes.
 * Tolerant of CRLF, blank lines, leading whitespace, and missing trailing newline.
 */
export function parseFasta(text: string): ParsedSequence[] {
  const seqs: ParsedSequence[] = []
  let name: string | null = null
  let chunks: Uint8Array[] = []
  let chunk = new Uint8Array(1024)
  let len = 0

  const flush = () => {
    if (name === null) return
    let total = len
    for (const c of chunks) total += c.length
    const codes = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      codes.set(c, off)
      off += c.length
    }
    codes.set(chunk.subarray(0, len), off)
    seqs.push({ name, codes })
    name = null
    chunks = []
    chunk = new Uint8Array(1024)
    len = 0
  }

  let i = 0
  const n = text.length
  while (i < n) {
    // Read a line.
    let lineStart = i
    while (i < n && text[i] !== '\n') i++
    let lineEnd = i
    if (lineEnd > lineStart && text[lineEnd - 1] === '\r') lineEnd--
    i++ // skip newline

    if (lineEnd === lineStart) continue // blank line
    const first = text[lineStart]
    if (first === '>' || first === ';') {
      flush()
      name = text.slice(lineStart + 1, lineEnd).trim()
    } else if (name !== null) {
      for (let j = lineStart; j < lineEnd; j++) {
        const ch = text.charCodeAt(j)
        if (ch === 32 || ch === 9) continue // skip spaces/tabs within sequence
        if (len === chunk.length) {
          chunks.push(chunk)
          chunk = new Uint8Array(chunk.length * 2)
          len = 0
        }
        chunk[len++] = charCodeToResidue(ch)
      }
    }
  }
  flush()
  return seqs
}

/** Serialize sequences (residue codes) back to FASTA, wrapping at `width`. */
export function serializeFasta(seqs: ParsedSequence[], width = 60): string {
  const out: string[] = []
  for (const s of seqs) {
    out.push('>' + s.name)
    let line = ''
    for (let i = 0; i < s.codes.length; i++) {
      line += CODE_TO_CHAR[s.codes[i]]
      if (line.length === width) {
        out.push(line)
        line = ''
      }
    }
    if (line.length) out.push(line)
  }
  return out.join('\n') + '\n'
}
