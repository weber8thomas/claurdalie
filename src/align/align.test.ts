import { describe, it, expect } from 'vitest'
import { AlignmentStore } from '../core/AlignmentStore'
import { UndoStack } from '../core/edits/EditCommand'
import { alignmentEdits } from './apply'
import { AioliKalignAligner } from './kalign'
import { EbiMafftAligner } from './ebiMafft'
import { AlignError } from './types'
import type { AlignedSeq, AlignInput } from './types'

const GAP = 0
const A = 1, C = 2, D = 3

function store(seqs: { name: string; codes: number[] }[]): AlignmentStore {
  return AlignmentStore.fromSequences(seqs.map((s) => ({ name: s.name, codes: Uint8Array.from(s.codes) })))
}
function layout(s: AlignmentStore): number[][] {
  return s.orderSnapshot().map((id) => Array.from(s.materializeRow(id)))
}

// ---- alignmentEdits: the apply/undo mechanic --------------------------------

describe('alignmentEdits', () => {
  it('rewrites each row to the aligner layout and undoes cleanly', () => {
    // Start ragged: 'a' has interior gaps, 'b' has none.
    const s = store([
      { name: 'a', codes: [A, GAP, C, GAP] },
      { name: 'b', codes: [A, C, D] },
    ])
    const before = layout(s)
    const undo = new UndoStack(s)

    // A fresh alignment: pad both to width 4 with different gap patterns.
    // Residues are invariant — only gaps move.
    const aligned: AlignedSeq[] = [
      { name: 'a', codes: Uint8Array.from([GAP, A, C, GAP]) },
      { name: 'b', codes: Uint8Array.from([A, C, D, GAP]) },
    ]
    undo.do(alignmentEdits(s, aligned))

    expect(layout(s)).toEqual([
      [GAP, A, C, GAP],
      [A, C, D, GAP],
    ])
    // Residues (non-gaps) preserved in order.
    expect(Array.from(s.materializeRow(s.rowIdAt(0))).filter((x) => x !== GAP)).toEqual([A, C])
    expect(Array.from(s.materializeRow(s.rowIdAt(1))).filter((x) => x !== GAP)).toEqual([A, C, D])

    // One undo entry restores the original layout exactly.
    undo.undo()
    expect(layout(s)).toEqual(before)
  })

  it('reorders rows to match the aligner output order', () => {
    const s = store([
      { name: 'a', codes: [A, C] },
      { name: 'b', codes: [A, D] },
    ])
    const undo = new UndoStack(s)
    // Aligner returns b before a.
    undo.do(
      alignmentEdits(s, [
        { name: 'b', codes: Uint8Array.from([A, D]) },
        { name: 'a', codes: Uint8Array.from([A, C]) },
      ]),
    )
    expect(s.orderSnapshot().map((id) => s.getRow(id).name)).toEqual(['b', 'a'])
    undo.undo()
    expect(s.orderSnapshot().map((id) => s.getRow(id).name)).toEqual(['a', 'b'])
  })
})

// ---- AlignError mapping -----------------------------------------------------

/** A deterministic Response-returning fake fetch, routed by URL substring. */
function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (url: string) => {
    for (const key of Object.keys(routes)) if (url.includes(key)) return routes[key]()
    throw new Error(`unrouted ${url}`)
  }) as unknown as typeof fetch
}

const two: AlignInput[] = [
  { name: 'a', sequence: 'AC' },
  { name: 'b', sequence: 'AD' },
]

describe('EbiMafftAligner error mapping', () => {
  it('maps a fetch rejection (CORS/offline) to blocked', async () => {
    const aligner = new EbiMafftAligner({
      fetchImpl: (() => Promise.reject(new TypeError('failed to fetch'))) as unknown as typeof fetch,
    })
    await expect(aligner.align(two)).rejects.toMatchObject({ kind: 'blocked' })
  })

  it('maps a non-OK HTTP status to network', async () => {
    const aligner = new EbiMafftAligner({
      fetchImpl: fakeFetch({
        '/run': () => new Response('job1', { status: 200 }),
        '/status/': () => new Response('server on fire', { status: 500 }),
      }),
    })
    await expect(aligner.align(two)).rejects.toMatchObject({ kind: 'network' })
  })

  it('rejects too many sequences with too-long', async () => {
    const aligner = new EbiMafftAligner({
      fetchImpl: (() => Promise.reject(new Error('should not be called'))) as unknown as typeof fetch,
    })
    const many = Array.from({ length: 501 }, (_, i) => ({ name: `s${i}`, sequence: 'AC' }))
    await expect(aligner.align(many)).rejects.toMatchObject({ kind: 'too-long' })
  })

  it('completes the submit→poll→result happy path', async () => {
    const aligner = new EbiMafftAligner({
      fetchImpl: fakeFetch({
        '/run': () => new Response('job1', { status: 200 }),
        '/status/': () => new Response('FINISHED', { status: 200 }),
        '/result/': () => new Response('>s0\nA-C\n>s1\nAD-\n', { status: 200 }),
      }),
    })
    const out = await aligner.align(two)
    expect(out.map((o) => o.name)).toEqual(['a', 'b'])
    expect(Array.from(out[0].codes)).toEqual([A, GAP, C])
    expect(Array.from(out[1].codes)).toEqual([A, D, GAP])
  })
})

describe('AioliKalignAligner error mapping', () => {
  it('maps a failed module load to unavailable', async () => {
    const aligner = new AioliKalignAligner(() => Promise.reject(new Error('CDN blocked')))
    await expect(aligner.align(two)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('rejects too many sequences with too-long before loading', async () => {
    const aligner = new AioliKalignAligner(() => Promise.reject(new Error('should not load')))
    const many = Array.from({ length: 501 }, (_, i) => ({ name: `s${i}`, sequence: 'AC' }))
    await expect(aligner.align(many)).rejects.toMatchObject({ kind: 'too-long' })
  })

  it('runs against a stub Aioli and maps output back to input names', async () => {
    const cli = {
      mount: async () => {},
      exec: async () => {},
      cat: async () => '>s0\nA-C\n>s1\nAD-\n',
    }
    // A stub Aioli whose constructor resolves to our fake CLI.
    const loader = () =>
      Promise.resolve({
        default: class {
          constructor() {
            return Promise.resolve(cli)
          }
        } as unknown as { new (tool: string): Promise<typeof cli> },
      })
    const aligner = new AioliKalignAligner(loader as never)
    const out = await aligner.align(two)
    expect(out.map((o) => o.name)).toEqual(['a', 'b'])
    expect(Array.from(out[0].codes)).toEqual([A, GAP, C])
  })
})

it('AlignError carries its kind', () => {
  const e = new AlignError('blocked', 'x')
  expect(e).toBeInstanceOf(Error)
  expect(e.kind).toBe('blocked')
})
