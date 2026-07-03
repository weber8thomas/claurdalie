// Offline structure source: a user-supplied PDB file.
//
// This path needs no network, so it works under the app's original "nothing is
// uploaded, works offline" promise and is the graceful fallback whenever
// ESMFold is blocked or a sequence exceeds the fold cap. It is not tied to the
// alignment sequence — the user vouches that the file corresponds to the
// reference row — so residue↔column linking is best-effort on residue order.

import { structureFromPdb } from './pdb'

/** Parse uploaded PDB text into a Structure (throws FoldError on garbage). */
export function structureFromFile(pdbText: string, fileName: string): import('./types').Structure {
  return structureFromPdb(pdbText, `file: ${fileName}`)
}
