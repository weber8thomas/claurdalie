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
/** The CDN module may expose the constructor as default, named, or itself. */
type AioliModule = { default?: unknown; Aioli?: unknown } | unknown
type AioliLoader = () => Promise<AioliModule>

/** biowasm tool spec — `<tool>/<version>`; overridable if the version drifts. */
const KALIGN_TOOL = 'kalign/3.3.1'

/** Short, single-line reason from an unknown thrown value (for panel + logs). */
function reason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/\s+/g, ' ').slice(0, 160)
}

export class AioliKalignAligner implements Aligner {
  readonly id = 'kalign'
  readonly label = 'Kalign (WASM)'
  /** Fetches the WASM module from the CDN on first use. */
  readonly needsNetwork = true
  readonly maxSequences = MAX_SEQUENCES

  private cli: Promise<AioliCLI> | null = null

  constructor(
    private readonly loader: AioliLoader = () => import(/* @vite-ignore */ AIOLI_CDN),
    private readonly tool: string = KALIGN_TOOL,
  ) {}

  private getCLI(): Promise<AioliCLI> {
    if (this.cli) return this.cli
    this.cli = (async () => {
      // 1. Load the Aioli module from the CDN.
      let mod: AioliModule
      try {
        mod = await this.loader()
      } catch (e) {
        console.error('[kalign] failed to load Aioli from', AIOLI_CDN, e)
        throw new AlignError('unavailable', `Could not load the Kalign module — ${reason(e)}`)
      }
      // 2. Resolve the constructor (default / named / the module itself).
      const m = mod as { default?: unknown; Aioli?: unknown }
      const ctor = (m?.default ?? m?.Aioli ?? mod) as AioliCtor
      if (typeof ctor !== 'function') {
        console.error('[kalign] Aioli module has no constructor export', mod)
        throw new AlignError('unavailable', 'Kalign module loaded but exposed no Aioli constructor')
      }
      // 3. Initialize the WASM tool (fetches the tool config + wasm from the CDN).
      try {
        return await new ctor(this.tool)
      } catch (e) {
        // The real cause (e.g. a 404 for the tool version, or a worker error) is
        // logged here AND folded into the message so it shows in the panel.
        console.error('[kalign] Aioli failed to initialize', this.tool, e)
        throw new AlignError('unavailable', `Kalign WASM failed to initialize — ${reason(e)}`)
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
      console.error('[kalign] run failed', e)
      throw new AlignError('unavailable', `Kalign run failed — ${reason(e)}`)
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
