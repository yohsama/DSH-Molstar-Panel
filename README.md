# DSH Mol* Panel (dsh-molstar-preview)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin
that turns the Sidebar into an interactive [Mol*](https://github.com/molstar/molstar)
(Molstar) 3D panel: structures open as Mol* by default, GROMACS/AMBER/CHARMM
trajectories play as animations (lazy windowed loading for `xtc`/`trr`), and
the running panel can be read and driven by the agent through the `molstar`
tool — selections, styled components, recipes, and MolJ state snapshots.

## Install

The repository root is the plugin package (DSH bundle spec: `dsh.bundle.patch`
in `package.json`, patch in `cordis.patch.yml`).

1. Clone this repository anywhere, e.g. `%USERPROFILE%\plugins\DSH-Molstar-Panel`.
2. In DSH, install the bundle from that directory (Plugin Manager → install
   bundle, or ask your agent to run `plugin_manager install_bundle` with the
   absolute path).
3. Restart DSH once (the Host half of the plugin loads at boot; the browser
   half hot-reloads).

Requires DSH 0.2.1-rc.1+. Optional: [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)
adds a dedicated Mol* tab and file viewer integration.

## What it contributes

- A document-preview implementation registered with
  `ctx.documentPreviews.register({ id, extensions, loading: 'bytes-complete', title })`.
  The `extension` band outranks the built-in plain-text fallback, so a `.pdb`
  or `.cif` file opened from the Files tab selects Mol* automatically.
- The renderer body under the same id in the keyed, Session-scoped
  `sidebar.right.tab.document` slot.

Recognized suffixes (all read as UTF-8 text, latin-1 fallback):

| Suffixes | Mol* format |
|---|---|
| `pdb`, `ent` | `pdb` |
| `pdbqt` | `pdbqt` |
| `pqr` | `pqr` |
| `cif`, `mmcif`, `mcif` | `mmcif` (falls back to `cifCore` for small-molecule CIF) |
| `mol` | `mol` |
| `mol2` | `mol2` |
| `sdf`, `sd` | `sdf` |
| `xyz` | `xyz` |
| `gro` | `gro` |

MD trajectories open as animations: the viewer pairs the trajectory with a
structure model from the **same directory** (exact GROMACS-style names first —
`confout.gro`, `conf.gro`, `start.gro`, `start.pdb`, `topol.cif`, … — then any
`.gro`, then `.pdb`/`.cif`), loads it through Mol*'s `loadTrajectory`, and shows
Mol*'s playback controls:

| Suffixes | Mol* coordinates format | Loading |
|---|---|---|
| `xtc` | `xtc` (GROMACS, compressed) | lazy, windowed |
| `trr` | `trr` (GROMACS, lossless) | lazy, windowed |
| `dcd` | `dcd` (CHARMM/NAMD) | whole file |
| `nc`, `netcdf` | `nctraj` (AMBER) | whole file |
| `lammpstrj` | `lammpstrj` (LAMMPS) | whole file |

For `xtc`/`trr` in the Better Sidebar surfaces, the plugin first builds a frame
index by walking frame boundaries (fixed-size frames for TRR; block-skipping
scan for XTC — validated against Mol*'s own parsers), loads a **strided window**
of up to 64 frames spanning the whole trajectory, and shows the true frame
count in a corner badge (`current / total`). Scrubbing the animation slider
outside the loaded window swaps the coordinates cell for a dense 64-frame
window around the requested frame (byte-range reads, no full-file download);
failed refills keep the previous window. When indexing is unavailable or fails,
the trajectory falls back to the whole-file load.

When no matching structure is found the preview says so instead of rendering
an empty canvas. Whole-file reads go through the Host's complete-file cap, so
very large `dcd`/`nc` files are rejected with the document preview's own error
state.

The viewer follows the active Harness theme (light/dark) by swapping the Mol*
stylesheet, exposes reset/zoom/selection/animation controls, and is disposed
when the tab closes.

## Layout

Mol*'s top **sequence bar** and its right-hand **structure panel** stay visible.
The panel's position is a preference, not a fixed layout: the document header
gets a small toggle (only for structure files) that moves the panel between the
right side and the bottom, and the `molstar` tool can do the same with
`{ action: 'layout', layout: 'right' | 'bottom' }`. The choice is stored per
browser (`localStorage: dsh-molstar-panel-layout`) and applied to every open
preview.

Mol*'s embedded layouts use fixed pixel insets sized for a whole window; inside
a Sidebar pane the plugin's stylesheet places the sequence bar, viewport and
panel against the container instead, so the split follows the pane's own size.

## Better Sidebar integration

When [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) is
installed, the bundle also contributes through `ctx.betterSidebar` (optional
injection — the stock document preview above keeps working without it):

- **a tab page** — id `dsh-molstar-preview:molstar`, title "Mol* 3D structure".
  Opened empty it lists the Session folder's structure files; opened with a
  path seed (`openTab({ type, path })`) it renders that file. Better Sidebar
  also projects it into DSH's native right-Sidebar tab kinds.
- **a file viewer** — id `dsh-molstar-preview:molstar-viewer`, `pdb`/`cif`/…
  at priority 50 with `fetchStrategy: 'none'` (it reads the bytes itself via
  `remote.workspaceFiles`), so picking a structure file in the tree opens it
  in Mol* instead of the text editor.

Both surfaces mount the same canvas, so the `molstar` tool bridge works from
either of them.

## Driving the panel from the agent

The bundle also ships a Host tool, `molstar`, and a Session-scoped loopback
bridge (`/molstar-bridge`) between it and the open panel:

| Call | Effect |
|---|---|
| `{ action: 'status' }` | Is a structure preview open; its file, format and structure count |
| `{ action: 'selection' }` | The user's current selection as residues (`chain`, `resno`, `comp`) plus an equivalent PyMOL query |
| `{ action: 'apply', expression, mode }` | Select, highlight or focus a query (`mode` = `select` / `highlight` / `focus`) |
| `{ action: 'style', expression, representations, color }` | Add a persistent styled component: one query (e.g. `resn HIS`), one or more representations (`cartoon`, `ball-and-stick`, …) with optional uniform `#rrggbb` colors; `clear: true` replaces previous styled components |
| `{ action: 'clear-style' }` | Remove the styled components |
| `{ action: 'state', snapshot? }` | Export the full Mol* view state (MolJ JSON, the viewer's save format); pass `snapshot` back to restore it |
| `{ action: 'clear', mode }` | Remove selection or highlight marks |
| `{ action: 'reset' }` | Restore the default camera |

Queries use the standard Mol* query pipeline: PyMOL/MolQL selection syntax by
default (`chain A and resi 42-49`, `resn HEM`, `polymer and chain B`), or
Mol* S-expressions with `language: 'mol-script'` (`(sel.atom.atom-groups ...)`).
Both are compiled by Mol*'s own parser and transpiler, bundled as the 67 KiB
lazy chunk `client.molscript.js`.

## Agent skill

The bundle ships an agent-facing skill at
[`skills/molstar-panel/SKILL.md`](skills/molstar-panel/SKILL.md): the `molstar`
tool's actions and parameters, panel-binding rules, PyMOL/MolScript query
syntax, copy-paste style recipes, and known limits — everything an agent needs
to operate the panel precisely without rediscovering the bridge.

Note: offline MVSJ/headless rendering was considered and deliberately not
included — the browser panel plus this skill covers the interactive workflow.

The panel long-polls the Host route only while a structure preview is mounted;
commands are scoped to the calling Session's page. The route binds to the
loopback web server the GUI already uses, answers same-origin JSON requests
only, and persists nothing — closing the tab ends the exchange. Nothing in this
path adds session events or prompt text.

## Files

- `client.js` — the Client plugin: registry entry, localized title, slot body,
  and the panel bridge loop.
- `client.molstar.js` — a lazy package-local chunk holding Mol* 5.13.1 (viewer
  UMD build), its two stylesheets, and the small viewer/selection adapter. It
  is fetched only when a structure file is first previewed.
- `client.molscript.js` — a lazy chunk holding Mol*'s MolScript parser and the
  PyMOL transpiler, fetched on the first query.
- `index.js` — the Host half: the `molstar` tool and the loopback bridge route.
- `scripts/build-*.mjs`, `scripts/check-chunk.cjs` — regenerate and check the
  generated chunks.

## Rebuilding the Mol* chunk

```powershell
npm pack molstar@5.13.1 --pack-destination .build
tar -xzf .build/molstar-5.13.1.tgz -C .build
node scripts/build-chunk.mjs .build/package client.molstar.js
node scripts/build-molscript-chunk.mjs .build/package client.molscript.js <path-to-esbuild-module>
node scripts/check-chunk.cjs client.molstar.js
node scripts/check-chunk.cjs client.molscript.js
```

## Limits

- The Host's complete-file read cap (`maxFileBytes`) bounds the preview; very
  large structures and trajectories fail with the document preview's own error
  state. Trajectories are read whole, so multi-GB `xtc`/`trr` files exceed it.
- Binary CIF (`.bcif`) and gzipped structures are not handled; GROMACS
  `.tng`/`.edr` are not molecular-structure formats and stay unclaimed.
- Mol* needs WebGL; without it the renderer reports the failure instead of
  showing a structure.

## License

The plugin itself is offered under the MIT terms in `licenses/molstar-LICENSE.txt`
alongside Mol*, whose viewer build and stylesheets are redistributed here under
the MIT license (Copyright (c) 2017 - now, Mol* contributors).
