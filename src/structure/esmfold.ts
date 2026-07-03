// Live folding via the public ESMFold (ESM Atlas) endpoint.
//
// One POST of a raw sequence returns a PDB with pLDDT in the B-factor column —
// no MSA required, results in seconds, which is what makes it feel "real-time".
// Caveats are real and surfaced as typed FoldErrors: a ~400-residue cap, rate
// limits, and — critically for a static/offline-first app — CORS. Whether the
// browser is allowed to call this from a given origin can only be confirmed at
// runtime; a blocked request maps to FoldError('blocked') so the panel can tell
// the user to use an offline source instead.

import type { StructureSource } from './types'
import { FoldError } from './types'
import { structureFromPdb } from './pdb'

const ESMFOLD_ENDPOINT = 'https://api.esmatlas.com/foldSequence/v1/pdb/'
/** ESMFold's documented single-sequence residue limit. */
const MAX_RESIDUES = 400

export class EsmFoldSource implements StructureSource {
  readonly id = 'esmfold'
  readonly label = 'ESMFold (online)'
  readonly needsNetwork = true
  readonly maxResidues = MAX_RESIDUES

  constructor(private readonly endpoint: string = ESMFOLD_ENDPOINT) {}

  async fold(sequence: string, signal?: AbortSignal): Promise<import('./types').Structure> {
    if (sequence.length === 0) {
      throw new FoldError('empty', 'Nothing to fold — the sequence has no residues')
    }
    if (sequence.length > MAX_RESIDUES) {
      throw new FoldError(
        'too-long',
        `Sequence is ${sequence.length} residues; ESMFold accepts at most ${MAX_RESIDUES}`,
      )
    }

    let res: Response
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: sequence,
        signal,
      })
    } catch (e) {
      if (signal?.aborted) throw e // let the controller treat aborts as cancellation
      // A network/CORS failure surfaces as a TypeError with no response.
      throw new FoldError(
        'blocked',
        'Could not reach ESMFold — it may be blocked by CORS/network policy or offline',
      )
    }

    if (!res.ok) {
      const kind = res.status === 403 || res.status === 401 ? 'blocked' : 'network'
      throw new FoldError(kind, `ESMFold returned HTTP ${res.status}`)
    }

    const pdb = await res.text()
    if (!pdb.includes('ATOM')) {
      throw new FoldError('invalid', 'ESMFold response did not contain a structure')
    }
    return structureFromPdb(pdb, 'ESMFold')
  }
}
