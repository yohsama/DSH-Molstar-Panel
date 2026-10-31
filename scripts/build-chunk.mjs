// Regenerate `client.molstar.js` — the lazy package-local chunk that carries
// Mol* — from an unpacked `molstar` npm package.
//
//   npm pack molstar@5.13.1 --pack-destination .build
//   tar -xzf .build/molstar-5.13.1.tgz -C .build
//   node scripts/build-chunk.mjs .build/package client.molstar.js
//
// The chunk follows the Harness client-module protocol: the owner package id
// plus `chunk: "<file name>"`, and a factory that returns the chunk exports.
// Mol* ships as a classic IIFE assigned to `var molstar`, so it is evaluated in
// a nested scope with `require`/`module`/`exports`/`define` shadowed to keep it
// from binding to this chunk's CommonJS wrapper or to the module table.
import fs from 'node:fs';
import path from 'node:path';

const [molstarDir, outFile] = process.argv.slice(2);
if (!molstarDir || !outFile) {
  console.error('usage: node scripts/build-chunk.mjs <unpacked molstar dir> <out file>');
  process.exit(2);
}

const pkg = JSON.parse(fs.readFileSync(path.join(molstarDir, 'package.json'), 'utf8'));
const viewerDir = path.join(molstarDir, 'build', 'viewer');
const umd = fs.readFileSync(path.join(viewerDir, 'molstar.js'), 'utf8')
  .replace(/\/\/# sourceMappingURL=.*$/u, '');
const cssLight = fs.readFileSync(path.join(viewerDir, 'molstar.css'), 'utf8');
const cssDark = fs.readFileSync(path.join(viewerDir, 'theme', 'dark.css'), 'utf8');
const license = fs.readFileSync(path.join(molstarDir, 'LICENSE'), 'utf8');

const chunk = `//! Mol* ${pkg.version} — viewer build and stylesheets, MIT licensed.
${license
  .split('\n')
  .map((line) => `//${line}`)
  .join('\n')}
//! Bundled from molstar@${pkg.version} by scripts/build-chunk.mjs. Do not edit by hand.
window.__ModuleLoader__.load({
  id: 'dsh-molstar-preview',
  chunk: 'client.molstar.js',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;

    // Mol* ships as \`var molstar = (() => { ... })()\`; shadowing the CommonJS
    // bindings keeps it out of the module table and off the global object.
    const molstar = (function (require, module, exports, define) {
${umd}
return molstar;
    })(void 0, void 0, void 0, void 0);

    const CSS_LIGHT = ${JSON.stringify(cssLight)};
    const CSS_DARK = ${JSON.stringify(cssDark)};

    /** Residue identity of every element in one selection loci, newest first. */
    function selectionResidues(loci, into) {
      if (!loci || loci.kind !== 'element-loci' || !Array.isArray(loci.elements)) return;
      for (const element of loci.elements) {
        const unit = element && element.unit;
        const model = unit && unit.model;
        const hierarchy = model && model.atomicHierarchy;
        if (!hierarchy || !hierarchy.residueAtomSegments || !hierarchy.chainAtomSegments) continue;
        if (!hierarchy.residues || !hierarchy.chains) continue;
        if (!hierarchy.chains.auth_asym_id || !hierarchy.residues.auth_seq_id || !hierarchy.residues.auth_comp_id) continue;
        const indices = element.indices;
        const size = indices === undefined ? 0 : typeof indices.size === 'number' ? indices.size : indices.length;
        for (let at = 0; at < size; at++) {
          const local = typeof indices.getAt === 'function' ? indices.getAt(at) : indices[at];
          if (!Number.isInteger(local)) continue;
          const elementIndex = unit.elements[local];
          if (!Number.isInteger(elementIndex)) continue;
          const residueIndex = hierarchy.residueAtomSegments.index[elementIndex];
          const chainIndex = hierarchy.chainAtomSegments.index[elementIndex];
          if (!Number.isInteger(residueIndex) || !Number.isInteger(chainIndex)) continue;
          const chain = hierarchy.chains.auth_asym_id.value(chainIndex);
          const seq = hierarchy.residues.auth_seq_id.value(residueIndex);
          const comp = hierarchy.residues.auth_comp_id.value(residueIndex);
          const insertion = hierarchy.residues.pdbx_PDB_ins_code && hierarchy.residues.pdbx_PDB_ins_code.value
            ? hierarchy.residues.pdbx_PDB_ins_code.value(residueIndex) || ''
            : '';
          const key = chain + '\u0000' + seq + '\u0000' + insertion;
          let entry = into.get(key);
          if (entry === undefined) {
            entry = { chain, seq: Number(seq), comp, insertion, atoms: 0 };
            into.set(key, entry);
          }
          entry.atoms++;
        }
      }
    }

    /** Describe the viewer's current selection in plain residue terms. */
    function describeSelection(viewer) {
      const residues = new Map();
      let elementCount = 0;
      let error;
      try {
        const selection = viewer.plugin.managers.structure.selection;
        if (selection && typeof selection.elementCount === 'function') {
          elementCount = selection.elementCount();
        }
        if (selection && selection.entries && typeof selection.entries.values === 'function') {
          for (const entry of selection.entries.values()) {
            try {
              selectionResidues(entry && entry.selection, residues);
            } catch {
              // One malformed entry must not lose the whole readout.
            }
          }
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const list = [...residues.values()].sort((a, b) =>
        String(a.chain).localeCompare(String(b.chain)) || a.seq - b.seq || String(a.insertion).localeCompare(String(b.insertion)));
      const out = { elementCount, residues: list };
      if (error !== undefined) out.error = error;
      return out;
    }

    /** Count the loaded structures without assuming any one hierarchy shape. */
    function describeStructures(viewer) {
      const manager = viewer.plugin.managers.structure;
      const current = manager && manager.hierarchy && manager.hierarchy.current;
      const structures = current && Array.isArray(current.structures) ? current.structures : [];
      let chains = 0;
      for (const ref of structures) {
        const structure = ref && ref.cell && ref.cell.obj;
        if (structure && Array.isArray(structure.units)) chains += structure.units.length;
      }
      return { structures: structures.length, units: chains };
    }

    /** Enumerate the panel's structure components and each representation's style. */
    function describeComponents(viewer) {
      const out = [];
      const current = viewer.plugin.managers.structure.hierarchy.current;
      const structures = current !== undefined && Array.isArray(current.structures) ? current.structures : [];
      structures.forEach((ref, structureIndex) => {
        const structureLabel = ref !== undefined && ref.cell !== undefined && ref.cell.obj !== undefined ? ref.cell.obj.label : undefined;
        const components = ref !== undefined && Array.isArray(ref.components) ? ref.components : [];
        for (const component of components) {
          const cell = component !== undefined ? component.cell : undefined;
          const params = cell !== undefined && cell.transform !== undefined ? cell.transform.params : undefined;
          const entry = {
            structure: structureIndex,
            structureLabel: structureLabel,
            label: undefined,
            selector: undefined,
            expression: undefined,
            visible: cell === undefined || cell.state === undefined || cell.state.visible !== false,
            representations: [],
          };
          if (params !== undefined && params !== null) {
            if (typeof params.label === 'string' && params.label !== '') entry.label = params.label;
            const type = params.type;
            if (type !== undefined && type !== null) {
              if (type.name === 'static') {
                entry.selector = type.params;
              } else if (type.name === 'expression' || type.name === 'script') {
                entry.expression = JSON.stringify(type.params === undefined ? null : type.params);
              } else {
                entry.selector = String(type.name);
              }
            }
          }
          if (entry.label === undefined && cell !== undefined && cell.obj !== undefined && typeof cell.obj.label === 'string') {
            entry.label = cell.obj.label;
          }
          const reps = Array.isArray(component.representations) ? component.representations : [];
          for (const rep of reps) {
            const rCell = rep !== undefined ? rep.cell : undefined;
            const rParams = rCell !== undefined && rCell.transform !== undefined ? rCell.transform.params : undefined;
            const colorValue =
              rParams !== undefined && rParams.colorTheme !== undefined && rParams.colorTheme.params !== undefined
                ? rParams.colorTheme.params.value
                : undefined;
            entry.representations.push({
              type: rParams !== undefined && rParams.type !== undefined ? rParams.type.name : undefined,
              color: rParams !== undefined && rParams.colorTheme !== undefined ? rParams.colorTheme.name : undefined,
              colorValue:
                typeof colorValue === 'number'
                  ? '#' + ('000000' + colorValue.toString(16)).slice(-6)
                  : undefined,
              visible: rCell === undefined || rCell.state === undefined || rCell.state.visible !== false,
            });
          }
          out.push(entry);
        }
      });
      return out;
    }
    function applySkin(scheme) {
      const dark = scheme === 'dark';
      let style = document.querySelector('style[data-molstar-skin]');
      if (style === null) {
        style = document.createElement('style');
        style.setAttribute('data-molstar-skin', '');
        document.head.appendChild(style);
      }
      const next = dark ? 'dark' : 'light';
      if (style.getAttribute('data-molstar-skin') === next) return;
      style.setAttribute('data-molstar-skin', next);
      style.textContent = dark ? CSS_DARK : CSS_LIGHT;
    }

    /** Load one structure, retrying small-molecule CIF cores when mmCIF fails. */
    async function loadStructure(viewer, data, format, label) {
      const attempts = format === 'mmcif' ? ['mmcif', 'cifCore'] : [format];
      let lastError;
      for (let index = 0; index < attempts.length; index++) {
        try {
          await viewer.loadStructureFromData(data, attempts[index], { dataLabel: label });
          return;
        } catch (error) {
          lastError = error;
          if (index === attempts.length - 1) break;
          try {
            viewer.plugin.clear();
          } catch {
            // A failed clear only means the retry starts from a dirty state.
          }
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    /** Best-effort CSS color (#rgb/#rrggbb/rgb()) to a Mol* color int. */
    function colorToInt(value) {
      if (typeof value !== 'string') return undefined;
      const text = value.trim();
      const hex = /^#([0-9a-f]{6})$/i.exec(text);
      if (hex) return parseInt(hex[1], 16);
      const shortHex = /^#([0-9a-f]{3})$/i.exec(text);
      if (shortHex) return parseInt(shortHex[1].split('').map((c) => c + c).join(''), 16);
      const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(text);
      if (rgb) return (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]);
      return undefined;
    }

    /** The Harness page background token, as a CSS color, for one scheme. */
    function hostBackgroundColor(scheme) {
      try {
        const value = window
          .getComputedStyle(document.documentElement)
          .getPropertyValue('--dsw-alias-bg-base')
          .trim();
        if (value) return value;
      } catch {
        // Fall through to the Mol* palette.
      }
      return scheme === 'dark' ? '#111318' : '#f5f4f0';
    }

    /** Push the page background into the WebGL canvas so the viewport follows the DSH theme. */
    function applyCanvasBackground(viewer, scheme) {
      const color = colorToInt(hostBackgroundColor(scheme));
      if (color === undefined) return;
      try {
        const canvas3d = viewer.plugin.canvas3d;
        if (canvas3d) canvas3d.setProps({ renderer: { backgroundColor: color } });
      } catch {
        // A canvas that is not up yet keeps its default background.
      }
    }

    /**
     * Create the viewer chrome shared by single structures and trajectories.
     * @param container - positioned element the viewer fills.
     * @param scheme - the color scheme for the Mol* skin.
     * @returns the mounted viewer, a resize scheduler and a chrome release.
     */
    async function mountViewer(container, scheme) {
      applySkin(scheme);
      const viewer = await molstar.Viewer.create(container, {
        layoutIsExpanded: false,
        // The preview keeps Mol*'s top sequence bar and its right-hand
        // structure panel; the panel's own position is arranged by the
        // plugin's stylesheet (right vs. bottom), so the fixed pixel layout
        // is only a baseline.
        layoutShowControls: true,
        layoutShowRemoteState: false,
        layoutShowSequence: true,
        layoutShowLog: false,
        layoutShowLeftPanel: false,
        layoutControlsDisplay: 'landscape',
        collapseLeftPanel: true,
        collapseRightPanel: false,
        viewportShowExpand: true,
        viewportShowSelectionMode: true,
        // Trajectories get Mol*'s animation/playback controls.
        viewportShowAnimation: true,
        viewportShowScreenshotControls: false,
        viewportShowReset: true,
        viewportShowSettings: true,
        viewportBackgroundColor: hostBackgroundColor(scheme),
        pdbProvider: 'rcsb',
        emdbProvider: 'rcsb',
      });
      applyCanvasBackground(viewer, scheme);

      let frame = 0;
      const scheduleResize = () => {
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          try {
            viewer.handleResize();
          } catch {
            // The viewer was disposed between scheduling and the frame.
          }
        });
      };
      const observer =
        typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleResize);
      if (observer !== undefined) observer.observe(container);

      const releaseChrome = () => {
        if (frame !== 0) cancelAnimationFrame(frame);
        if (observer !== undefined) observer.disconnect();
      };
      return { viewer, scheduleResize, releaseChrome };
    }

    /** Dispose a viewer and clear its host after a failed mount. */
    function abortMount(viewer, container, releaseChrome) {
      releaseChrome();
      try {
        viewer.dispose();
      } catch {
        // Disposal of a half-initialized viewer is best effort.
      }
      container.replaceChildren();
    }

    /** The shared control surface over one mounted viewer. */
    function viewerHandle(viewer, container, scheduleResize, releaseChrome) {
      let disposed = false;
      const styleRefs = [];
      let styleCounter = 0;

      /** The Mol* snapshot manager, wherever this version keeps it. */
      function stateManager() {
        const state = viewer.plugin.state;
        if (state !== undefined && state !== null && typeof state.getSnapshot === 'function') return state;
        if (
          state !== undefined &&
          state !== null &&
          state.snapshots !== undefined &&
          typeof state.snapshots.getSnapshot === 'function'
        ) {
          return state.snapshots;
        }
        return undefined;
      }

      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          releaseChrome();
          try {
            viewer.dispose();
          } catch {
            // A viewer that already failed leaves nothing to release.
          }
          container.replaceChildren();
        },
        resize: scheduleResize,
        setColorScheme(scheme) {
          if (disposed) return;
          applySkin(scheme);
          applyCanvasBackground(viewer, scheme);
          scheduleResize();
        },
        /** Describe the loaded structures and what the user has selected. */
        snapshot() {
          if (disposed) return { structures: 0, units: 0, selection: { elementCount: 0, residues: [] } };
          const structures = describeStructures(viewer);
          return {
            structures: structures.structures,
            units: structures.units,
            selection: describeSelection(viewer),
          };
        },
        /** Apply a compiled query expression as a selection, highlight or camera focus. */
        applyExpression(expression, action) {
          if (disposed) return;
          viewer.structureInteractivity({ expression: () => expression, action });
        },
        /** Remove selection marks (or highlights) without any expression. */
        clearMarks(action) {
          if (disposed) return;
          viewer.structureInteractivity({ action });
        },
        /** Restore the default camera for the loaded structures. */
        resetCamera() {
          if (disposed) return;
          const camera = viewer.plugin.managers.camera;
          if (camera && typeof camera.reset === 'function') camera.reset();
        },
        /**
         * Load one more structure into this viewer; Mol* appends a new root,
         * so several files can be superposed in one panel.
         * @param payload - structure text, Mol* format and display label.
         * @returns the structure count after the append.
         */
        async appendStructure(payload) {
          if (disposed) return undefined;
          await viewer.loadStructureFromData(payload.data, payload.format, { dataLabel: payload.label });
          return describeStructures(viewer);
        },
        /**
         * Add a structure component from a compiled query expression with one
         * or more representations (e.g. cartoon + ball-and-stick, uniform color).
         * @param expression - compiled Mol* query expression.
         * @param spec - component spec: key, label, and a representations list of
         *   { type, color? } entries.
         * @returns the created cell refs.
         */
        async addComponent(expression, spec) {
          if (disposed) return undefined;
          const builders = viewer.plugin.builders.structure;
          const current = viewer.plugin.managers.structure.hierarchy.current;
          const root =
            current !== undefined && Array.isArray(current.structures) && current.structures.length > 0
              ? current.structures[0].cell
              : undefined;
          if (root === undefined) throw new Error('No structure is loaded.');
          const key =
            spec && typeof spec.key === 'string' && spec.key !== '' ? spec.key : 'style-' + ++styleCounter;
          const component = await builders.tryCreateComponentFromExpression(root, expression, key, {
            label: spec && typeof spec.label === 'string' && spec.label !== '' ? spec.label : key,
          });
          if (component === undefined) throw new Error('The selection matched nothing.');
          const reps = [];
          for (const rep of spec.representations) {
            const props = { type: rep.type };
            if (typeof rep.color === 'number') {
              props.color = 'uniform';
              props.colorParams = { value: rep.color };
            }
            reps.push(await builders.representation.addRepresentation(component, props));
          }
          styleRefs.push(component.ref);
          return { component: component.ref, representations: reps.map((r) => r.ref) };
        },
        /** Remove the components added through addComponent. */
        async clearComponents() {
          if (disposed) return;
          const refs = styleRefs.splice(0);
          for (const ref of refs) {
            try {
              await viewer.plugin.state.data.build().delete(ref).commit();
            } catch {
              // The cell may already be gone.
            }
          }
        },
        /** The Mol* state snapshot (MolJ JSON), the viewer's save format. */
        getStateSnapshot(params) {
          if (disposed) return undefined;
          const manager = stateManager();
          return manager === undefined ? undefined : manager.getSnapshot(params);
        },
        /** The panel's components with their representations and color themes. */
        listComponents() {
          if (disposed) return [];
          return describeComponents(viewer);
        },
        /** Apply a Mol* state snapshot previously produced by getStateSnapshot. */
        async setStateSnapshot(snapshot) {
          if (disposed) return;
          const manager = stateManager();
          if (manager === undefined) throw new Error('The state manager is unavailable.');
          await manager.setSnapshot(snapshot);
        },
      };
    }

    /**
     * Mount a Mol* viewer for one structure into a positioned host element.
     * @param container - positioned element the viewer fills.
     * @param options - structure text, Mol* format, label and color scheme.
     * @returns the mounted handle: dispose, resize and color-scheme control.
     */
    async function createMolecularViewer(container, options) {
      const mounted = await mountViewer(container, options.scheme);
      try {
        await loadStructure(mounted.viewer, options.data, options.format, options.label);
      } catch (error) {
        abortMount(mounted.viewer, container, mounted.releaseChrome);
        throw error;
      }
      return viewerHandle(mounted.viewer, container, mounted.scheduleResize, mounted.releaseChrome);
    }

    /**
     * Mount a Mol* viewer for a molecular-dynamics trajectory: one model file
     * (GRO/PDB/mmCIF/…) plus one coordinates file (GROMACS xtc/trr, CHARMM
     * dcd, AMBER netcdf, LAMMPS lammpstrj).
     * @param container - positioned element the viewer fills.
     * @param options - model and coordinates payloads, labels, color scheme.
     * @returns the mounted handle, same surface as a structure viewer.
     */
    async function createMolecularTrajectory(container, options) {
      const mounted = await mountViewer(container, options.scheme);
      try {
        await mounted.viewer.loadTrajectory({
          model: {
            kind: 'model-data',
            data: options.model.data,
            format: options.model.format,
          },
          modelLabel: options.model.label,
          coordinates: {
            kind: 'coordinates-data',
            data: options.coordinates.data,
            format: options.coordinates.format,
          },
          coordinatesLabel: options.coordinates.label,
          preset: 'default',
        });
      } catch (error) {
        abortMount(mounted.viewer, container, mounted.releaseChrome);
        throw error;
      }
      return viewerHandle(mounted.viewer, container, mounted.scheduleResize, mounted.releaseChrome);
    }

    exports.createMolecularViewer = createMolecularViewer;
    exports.createMolecularTrajectory = createMolecularTrajectory;

    /**
     * Mount a lazily-windowed trajectory: the first load is a strided window,
     * and scrubbing past the window swaps the coordinates cell for a dense
     * window around the requested global frame.
     * @param container - positioned element the viewer fills.
     * @param options - model payload, coordinates format, scheme, and a
     *   trajectory source { totalFrames, window, blob, readWindow(desc) }.
     * @returns the mounted handle, same surface as a structure viewer.
     */
    async function createMolecularTrajectoryWindowed(container, options) {
      const mounted = await mountViewer(container, options.scheme);
      const plugin = mounted.viewer.plugin;
      const source = options.trajectory;
      const total = source.totalFrames;
      try {
        const result = await mounted.viewer.loadTrajectory({
          model: {
            kind: 'model-data',
            data: options.model.data,
            format: options.model.format,
          },
          modelLabel: options.model.label,
          coordinates: {
            kind: 'coordinates-data',
            data: source.blob,
            format: options.coordinatesFormat,
          },
          coordinatesLabel: options.coordinatesLabel,
          preset: 'default',
        });

        // The coordinates data cell (raw-data) is swapped on window refills.
        const state = plugin.state.data;
        const coordsCell = state.cells.get(result.coords.ref);
        const formatCell =
          coordsCell !== undefined ? state.cells.get(coordsCell.transform.parent) : undefined;
        const dataCell =
          formatCell !== undefined ? state.cells.get(formatCell.transform.parent) : undefined;
        const coordsDataRef = dataCell !== undefined ? dataCell.transform.ref : undefined;

        let window = { ...source.window };
        const mapGlobal = (local) => window.start + local * window.step;
        let applying = false;
        let refining = false;
        let lastLocal = 0;
        let mftRef = undefined;
        let pendingSeek = undefined;
        let disposed = false;

        function setLocalIndex(local) {
          if (mftRef === undefined) return;
          try {
            const clamped = Math.max(0, Math.min(window.count - 1, Math.round(local)));
            void plugin.state.data.build().to(mftRef).update({ modelIndex: clamped }).commit();
            lastLocal = clamped;
          } catch {
            // A stale cell reference only means the trajectory was replaced.
          }
        }

        async function seekNow(target) {
          const W = Math.min(64, total);
          const inWindow =
            window.step === 1 && target >= window.start && target <= window.start + window.count - 1;
          if (!inWindow) {
            await refine(target, Math.floor(W / 2));
          }
          setLocalIndex(target - window.start);
        }

        /** Seek to a global frame from the UI slider; requests merge while a refill runs. */
        async function seekFrame(g) {
          const target = Math.max(0, Math.min(total - 1, Math.round(Number(g) || 0)));
          if (disposed) return;
          if (refining) {
            pendingSeek = target;
            return;
          }
          await seekNow(target);
        }

        async function refine(g, localIndex) {
          if (refining || disposed || coordsDataRef === undefined) return;
          refining = true;
          try {
            const W = Math.min(64, total);
            const start = Math.max(0, Math.min(g - localIndex, total - W));
            const next = { start, step: 1, count: Math.min(W, total - start) };
            const blob = await source.readWindow(next);
            if (disposed) return;
            applying = true;
            await plugin.state.data.build().to(coordsDataRef).update({ data: blob }).commit();
            window = next;
            lastLocal = Math.max(0, Math.min(g - start, next.count - 1));
            if (typeof options.onFrame === 'function') options.onFrame(g, total);
          } catch {
            // Keep the previous window when a refill fails.
          } finally {
            refining = false;
            setTimeout(() => {
              applying = false;
            }, 0);
            const pending = pendingSeek;
            pendingSeek = undefined;
            if (pending !== undefined && !disposed) void seekNow(pending);
          }
        }

        function scan() {
          if (applying || refining || disposed) return;
          for (const cell of plugin.state.data.cells.values()) {
            const params = cell.transform.params;
            if (params === null || typeof params !== 'object' || typeof params.modelIndex !== 'number') {
              continue;
            }
            const local = Math.round(params.modelIndex);
            mftRef = cell.transform.ref;
            const g = mapGlobal(local);
            const playing = local === lastLocal + 1;
            lastLocal = local;
            const clamped = Math.max(0, Math.min(g, total - 1));
            if (typeof options.onFrame === 'function') options.onFrame(clamped, total);
            const lastGlobal = window.start + window.step * (window.count - 1);
            if (g < window.start || g > lastGlobal) {
              void refine(g, local);
            }
            return; // one ModelFromTrajectory cell is enough
          }
        }

        let scanTimer = 0;
        const scheduleScan = () => {
          if (scanTimer !== 0) return;
          scanTimer = setTimeout(() => {
            scanTimer = 0;
            scan();
          }, 120);
        };

        const subscriptions = [];
        if (coordsDataRef !== undefined) {
          const events = plugin.state.data.events;
          const subjects = [
            events && events.object ? events.object.updated : undefined,
            events && events.cell ? events.cell.stateUpdated : undefined,
          ];
          for (const subject of subjects) {
            if (subject !== undefined && typeof subject.subscribe === 'function') {
              const sub = subject.subscribe(scheduleScan);
              subscriptions.push(sub);
            }
          }
        }

        const base = viewerHandle(mounted.viewer, container, mounted.scheduleResize, mounted.releaseChrome);
        return {
          ...base,
          dispose() {
            disposed = true;
            for (const sub of subscriptions) {
              try {
                if (sub !== null && typeof sub === 'object' && typeof sub.unsubscribe === 'function') {
                  sub.unsubscribe();
                }
              } catch {
                // Subscription cleanup is best effort.
              }
            }
            base.dispose();
          },
          snapshot() {
            const snap = base.snapshot();
            snap.trajectory = { total, window: { ...window } };
            return snap;
          },
          /** Seek to a global frame (trajectory slider). */
          seekFrame,
        };
      } catch (error) {
        abortMount(mounted.viewer, container, mounted.releaseChrome);
        throw error;
      }
    }

    exports.createMolecularTrajectoryWindowed = createMolecularTrajectoryWindowed;
    exports.version = ${JSON.stringify(pkg.version)};
    return module.exports;
  },
});
`;

fs.writeFileSync(outFile, chunk);
console.log(`wrote ${outFile} (${(Buffer.byteLength(chunk) / 1024 / 1024).toFixed(2)} MiB, molstar ${pkg.version})`);
