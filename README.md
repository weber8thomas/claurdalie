# Claurdalie — high-performance web MSA editor

A browser-based **multiple sequence alignment (MSA) editor** built to stay smooth on
very large alignments (thousands of sequences × tens of thousands of columns). 100 %
client-side — nothing is uploaded.

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
```

Design rule #1: **React owns the chrome, never a residue.** The alignment surface is one
canvas driven imperatively, decoupled from React reconciliation.

## Deployment

Static build deployed to **GitHub Pages** via `.github/workflows/deploy.yml`
(`base: '/claurdalie/'`). No server, no COOP/COEP requirements.

## Roadmap (deferred)

WebGL/PixiJS renderer + MSDF atlas (behind the existing `Renderer` interface) and an
optional Rust→WASM core, to be adopted if profiling on very large alignments shows
GC-jank; plus phylogenetic tree, feature tracks, and more formats.
