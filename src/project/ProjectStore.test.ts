import { describe, it, expect } from 'vitest'
import { ProjectStore, type ProjectHost } from './ProjectStore'
import type { SerializableModule, SnapshotSequence } from './types'

// A tiny in-memory host: sequences are {name, codes} arrays, no canvas needed.
class FakeHost implements ProjectHost {
  seqs: SnapshotSequence[] = []
  constructor(initial: SnapshotSequence[]) {
    this.seqs = initial.map((s) => ({ name: s.name, codes: s.codes.slice() }))
  }
  captureSequences(): SnapshotSequence[] {
    return this.seqs.map((s) => ({ name: s.name, codes: s.codes.slice() }))
  }
  loadSequences(seqs: SnapshotSequence[]): void {
    this.seqs = seqs.map((s) => ({ name: s.name, codes: s.codes.slice() }))
  }
  sequenceCount(): number {
    return this.seqs.length
  }
  columnCount(): number {
    return this.seqs[0]?.codes.length ?? 0
  }
}

// A stand-in analysis module whose state must ride along with each snapshot.
class FakeModule implements SerializableModule<{ shown: string[] }> {
  readonly sliceKey = 'fake'
  shown: string[] = []
  serialize() {
    return { shown: [...this.shown] }
  }
  hydrate(state: { shown: string[] } | undefined) {
    this.shown = state ? [...state.shown] : []
  }
}

function seq(name: string, codes: number[]): SnapshotSequence {
  return { name, codes: Uint8Array.from(codes) }
}

describe('ProjectStore snapshot spine', () => {
  it('switching instances restores exact alignment and module state', () => {
    const host = new FakeHost([seq('a', [1, 2, 3]), seq('b', [1, 0, 3])])
    const mod = new FakeModule()
    const store = new ProjectStore(host)
    store.register(mod)
    store.init('Original')

    // Configure module state in the original snapshot.
    mod.shown = ['shannon']

    // Fork a new snapshot, then diverge both alignment and module state.
    store.newSnapshot('Variant A')
    host.loadSequences([seq('a', [1, 2, 3, 0]), seq('b', [1, 0, 3, 3])]) // wider alignment
    mod.shown = ['jsd', 'vectorNorm']

    const infos = store.list()
    expect(infos).toHaveLength(2)
    expect(infos.find((i) => i.active)?.name).toBe('Variant A')

    const original = infos.find((i) => i.name === 'Original')!
    const variant = infos.find((i) => i.name === 'Variant A')!

    // Switch back to Original → its 3-column alignment and shown=['shannon'] return.
    store.switchTo(original.id)
    expect(host.columnCount()).toBe(3)
    expect(mod.shown).toEqual(['shannon'])

    // Switch to Variant A → its 4-column alignment and shown methods return.
    store.switchTo(variant.id)
    expect(host.columnCount()).toBe(4)
    expect(mod.shown).toEqual(['jsd', 'vectorNorm'])
  })

  it('never removes the last snapshot', () => {
    const host = new FakeHost([seq('a', [1, 2])])
    const store = new ProjectStore(host)
    store.init()
    const only = store.list()[0].id
    store.remove(only)
    expect(store.list()).toHaveLength(1)
  })

  it('removing the active snapshot activates a neighbour', () => {
    const host = new FakeHost([seq('a', [1, 2])])
    const store = new ProjectStore(host)
    store.init('One')
    store.newSnapshot('Two')
    const two = store.list().find((i) => i.name === 'Two')!
    store.remove(two.id)
    const infos = store.list()
    expect(infos).toHaveLength(1)
    expect(infos[0].active).toBe(true)
    expect(infos[0].name).toBe('One')
  })
})
