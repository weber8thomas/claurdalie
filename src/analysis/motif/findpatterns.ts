// GCG FindPatterns motif search (Ordalie §4.4, GCG appendix 6.2).
//
// A pattern is compiled into a JS RegExp that runs over each sequence's
// UNGAPPED one-letter string; matches are then translated back to ALIGNED
// column ranges so the grid overlay lands on the right columns (interior gaps
// inside a match are part of the highlighted band). Pure: callers pass
// full-width gapped code rows (via store.materializeRow); no store coupling.
//
// Supported syntax:
//   literal residues (case-insensitive), ambiguity B/Z/X, () groups with
//   {min,max} repeats, comma-OR inside () (no nesting), ~ NOT (single symbol or
//   ~(A,B)), and <begin / >end anchors. Whitespace in the pattern is ignored.

import { CODE_TO_CHAR, GAP_CODE } from '../../core/alphabet'

/** Every residue LETTER (no gap) — the universe for X and for ~ negation. */
const ANY = 'ACDEFGHIKLMNPQRSTVWYBZXUO'
/** Residues an ambiguity code denotes, plus the code letter itself. */
const AMBIGUITY: Record<string, string> = {
  X: ANY,
  B: 'BDN',
  Z: 'ZEQ',
}
const RESIDUE_LETTERS = new Set(ANY.split(''))

export interface CompileOk {
  ok: true
  regex: RegExp
  source: string
  anchoredStart: boolean
  anchoredEnd: boolean
}
export interface CompileErr {
  ok: false
  error: string
}
export type Compiled = CompileOk | CompileErr

export interface RowMatches {
  /** Aligned column ranges [colStart, colEnd) — end-exclusive. */
  ranges: [number, number][]
  /** The corresponding ungapped-string ranges [uStart, uEnd). */
  ungapped: [number, number][]
}

class ParseError extends Error {}

/** Escape a set of letters into a positive character class body. */
function classOf(letters: string): string {
  return `[${letters}]`
}

/** A tiny recursive-descent parser over the whitespace-stripped, uppercased src. */
class Parser {
  private i = 0
  anchoredStart = false
  anchoredEnd = false
  constructor(private readonly s: string) {}

  parse(): string {
    if (this.s.length === 0) throw new ParseError('Empty pattern')
    let out = ''
    if (this.peek() === '<') {
      this.anchoredStart = true
      this.i++
      out += '^'
    }
    let elements = 0
    while (this.i < this.s.length) {
      const ch = this.peek()
      if (ch === '>') {
        this.anchoredEnd = true
        this.i++
        if (this.i < this.s.length) throw new ParseError("'>' is only allowed at the end")
        out += '$'
        break
      }
      if (ch === '<') throw new ParseError("'<' is only allowed at the start")
      out += this.element()
      elements++
    }
    if (elements === 0) throw new ParseError('Pattern has no residues')
    return out
  }

  private element(): string {
    const ch = this.peek()
    let atom: string
    if (ch === '(') atom = this.group()
    else if (ch === '~') atom = this.notAtom()
    else atom = this.symbol()
    const rep = this.repeat()
    return atom + rep
  }

  /** A group: (SEQ) or (SEQ,SEQ,...). Emits a single (?:…) atom. */
  private group(): string {
    this.expect('(')
    const alts: string[] = []
    let seq = ''
    for (;;) {
      const ch = this.peek()
      if (ch === undefined) throw new ParseError("Unbalanced '('")
      if (ch === '(') throw new ParseError('Nested groups are not allowed')
      if (ch === ')') {
        this.i++
        alts.push(seq)
        break
      }
      if (ch === ',') {
        this.i++
        alts.push(seq)
        seq = ''
        continue
      }
      // Only plain/ambiguity symbols inside a group (no ~, no {} on inner symbols).
      seq += this.symbolFragment()
    }
    if (alts.some((a) => a.length === 0)) throw new ParseError('Empty alternative in group')
    if (alts.length > 31) throw new ParseError('Too many alternatives in group (max 31)')
    return `(?:${alts.join('|')})`
  }

  /** ~A or ~(A,B,...) — a positive class of ANY minus the excluded letters. */
  private notAtom(): string {
    this.expect('~')
    const excluded = new Set<string>()
    if (this.peek() === '(') {
      this.i++
      for (;;) {
        const ch = this.peek()
        if (ch === undefined) throw new ParseError("Unbalanced '(' after '~'")
        if (ch === ')') {
          this.i++
          break
        }
        if (ch === ',') {
          this.i++
          continue
        }
        for (const l of this.excludedLetters()) excluded.add(l)
      }
    } else {
      for (const l of this.excludedLetters()) excluded.add(l)
    }
    if (excluded.size === 0) throw new ParseError("'~' needs a residue to negate")
    const keep = ANY.split('').filter((l) => !excluded.has(l))
    if (keep.length === 0) throw new ParseError('~ excludes every residue')
    return classOf(keep.join(''))
  }

  /** The residues a single negated symbol removes (ambiguity codes expand). */
  private excludedLetters(): string[] {
    const ch = this.next()
    if (ch === undefined || !RESIDUE_LETTERS.has(ch)) throw new ParseError(`Invalid residue: ${ch ?? 'end'}`)
    return (AMBIGUITY[ch] ?? ch).split('')
  }

  /** A single symbol as a regex atom (letter or class). */
  private symbol(): string {
    return this.symbolFragment()
  }
  private symbolFragment(): string {
    const ch = this.next()
    if (ch === undefined || !RESIDUE_LETTERS.has(ch)) throw new ParseError(`Invalid residue: ${ch ?? 'end'}`)
    const amb = AMBIGUITY[ch]
    return amb ? classOf(amb) : ch
  }

  /** Optional {min} / {min,} / {min,max} suffix. */
  private repeat(): string {
    if (this.peek() !== '{') return ''
    this.i++
    let body = ''
    for (;;) {
      const ch = this.next()
      if (ch === undefined) throw new ParseError("Unbalanced '{'")
      if (ch === '}') break
      body += ch
    }
    const m = /^(\d+)(?:,(\d*))?$/.exec(body)
    if (!m) throw new ParseError(`Invalid repeat: {${body}}`)
    const min = Number(m[1])
    if (m[2] === undefined) return `{${min}}`
    if (m[2] === '') return `{${min},}`
    const max = Number(m[2])
    if (max < min) throw new ParseError(`Repeat max < min: {${body}}`)
    return `{${min},${max}}`
  }

  private peek(): string | undefined {
    return this.s[this.i]
  }
  private next(): string | undefined {
    return this.s[this.i++]
  }
  private expect(ch: string): void {
    if (this.next() !== ch) throw new ParseError(`Expected '${ch}'`)
  }
}

/** Compile a FindPatterns pattern into a global RegExp (never throws). */
export function compilePattern(src: string): Compiled {
  const cleaned = src.replace(/\s+/g, '').toUpperCase()
  if (cleaned.length === 0) return { ok: false, error: 'Empty pattern' }
  try {
    const p = new Parser(cleaned)
    const source = p.parse()
    const regex = new RegExp(source, 'g')
    return { ok: true, regex, source, anchoredStart: p.anchoredStart, anchoredEnd: p.anchoredEnd }
  } catch (e) {
    return { ok: false, error: e instanceof ParseError ? e.message : String((e as Error)?.message ?? e) }
  }
}

/** Build a row's ungapped uppercase string plus each position's aligned column. */
export function buildUngapped(row: Uint8Array): { seq: string; colOf: Int32Array } {
  let seq = ''
  const cols: number[] = []
  for (let c = 0; c < row.length; c++) {
    if (row[c] === GAP_CODE) continue
    seq += CODE_TO_CHAR[row[c]] ?? 'X'
    cols.push(c)
  }
  return { seq, colOf: Int32Array.from(cols) }
}

/** Find all non-overlapping matches per row, as aligned column ranges. */
export function findMatches(rows: Uint8Array[], compiled: CompileOk): RowMatches[] {
  return rows.map((row) => {
    const { seq, colOf } = buildUngapped(row)
    const ranges: [number, number][] = []
    const ungapped: [number, number][] = []
    const re = compiled.regex
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(seq)) !== null) {
      const uStart = m.index
      const uEnd = uStart + m[0].length
      if (m[0].length === 0) {
        re.lastIndex++ // zero-length match — advance to avoid an infinite loop
        continue
      }
      const colStart = colOf[uStart]
      const colEnd = colOf[uEnd - 1] + 1
      ranges.push([colStart, colEnd])
      ungapped.push([uStart, uEnd])
    }
    return { ranges, ungapped }
  })
}
