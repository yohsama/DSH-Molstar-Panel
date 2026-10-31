---
name: molstar-panel
description: Operate the DSH Mol* Panel plugin — drive the open 3D structure/trajectory panel (selections, styled components, camera, MolJ state snapshots) and read the user's panel selection. Use when a structure panel is open in the Sidebar and the user asks to visualize, highlight, style, color, focus, or inspect structures/trajectories — or whenever a "@molstar 绑定面板 <token>" line appears in the conversation.
---

# Mol* Panel operation (plugin `dsh-molstar-preview`)

## Panel targeting (read this first)

- The tool is **`molstar`** (Host-side; acts over a loopback bridge to the live panel).
- Without `panel`: the call targets this Session's own panel, else the most recently active one — which may NOT be the panel the user means.
- When the user message contains `@molstar 绑定面板 <token>` (from the panel's bubble button): **pass that token as `panel` on every subsequent call**. The conversation is then pinned to that exact panel (session + view); the user can freely open and watch other structures elsewhere.
- If a bound panel was closed, the tool reports it as offline — ask the user to reopen the preview and re-bind.

## Actions

| action | effect |
|---|---|
| `status` | Which file/format is open, structure count, panel position |
| `selection` | Read the user's selection-manager contents: residues (chain, auth seq, comp) + equivalent pymol query |
| `apply` | Run a query; `mode`: `select` (viewport marks), `highlight`, `focus` (camera) |
| `style` | Create a **persistent styled component**: one query + one or more representations with optional uniform colors |
| `clear-style` | Remove all styled components created via `style` |
| `state` | Export the full Mol* view state (MolJ JSON); pass the same JSON back as `snapshot` to restore the view |
| `clear` | Remove selection/highlight marks (`mode` as for apply) |
| `reset` | Reset the camera |
| `layout` | Move the structure panel: `right` or `bottom` |

## Query languages (`language`, default `pymol`)

PyMOL/MolQL selection syntax (validated by Mol*'s own transpiler):

```
chain A                          # one chain
chain A and resi 42-49           # residue range
chain A and resi 42+45           # residue list
resn HIS                         # by residue name
resn ASP or resn GLU or resn LYS or resn ARG     # charged set
name CA                          # atom name
elementSymbol O                  # element
polymer and chain B              # polymer only
(chain A and resi 42) or (chain B and resi 7)    # mixed groups
```

Mol* S-expressions with `language: "mol-script"`:

```
(sel.atom.all)
(sel.atom.atom-groups :residue-test (= atom.auth_comp_id ALA))
```

## `style` parameters

- `representations`: array of `{ type, color? }`; `type` is any Mol* representation
  (`cartoon`, `ball-and-stick`, `surface`, `label`, …); `color` accepts
  `#rrggbb`, `#rgb` or `rgb(r,g,b)` and becomes a uniform color theme.
- `color` (top level): default color for representations without their own.
- `label`: component name shown in Mol*'s Structure panel.
- `key`: dedupe identity — restyling the same key replaces the component.
- `clear: true`: remove previously styled components first.

## Copy-paste recipes

Highlight all HIS as orange cartoon + ball-and-stick:

```json
{ "action": "style", "expression": "resn HIS", "clear": true,
  "label": "HIS", "color": "#ff8800",
  "representations": [ { "type": "cartoon" }, { "type": "ball-and-stick" } ] }
```

Ligand ball-and-stick with camera focus:

```json
{ "action": "style", "expression": "resn T13 or resn CoA",
  "label": "Ligand", "representations": [ { "type": "ball-and-stick" } ] }
```
then `{ "action": "apply", "expression": "resn T13 or resn CoA", "mode": "focus" }`

Select a set, then enumerate it:

```json
{ "action": "apply", "expression": "resn HIS", "mode": "select" }
{ "action": "selection" }
```

Save / restore the current view (MolJ JSON):

```json
{ "action": "state" }                          // export — keep the JSON
{ "action": "state", "snapshot": { ... } }     // restore verbatim
```

## Trajectories

`xtc`/`trr` panels are lazily windowed: a 64-frame strided window first, a
full-range slider, and dense 64-frame window refills on seek (byte-range
reads; constant memory). `dcd`/`nc(netcdf)`/`lammpstrj` load whole-file.
Styled components attach to the model; refills keep them.

## Limits (know before you promise)

- `apply mode=select` draws viewport **marks** (`lociSelects`) — visible to the
  user but NOT enumerable; `selection` will report empty even though marks
  exist. For a readable "selection set", use a `style` component instead.
- MolJ `state` snapshots can be large (they embed the data); summarize rather
  than quote, and restore verbatim only.
- Everything requires the panel to be open on a structure file; the bridge
  reports a clear error otherwise.
