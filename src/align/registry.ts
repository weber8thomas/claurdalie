// The set of available aligners, in display order — mirrors the color-scheme and
// structure-source registries. The first entry is the default. Kalign (WASM) is
// preferred because it needs no server; EBI MAFFT is the online fallback.

import type { Aligner } from './types'
import { AioliKalignAligner } from './kalign'
import { EbiMafftAligner } from './ebiMafft'

export const ALIGNERS: Aligner[] = [new AioliKalignAligner(), new EbiMafftAligner()]

export function alignerById(id: string): Aligner | undefined {
  return ALIGNERS.find((a) => a.id === id)
}
