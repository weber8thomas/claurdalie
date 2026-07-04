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
- **Snapshot Overview** (minimap) — a downsampled schematic of the whole alignment with a
  draggable/click-to-jump viewport box, a selectable overlay (**residues / conservation /
  clusters**), and +/− zoom of the grid scale; column ruler, sequence gutter, status bar
- **3D structure panel** (opt-in) — fold a reference sequence live via ESMFold or load a
  local PDB, colored by pLDDT confidence; hover a column to highlight the residue in 3D
  and click a residue to jump the alignment cursor. Load several structures and **show/hide
  each independently** (toggle a model off without discarding it). Runs in a separate,
  lazy-loaded WebGL surface so the alignment renderer stays untouched.
- **Conservation analysis** — per-column scores computed off the main thread in a Web
  Worker: **Shannon**, **Jensen-Shannon** (vs BLOSUM62 background), **Mean-Distances**
  (ClustalX), **Vector Norm**, **BILD**, **Liu**, **Threshold**, and a **Multi** consensus.
  The **resizable** scores panel switches between two views: a **Tracks** (Jalview-style) view
  that stacks each selected method as its own labeled histogram row (with per-group lines
  overlaid), and a **Clusters** (Cluspack-style) view that clusters each column by its score
  into **well- / moderately- / poorly-conserved** classes and paints the alignment as colored
  conservation bands, with a per-class column tally
- **Sequence identity** — pairwise %-identity over all or the selected sequences (Pairwise/
  Global gap handling): summary stats (mean, std-dev, most-similar / most-distant pairs) and
  a two-sequence picker showing %-identity and ungapped lengths; within- vs outside-cluster
  neighbours when a grouping is active
- **Motif search** (GCG **FindPatterns**) — literal residues, ambiguity codes (`B Z X`),
  `()` groups with `{m,n}` repeats, comma-OR, `~` negation, and `<`/`>` anchors, compiled to
  a matcher over each sequence; matches are drawn as a high-contrast red-on-dark overlay on
  the grid with **Find Next / Prev** that scrolls the view
- **Barcode** — one lane per cluster showing a column-aligned "barcode" of per-group
  conservation, gap density, and any active motif feature
- **Variant / mutation-effect analysis** — add point substitutions to a sequence (manually,
  by CSV/TSV import `seq,pos,from,to,label`, or right-click a residue → *Add variant here*),
  then score their predicted impact behind a pluggable **`VariantEffectSource`**: a pure,
  offline **local scorer** combining the BLOSUM62 substitution penalty with the conservation
  of the mapped column (highly-conserved + non-conservative ⇒ high impact), plus an optional
  online **PLM-endpoint** scorer that degrades gracefully when unreachable. Impact-colored pins
  render on the alignment (green→amber→red), a results table shows the score and *what drove it*
  (which column / conservation), a hover tooltip reads `from→to · impact`, and the variant's
  residue highlights in the **3D viewer**. On demand, **fold the mutant** (ESMFold) and overlay
  it on the wild-type structure — superposed, reporting **RMSD + ΔpLDDT at the site**, with a
  **"Difference" color mode** that paints each residue by its Cα deviation so structural changes
  light up (works for any two overlapping structures, not just mutants). Variants ride the
  snapshot (serialized by sequence name + ungapped position) so they survive instance switches
  and `.clproj` export
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
- **Session persistence** — two export/import scopes, both as a gzipped **`.clproj`** file
  (typed arrays stored as base64 + gap-RLE, no dependency): the **whole project** (every
  snapshot + module state) or a **single instance** (its alignment + its metadata, imported as
  a new instance into the current project). The alignment itself round-trips separately as
  plain **FASTA**. The working project auto-saves to **IndexedDB** and is restored on reload.
  A session is *alignment + metadata*; future **annotations** will ride the same per-snapshot
  slices with no format change
- **Re-alignment** — re-align the selected sequences behind a pluggable **`Aligner`**: **Kalign**
  compiled to WASM (biowasm/Aioli, dynamically imported, runs off-thread, no server) or the
  optional online **MAFFT via EMBL-EBI**. Re-align in place or **into a new snapshot** (the
  original topology is preserved) as a single undoable edit; degrades gracefully offline
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
             switching), each analysis module serializes its state into the active snapshot;
             .clproj (de)serialization (gzip via CompressionStream, gap-RLE) + IndexedDB
align/       pluggable Aligner (mirrors StructureSource): Kalign-WASM via Aioli (dynamic CDN
             import) + optional EBI MAFFT; degap→regap apply as one undoable edit; controller
variant/     mutation-effect analysis — Variant + VariantEffectSource + VariantContext types,
             a pure local BLOSUM×conservation scorer + optional online PLM stub, CSV/TSV I/O,
             and a VariantModel (snapshot slice) driving the alignment pins + 3D highlight
```

Design rule #1: **React owns the chrome, never a residue.** The alignment surface is one
canvas driven imperatively, decoupled from React reconciliation.

## Deployment

Static build deployed to **GitHub Pages** via `.github/workflows/deploy.yml`
(`base: '/claurdalie/'`). No server, no COOP/COEP requirements.

## Roadmap

Reimplementing Ordalie's analysis layer, client-side and lightweight. Shipped: conservation +
the snapshot/instance spine (v0.4), clustering & groups (v0.5), the phylogenetic tree (v0.6),
**persistence + re-align (v0.7)**, **lighter tools (v0.8)**, and **variant / mutation-effect
analysis (v0.9)**. Next, in dependency order:

- **v0.7 — Persistence + re-align** ✅ *shipped*: `.clproj` project export/import (IndexedDB
  working state); in-browser re-alignment via Kalign (biowasm/Aioli) behind a pluggable
  `Aligner`, with an optional MAFFT-via-EBI provider; variant/mutation-effect seam (types +
  registry)
- **v0.8 — Lighter tools** ✅ *shipped*: pairwise **sequence identity** (summary + pairwise
  picker, within/outside-cluster neighbours), **GCG FindPatterns motif search** (compiled to
  a matcher with a high-contrast grid overlay + Find Next), the **Snapshot Overview**
  (residue/conservation/cluster overlays + zoom on the minimap), and the per-cluster
  **Barcode**; plus per-model 3D show/hide and a resizable conservation panel
- **v0.9 — Variant / mutation-effect analysis** ✅ *shipped*: point substitutions added
  manually / by CSV-TSV import / by right-clicking a residue, scored behind a pluggable
  **`VariantEffectSource`** — a pure offline **BLOSUM62 × conservation** local scorer and an
  optional online **PLM-endpoint** stub with the same typed-error / offline-degrade UX as the
  structure sources; impact-colored alignment pins + hover tooltip, a results table explaining
  each score, a **3D residue highlight**, and a **VariantModel** snapshot slice (serialized by
  sequence name + ungapped position). **v0.9.1** adds on-demand **mutant refolding** (ESMFold)
  with superposition onto the wild-type, an RMSD / ΔpLDDT summary, and a per-residue **Cα
  deviation ("Difference") color mode** for comparing overlapping structures

Deferred infra: WebGL/PixiJS renderer + MSDF atlas (behind the existing `Renderer` interface)
and Rust→WASM numeric kernels, adopted where profiling on very large alignments shows a ceiling.
