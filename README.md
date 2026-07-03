# Claurdalie — high-performance web MSA explorer

A browser-based **multiple sequence alignment (MSA) editor and analysis workbench**, built
to stay smooth on very large alignments (thousands of sequences × tens of thousands of
columns). 100 % client-side — nothing is uploaded. It is a lightweight, static-hosted
reimagining of the [Ordalie](https://lbgi.fr/ordalie) desktop tool: the same multi-scale,
snapshot-driven exploration of an alignment's informational content, in the browser.

## Features

- **Alignment editing** (residues are never altered — only gaps move):
  - insert / delete gaps, slide a whole sequence, reorder sequences (drag row names)
  - selection-scoped gap edits, full **undo / redo** with drag coalescing
- **Physico-chemical coloring** — background + foreground per amino acid:
  - **ClustalX** (dynamic, consensus-gated), **Zappo**, **Taylor**, **Hydrophobicity**
- **Fast canvas renderer** — viewport virtualization, pre-baked glyph atlas, dirty-flag
  rAF loop, block-mode on zoom-out, pixel-snapped (no flicker on scroll/edit)
- **Keyboard-first** — cursor/edit mode, gap edits, sequence shift, navigation, zoom
  (press `?` in the app for the full list)
- **FASTA** import (button · drag-drop · works with `.fasta/.fa/.faa/.aln`) and export
- **Minimap** overview with draggable viewport, column ruler, sequence gutter, status bar
- **3D structure panel** (opt-in) — fold a reference sequence live via ESMFold or load a
  local PDB, colored by pLDDT confidence; hover a column to highlight the residue in 3D
  and click a residue to jump the alignment cursor. Runs in a separate, lazy-loaded WebGL
  surface so the alignment renderer stays untouched.
- **Conservation analysis** — per-column scores computed off the main thread in a Web
  Worker: **Shannon**, **Jensen-Shannon** (vs BLOSUM62 background), **Mean-Distances**
  (ClustalX), **Vector Norm**, **BILD**, **Liu**, **Threshold**, and a **Multi** consensus,
  drawn as a column-aligned scores track below the alignment (global track; per-group is next)
- **Clustering & groups** — group sequences by identity / length / hydrophobicity / pI /
  composition using **hierarchic (Secator)**, **k-means**, **density-peaks (DPC)**, or
  **Gaussian mixture + AIC/BIC** (auto-selecting the number of groups); groups reorder the
  alignment into contiguous blocks with a gutter color stripe, and conservation gains a
  colored **per-group track** alongside the global one
- **Phylogenetic tree** — neighbor-joining from an identity-distance matrix (Pairwise/Global
  gap handling), optional **bootstrap** (deterministic, seeded); an interactive canvas viewer
  with **dendrogram + radial** layouts, click-to-re-root / shift-click-to-swap, leaf coloring
  by cluster, bootstrap-support discs, pan/zoom, and Newick/NEXUS import
- **Instances (snapshots)** — an always-visible combobox to juggle parallel analytical
  hypotheses; switching an instance restores the *exact* state of the alignment **and** every
  sub-module (shown scores, clustering/groups, tree, view, selection). Fork / overwrite / rename / delete
- **Light / dark** theme, accessible controls, built-in demo + heavy stress datasets

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173/claurdalie/
npm run build      # production build to dist/
npm test           # vitest unit + property tests (core model, edits, FASTA)
```

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `F2` | Toggle cursor / edit mode |
| `Space` | Insert gap at cursor |
| `Delete` / `Backspace` | Delete gap at / before cursor |
| `⌘/Ctrl + ←/→` | Shift sequence left / right |
| `⌘/Ctrl + Z` · `⌘/Ctrl + ⇧ + Z` | Undo · Redo |
| arrows (+ `⇧`) | Move cursor / extend selection |
| `⌘/Ctrl + A` · `Esc` | Select all · clear |
| `+` / `-` / `0` | Zoom in / out / reset |
| `?` | Shortcut help |

Mouse: **shift-drag** a residue to slide gaps · **drag a name** to reorder · drag to
select · wheel to scroll · `⌘/Ctrl`+wheel to zoom.

## Architecture

```
core/        typed-array alignment model, O(1) shift (gap offsets) & reorder (permutation),
             invertible edit commands + undo stack, lazy per-column stats, FASTA I/O
color/       pluggable color schemes (static LUTs + dynamic consensus gating)
render/      Canvas2D GridRenderer (virtualization, glyph atlas, block mode) behind a
             Renderer interface — WebGL/PixiJS is a contained future swap
interaction/ pointer + keyboard controller (scroll stays outside React)
editor/      EditorController hub wiring model ⇄ renderer ⇄ UI
ui/          React chrome only (toolbar, minimap, legend, status bar, help) — never
             renders a residue; design-token theming (light/dark)
datasets/    built-in light demo + deterministic heavy generator
structure/   opt-in 3D: pluggable StructureSource (ESMFold / local PDB), fold cache
             (by sequence hash), column↔residue map, and a lazy WebGL viewer wrapper
analysis/    conservation methods + physico-chemical matrices (BLOSUM62, volume/polarity/pKa);
             cluster criteria + distance matrix + methods (kmeans/DPC/Secator/mixture) +
             GroupModel; pure, worker-safe, keyed off the shared column-count kernel
tree/        neighbor-joining + bootstrap + Newick/NEXUS I/O + dendrogram/radial layout +
             TreeModel (re-root/swap), reusing analysis/cluster/distance.ts
workers/     numerics Web Worker + typed RPC (Transferables, no SharedArrayBuffer so it
             works on GitHub Pages), with a main-thread fallback for offline/SSR
project/     Snapshot spine: SerializableModule contract, ProjectStore (instant instance
             switching), each analysis module serializes its state into the active snapshot
```

Design rule #1: **React owns the chrome, never a residue.** The alignment surface is one
canvas driven imperatively, decoupled from React reconciliation.

## Deployment

Static build deployed to **GitHub Pages** via `.github/workflows/deploy.yml`
(`base: '/claurdalie/'`). No server, no COOP/COEP requirements.

## Roadmap

Reimplementing Ordalie's analysis layer, client-side and lightweight. Shipped: conservation +
the snapshot/instance spine (v0.4), clustering & groups (v0.5), and the phylogenetic tree
(v0.6). Next, in dependency order:

- **v0.7 — Persistence + re-align**: `.clproj` project export/import (IndexedDB working
  state); in-browser re-alignment via kalign (biowasm/Aioli) behind a pluggable `Aligner`,
  with an optional exact-MAFFT-via-EBI provider; variant/mutation-effect seam
- **v0.8 — Lighter tools**: Identity, GCG FindPatterns motif search, Snapshot Overview, Barcode

Deferred infra: WebGL/PixiJS renderer + MSDF atlas (behind the existing `Renderer` interface)
and Rust→WASM numeric kernels, adopted where profiling on very large alignments shows a ceiling.
