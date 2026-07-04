// Optional EXTERNAL mutation-effect scorer — a protein-language-model / variant-
// effect endpoint stub.
//
// A real ESM/PLM variant-effect service (e.g. an ESM-1v masked-marginals or a
// ProteinGym-style API) would take a wild-type sequence + a list of point
// substitutions and return a per-variant log-likelihood-ratio, which we map to
// the same 0..100 impact scale as the local scorer. This module defines that
// contract and the request/response shape so a real endpoint slots in by
// setting one URL — but it hard-depends on NOTHING network: with no endpoint
// configured it throws VariantEffectError('unavailable') and the UI degrades to
// the local scorer, and any fetch failure maps to a typed error exactly like
// structure/esmfold.ts (blocked / network / invalid), so the offline UX matches.

import {
  VariantEffectError,
  type Variant,
  type VariantContext,
  type VariantEffectSource,
  type VariantScore,
} from './types'

/**
 * The endpoint a real deployment would point at. Left empty on purpose: a fork
 * that wires a PLM service sets this (or passes one to `makePlmScorer`) and the
 * scorer starts making requests; until then it degrades gracefully.
 */
const PLM_ENDPOINT = ''

/** Largest batch the (hypothetical) endpoint accepts in one request. */
const MAX_VARIANTS = 256

/** The request body a real endpoint would receive (one wild-type + its variants). */
interface PlmRequest {
  seqName: string
  /** 1-based ungapped substitutions on that sequence. */
  variants: { position: number; from?: string; to: string }[]
}

/** The response a real endpoint would return: a score in 0..100 per variant. */
interface PlmResponse {
  scores: { position: number; to: string; score: number; confidence?: number }[]
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/**
 * Build a PLM-endpoint scorer. Pass an endpoint URL to activate it; with the
 * default empty URL every call rejects with VariantEffectError('unavailable').
 */
export function makePlmScorer(endpoint: string = PLM_ENDPOINT): VariantEffectSource {
  return {
    id: 'plm',
    label: 'PLM endpoint (online)',
    needsNetwork: true,
    maxVariants: MAX_VARIANTS,
    async score(variants: Variant[], _ctx: VariantContext, signal?: AbortSignal): Promise<VariantScore[]> {
      if (!endpoint) {
        throw new VariantEffectError(
          'unavailable',
          'No PLM endpoint configured — use the Local scorer, or wire a variant-effect API URL',
        )
      }
      if (variants.length === 0) return []
      if (variants.length > MAX_VARIANTS) {
        throw new VariantEffectError(
          'too-long',
          `${variants.length} variants exceeds the endpoint's cap of ${MAX_VARIANTS}`,
        )
      }

      // All variants in a batch share a sequence (the model groups by seqName).
      const body: PlmRequest = {
        seqName: variants[0].seqName,
        variants: variants.map((v) => ({ position: v.position, from: v.from, to: v.to })),
      }

      let res: Response
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        })
      } catch (e) {
        if (signal?.aborted) throw e // aborts are cancellation, not a scoring error
        // A network/CORS failure surfaces as a TypeError with no response.
        throw new VariantEffectError(
          'blocked',
          'Could not reach the PLM endpoint — it may be blocked by CORS/network policy or offline',
        )
      }

      if (!res.ok) {
        const kind = res.status === 403 || res.status === 401 ? 'blocked' : 'network'
        throw new VariantEffectError(kind, `PLM endpoint returned HTTP ${res.status}`)
      }

      let payload: PlmResponse
      try {
        payload = (await res.json()) as PlmResponse
      } catch {
        throw new VariantEffectError('invalid', 'PLM endpoint returned a non-JSON response')
      }
      if (!payload || !Array.isArray(payload.scores)) {
        throw new VariantEffectError('invalid', 'PLM endpoint response was missing a scores array')
      }

      // Match returned scores back to the requested variants by position+alt.
      const byKey = new Map(payload.scores.map((s) => [`${s.position} ${s.to}`, s]))
      return variants.map((v) => {
        const hit = byKey.get(`${v.position} ${v.to}`)
        const column = _ctx.map ? _ctx.map.columnOfResidue(v.position - 1) : null
        if (!hit) {
          return { variant: v, column, score: 0, confidence: 0, note: 'no score returned for this variant' }
        }
        return {
          variant: v,
          column,
          score: clamp(Math.round(hit.score), 0, 100),
          confidence: hit.confidence,
          note: 'PLM endpoint',
        }
      })
    },
  }
}

/** The default (unconfigured) PLM scorer instance registered in the registry. */
export const PLM_SCORER: VariantEffectSource = makePlmScorer()
