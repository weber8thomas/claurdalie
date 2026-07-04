# Changelog

All notable changes to Claurdalie, newest first.

## v0.12.0
- Customizable gap / whitespace display (blank / dash / dot / cross, gap fill color, grid lines) via View → "Gaps & whitespace…"
- Dock rail overhaul: docked panels render correctly, collapse to their header, and reorder by drag; collapsed rail becomes a "Panels" tab
- Sequence identity is now a floating/dockable panel; pop-up menus always sit above panels
- Editable clustering group colors (Mantine color picker) that repaint the alignment, tree, and barcode

## v0.11.0
- Draggable / dockable analysis panels
- Analysis UX fixes
- Logo links to the repository

## v0.10.0
- Migrated the UI to the Mantine component library, unified design tokens
- Single-instance session export / import (one snapshot as a `.clproj`)
- Interactive tree viewer: search, branch-distance readouts, export

## v0.9.1
- Fold a mutant with ESMFold and superpose it on the wild-type
- RMSD and ΔpLDDT reported at the mutated site
- Per-residue Cα "Difference" color mode for comparing structures

## v0.9.0
- Variant / mutation-effect analysis behind a pluggable `VariantEffectSource`
- Offline BLOSUM62 × conservation scorer, plus an optional online PLM endpoint
- Impact-colored alignment pins, a results table, and a 3D residue highlight
- Variants ride the snapshot (keyed by sequence name + ungapped position)

## v0.8.0
- Pairwise sequence identity (summary stats + two-sequence picker)
- GCG FindPatterns motif search with a high-contrast grid overlay
- Snapshot Overview minimap (residue / conservation / cluster views)
- Per-cluster Barcode; per-model 3D show/hide; resizable conservation panel

## v0.7.0
- Project persistence: `.clproj` export / import + IndexedDB auto-save
- In-browser re-alignment via Kalign (WASM), optional MAFFT via EMBL-EBI
- Variant / mutation-effect seam (types + registry)

## v0.6.0
- Phylogenetic tree: neighbor-joining with optional seeded bootstrap
- Interactive dendrogram / radial viewer with re-root and swap
- Newick / NEXUS import

## v0.5.0
- Sequence clustering: hierarchic, k-means, density-peaks, Gaussian mixture
- Groups reorder the alignment into colored blocks
- Per-group conservation track alongside the global one

## v0.4.0
- Conservation analysis (Shannon, Jensen-Shannon, ClustalX, and more)
- Tracks and cluster views, computed off the main thread in a Web Worker
- Snapshot / instance spine — juggle parallel analytical hypotheses

## v0.3.0
- 3D panel: fold and load multiple structures
- Viewer controls, structure compare, fullscreen

## v0.2.0
- Opt-in 3D structure panel with real-time ESMFold folding
- Cleaner icon-based toolbar, About dialog, version tag

## v0.1.0
- Initial release: fast Canvas2D MSA editor
- Gap-only editing with undo / redo, physico-chemical coloring
- FASTA import / export, keyboard-first navigation
