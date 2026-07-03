// Kalign compiled to WASM, run via biowasm Aioli.
//
// Aioli is loaded by a DYNAMIC import of its CDN ESM bundle, so the editor's
// cold start is unaffected and there is NO npm dependency to bundle — the build
// stays clean and the app stays offline-safe. Aioli runs kalign in its own Web
// Worker, single-threaded, which works fine with crossOriginIsolated=false (we
// never set COOP/COEP). If the CDN/module can't be reached, every failure maps
// to AlignError('unavailable') so the panel can tell the user to try elsewhere.

import { parseFasta } from '../core/io/fasta'
import type { Aligner, AlignInput, AlignedSeq, AlignOptions } from './types'
import { AlignError } from './types'

/** Aioli v3 ESM bundle. */
const AIOLI_CDN = 'https://biowasm.com/cdn/v3/aioli.js'
const MAX_SEQUENCES = 500

/** The slice of Aioli's API we use (kept minimal + defensive). */
interface AioliCLI {
  mount(files: { name: string; data: string }[]): Promise<unknown>
  exec(command: string): Promise<unknown>
  cat(path: string): Promise<string>
}
type AioliCtor = { new (tool: string): Promise<AioliCLI> }
type AioliLoader = () => Promise<{ default: AioliCtor }>

export class AioliKalignAligner implements Aligner {
  readonly id = 'kalign'
  readonly label = 'Kalign (WASM)'
  /** Fetches the WASM module from the CDN on first use. */
  readonly needsNetwork = true
  readonly maxSequences = MAX_SEQUENCES

  private cli: Promise<AioliCLI> | null = null

  constructor(private readonly loader: AioliLoader = () => import(/* @vite-ignore */ AIOLI_CDN)) {}

  private getCLI(): Promise<AioliCLI> {
    if (this.cli) return this.cli
    this.cli = (async () => {
      let Aioli: AioliCtor
      try {
        Aioli = (await this.loader()).default
      } catch {
        throw new AlignError('unavailable', 'Could not load the Kalign module (CDN blocked or offline)')
      }
      try {
        return await new Aioli('kalign/3.3.1')
      } catch {
        throw new AlignError('unavailable', 'Kalign WASM failed to initialize')
      }
    })()
    // Allow a later retry if initialization fails.
    this.cli.catch(() => {
      this.cli = null
    })
    return this.cli
  }

  async align(
    seqs: AlignInput[],
    _opts?: AlignOptions,
    signal?: AbortSignal,
    onProgress?: (message: string) => void,
  ): Promise<AlignedSeq[]> {
    if (seqs.length > MAX_SEQUENCES) {
      throw new AlignError('too-long', `Kalign accepts at most ${MAX_SEQUENCES} sequences (${seqs.length} given)`)
    }
    onProgress?.('Loading Kalign…')
    const cli = await this.getCLI()
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // Index-based labels so the original names can't collide or be truncated.
    const fasta = seqs.map((s, i) => `>s${i}\n${s.sequence}`).join('\n') + '\n'
    onProgress?.('Aligning…')
    try {
      await cli.mount([{ name: 'input.fa', data: fasta }])
      await cli.exec('kalign -i input.fa -o output.fa -f fasta')
      const out = await cli.cat('output.fa')
      return mapAligned(seqs, out)
    } catch (e) {
      if (e instanceof AlignError) throw e
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      throw new AlignError('unavailable', 'Kalign run failed')
    }
  }
}

/** Match kalign's output FASTA (labelled `s0`,`s1`,…) back to the input order. */
function mapAligned(seqs: AlignInput[], outFasta: string): AlignedSeq[] {
  const byIndex = new Map<number, Uint8Array>()
  for (const rec of parseFasta(outFasta)) {
    const m = /^s(\d+)$/.exec(rec.name.trim())
    if (m) byIndex.set(Number(m[1]), rec.codes)
  }
  return seqs.map((s, i) => {
    const codes = byIndex.get(i)
    if (!codes) throw new AlignError('unavailable', 'Kalign output was incomplete')
    return { name: s.name, codes }
  })
}
