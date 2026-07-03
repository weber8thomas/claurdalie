// Newick + (light) NEXUS parsing/serialization for tree import/export.

import type { PhyloTree, TreeNode } from './types'
import { leafNodes } from './types'

// ---- serialize -----------------------------------------------------------

function esc(name: string): string {
  return /[\s(),:;']/.test(name) ? `'${name.replace(/'/g, "''")}'` : name
}

export function serializeNewick(tree: PhyloTree): string {
  const emit = (n: TreeNode): string => {
    if (n.children.length === 0) return `${esc(n.name ?? '')}:${fmt(n.length)}`
    const kids = n.children.map(emit).join(',')
    const support = n.support !== undefined ? Math.round(n.support * (tree.bootstrap || 100)).toString() : ''
    return `(${kids})${support}:${fmt(n.length)}`
  }
  // Root has no branch length in Newick.
  const kids = tree.root.children.map(emit).join(',')
  return `(${kids});`
}

function fmt(x: number): string {
  return (Math.round(x * 1e6) / 1e6).toString()
}

// ---- parse ---------------------------------------------------------------

export function parseNewick(input: string, bootstrapN = 0): PhyloTree {
  let i = 0
  let nextId = 0
  const s = input.trim()

  const readName = (): string => {
    if (s[i] === "'") {
      i++
      let name = ''
      while (i < s.length) {
        if (s[i] === "'") {
          if (s[i + 1] === "'") {
            name += "'"
            i += 2
          } else {
            i++
            break
          }
        } else name += s[i++]
      }
      return name
    }
    let name = ''
    while (i < s.length && !':,();'.includes(s[i])) name += s[i++]
    return name.trim()
  }

  const readNumber = (): number => {
    let num = ''
    while (i < s.length && /[-0-9.eE+]/.test(s[i])) num += s[i++]
    return num ? Number(num) : 0
  }

  const parseNode = (): TreeNode => {
    const n: TreeNode = { id: nextId++, length: 0, children: [] }
    if (s[i] === '(') {
      i++ // consume '('
      do {
        n.children.push(parseNode())
      } while (s[i] === ',' && i++ < s.length)
      if (s[i] === ')') i++ // consume ')'
      // internal-node label = bootstrap support
      const label = readName()
      if (label) {
        const v = Number(label)
        if (!Number.isNaN(v)) n.support = bootstrapN > 0 ? v / bootstrapN : v / 100
      }
    } else {
      n.name = readName()
    }
    if (s[i] === ':') {
      i++
      n.length = readNumber()
    }
    return n
  }

  const root = parseNode()
  if (s[i] === ';') i++
  const tree: PhyloTree = { root, leaves: leafNodes(root).map((l) => l.name ?? ''), bootstrap: bootstrapN }
  return tree
}

// ---- NEXUS (light) -------------------------------------------------------

/**
 * Parse a NEXUS trees block: extract the first `tree ... = <newick>;`, applying
 * a translate table if present. Only what Ordalie's "Load Tree file" needs.
 */
export function parseNexus(input: string): PhyloTree {
  const text = input.replace(/\[[^\]]*\]/g, '') // strip [comments]
  // translate table: translate 1 name1, 2 name2, ... ;
  const translate = new Map<string, string>()
  const transMatch = /translate([\s\S]*?);/i.exec(text)
  if (transMatch) {
    for (const pair of transMatch[1].split(',')) {
      const m = pair.trim().match(/^(\S+)\s+(.+)$/)
      if (m) translate.set(m[1], m[2].replace(/^'|'$/g, '').trim())
    }
  }
  const treeMatch = /tree\s+[^=]+=\s*(?:\[[^\]]*\]\s*)?([^;]+);/i.exec(text)
  if (!treeMatch) throw new Error('No tree found in NEXUS input')
  const tree = parseNewick(treeMatch[1] + ';')
  if (translate.size > 0) {
    for (const leaf of leafNodes(tree.root)) {
      if (leaf.name && translate.has(leaf.name)) leaf.name = translate.get(leaf.name)!
    }
    tree.leaves = leafNodes(tree.root).map((l) => l.name ?? '')
  }
  return tree
}

/** Detect and parse either NEXUS or Newick. */
export function parseTree(input: string): PhyloTree {
  return /#nexus/i.test(input) ? parseNexus(input) : parseNewick(input)
}
