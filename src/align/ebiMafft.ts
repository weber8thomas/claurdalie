// Optional online re-alignment via the EMBL-EBI Job Dispatcher (MAFFT).
//
// The Job Dispatcher is an async REST API: submit → poll status → fetch result.
// It requires network access AND permissive CORS, neither of which a static,
// offline-first app can assume — so a fetch rejection (the classic CORS/offline
// signature) maps to AlignError('blocked'), and a non-OK HTTP response maps to
// AlignError('network'). The transport is injectable so the error mapping is
// unit-testable without touching the real endpoint.

import { parseFasta } from '../core/io/fasta'
import type { Aligner, AlignInput, AlignedSeq, AlignOptions } from './types'
import { AlignError } from './types'

const EBI_BASE = 'https://www.ebi.ac.uk/Tools/services/rest/mafft'
const MAX_SEQUENCES = 500
const POLL_INTERVAL_MS = 1500
const MAX_POLLS = 200

type FetchImpl = typeof fetch

export interface EbiMafftOptions {
  base?: string
  /** EBI requires a contact email; overridable per deployment. */
  email?: string
  fetchImpl?: FetchImpl
}

export class EbiMafftAligner implements Aligner {
  readonly id = 'ebi-mafft'
  readonly label = 'MAFFT (EMBL-EBI, online)'
  readonly needsNetwork = true
  readonly maxSequences = MAX_SEQUENCES

  private readonly base: string
  private readonly email: string
  private readonly fetchImpl: FetchImpl

  constructor(opts: EbiMafftOptions = {}) {
    this.base = opts.base ?? EBI_BASE
    this.email = opts.email ?? 'claurdalie@example.org'
    this.fetchImpl = opts.fetchImpl ?? ((...a: Parameters<FetchImpl>) => fetch(...a))
  }

  async align(
    seqs: AlignInput[],
    _opts?: AlignOptions,
    signal?: AbortSignal,
    onProgress?: (message: string) => void,
  ): Promise<AlignedSeq[]> {
    if (seqs.length > MAX_SEQUENCES) {
      throw new AlignError('too-long', `EBI MAFFT accepts at most ${MAX_SEQUENCES} sequences (${seqs.length} given)`)
    }
    const fasta = seqs.map((s, i) => `>s${i}\n${s.sequence}`).join('\n') + '\n'

    onProgress?.('Submitting to EMBL-EBI…')
    const jobId = await this.submit(fasta, signal)

    onProgress?.('Waiting for EMBL-EBI…')
    await this.poll(jobId, signal, onProgress)

    onProgress?.('Fetching result…')
    const out = await this.fetchResult(jobId, signal)
    return mapAligned(seqs, out)
  }

  private async submit(fasta: string, signal?: AbortSignal): Promise<string> {
    const body = new URLSearchParams({ email: this.email, stype: 'protein', sequence: fasta })
    const res = await this.request(`${this.base}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/plain' },
      body,
      signal,
    })
    if (!res.ok) throw new AlignError('network', `EBI submit returned HTTP ${res.status}`)
    return (await res.text()).trim()
  }

  private async poll(jobId: string, signal?: AbortSignal, onProgress?: (m: string) => void): Promise<void> {
    for (let i = 0; i < MAX_POLLS; i++) {
      const res = await this.request(`${this.base}/status/${jobId}`, { headers: { Accept: 'text/plain' }, signal })
      if (!res.ok) throw new AlignError('network', `EBI status returned HTTP ${res.status}`)
      const status = (await res.text()).trim()
      if (status === 'FINISHED') return
      if (status === 'ERROR' || status === 'FAILURE' || status === 'NOT_FOUND') {
        throw new AlignError('network', `EBI job ${status.toLowerCase()}`)
      }
      onProgress?.(`Waiting for EMBL-EBI (${status.toLowerCase()})…`)
      await sleep(POLL_INTERVAL_MS, signal)
    }
    throw new AlignError('network', 'EBI job timed out')
  }

  private async fetchResult(jobId: string, signal?: AbortSignal): Promise<string> {
    const res = await this.request(`${this.base}/result/${jobId}/aln-fasta`, {
      headers: { Accept: 'text/plain' },
      signal,
    })
    if (!res.ok) throw new AlignError('network', `EBI result returned HTTP ${res.status}`)
    return res.text()
  }

  /** A fetch whose rejection (CORS/offline) is normalized to AlignError('blocked'). */
  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init)
    } catch (e) {
      if (init.signal?.aborted) throw e // let aborts propagate as cancellation
      throw new AlignError('blocked', 'Could not reach EMBL-EBI — blocked by CORS/network policy or offline')
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function mapAligned(seqs: AlignInput[], outFasta: string): AlignedSeq[] {
  const byIndex = new Map<number, Uint8Array>()
  for (const rec of parseFasta(outFasta)) {
    const m = /^s(\d+)$/.exec(rec.name.trim())
    if (m) byIndex.set(Number(m[1]), rec.codes)
  }
  return seqs.map((s, i) => {
    const codes = byIndex.get(i)
    if (!codes) throw new AlignError('network', 'EBI result was incomplete')
    return { name: s.name, codes }
  })
}
