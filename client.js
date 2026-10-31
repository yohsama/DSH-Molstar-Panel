/**
 * Client half of the Mol* structure preview bundle.
 *
 * It contributes one document-preview implementation to the right Sidebar: the
 * registry entry that claims molecular-structure suffixes, and the body that
 * renders them. Everything Mol*-specific (the viewer build, its stylesheets and
 * the DOM adapter) lives in the lazy package-local chunk `./client.molstar.js`,
 * so the ~5 MB viewer is fetched only when a structure file is first opened.
 *
 * The same module carries the panel bridge that lets the `molstar` Host tool
 * read the user's selection and drive the viewer. It long-polls only while a
 * structure preview is mounted, in either sidebar surface.
 */
window.__ModuleLoader__.load({
  id: 'dsh-molstar-preview',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** This bundle's identity; also the document implementation id and slot key. */
    const IMPL_ID = 'dsh-molstar-preview/molstar';
    /** Copy namespace bound for the renderer title and status lines. */
    const LOCALE_NS = 'molstarPreview';
    /** Package-local dynamic chunk holding Mol* itself. */
    const CHUNK = './client.molstar.js';
    /** Prefix of the Sidebar's file resource addresses. */
    const FILE_PREFIX = 'dsh-resource://file/';

    /** Suffix -> Mol* structure (trajectory) format. Keys are matched case-insensitively. */
    const STRUCTURE_FORMATS = {
      pdb: 'pdb',
      ent: 'pdb',
      pdbqt: 'pdbqt',
      pqr: 'pqr',
      cif: 'mmcif',
      mmcif: 'mmcif',
      mcif: 'mmcif',
      mol: 'mol',
      mol2: 'mol2',
      sdf: 'sdf',
      sd: 'sdf',
      xyz: 'xyz',
      gro: 'gro',
    };

    /** Suffix -> Mol* coordinates format for MD trajectories (mostly binary). */
    const TRAJECTORY_FORMATS = {
      xtc: 'xtc',
      trr: 'trr',
      dcd: 'dcd',
      nc: 'nctraj',
      netcdf: 'nctraj',
      lammpstrj: 'lammpstrj',
    };

    /** Every suffix this plugin claims, structure and trajectory alike. */
    const EXTENSION_FORMATS = { ...STRUCTURE_FORMATS, ...TRAJECTORY_FORMATS };

    /** Model files a trajectory looks for first, in its own directory. */
    const TRAJECTORY_MODEL_NAMES = [
      'confout.gro', 'conf.gro', 'start.gro', 'initial.gro', 'topol.gro', 'model.gro',
      'start.pdb', 'initial.pdb', 'conf.pdb', 'topol.pdb', 'model.pdb', 'structure.pdb',
      'start.cif', 'conf.cif', 'topol.cif',
    ];

    const EN = {
      title: 'Mol* 3D structure',
      loading: 'Preparing the 3D view…',
      loadingViewer: 'Loading the Mol* viewer…',
      failed: 'This file could not be displayed as a molecular structure.',
      unsupported: 'This file type is not a molecular structure.',
      noData: 'This file is empty, so there is nothing to display.',
      layoutToggle: 'Move the structure panel',
      layoutBottom: 'Move the structure panel to the bottom',
      layoutRight: 'Move the structure panel to the right',
      pinToChat: 'Send this panel to the chat',
      pinInserted: 'Inserted into the chat input — press Enter to send',
      pinCopied: 'Copied — paste it into the chat to bind this panel',
      pinFailed: 'Copy failed — check clipboard permission',
      pinNoView: 'The viewer is not ready yet',
      tabDescription: 'Molecular structures (PDB, MMCIF/CIF, …) shown with Mol* inside the sidebar.',
      tabHint: 'Open a structure file from the file tree, or pick one from this workspace folder.',
      tabNoStructures: 'No structure files in this folder.',
      tabLoading: 'Looking for structure files…',
      trajModelLoading: 'Looking for a matching structure file (gro/pdb/cif) next to the trajectory…',
      trajModelMissing: 'No structure file (gro/pdb/cif) found next to the trajectory.',
      frameSlider: 'Trajectory frame',
    };
    const ZH = {
      title: 'Mol* 3D 结构',
      loading: '正在准备 3D 视图…',
      loadingViewer: '正在加载 Mol* 查看器…',
      failed: '无法将此文件作为分子结构显示。',
      unsupported: '该文件不是分子结构文件。',
      noData: '文件内容为空，没有可显示的结构。',
      layoutToggle: '调整结构面板位置',
      layoutBottom: '把结构面板移到下方',
      layoutRight: '把结构面板移到右侧',
      pinToChat: '把此面板发送到对话',
      pinInserted: '已插入对话输入框——回车即可发送',
      pinCopied: '已复制——粘贴到对话即可绑定此面板',
      pinFailed: '复制失败——请检查剪贴板权限',
      pinNoView: '查看器尚未就绪',
      tabDescription: '在侧边栏里用 Mol* 显示分子结构（PDB、MMCIF/CIF 等）。',
      tabHint: '从文件树打开结构文件，或在下方选择当前工作目录里的文件。',
      tabNoStructures: '这个目录里没有结构文件。',
      tabLoading: '正在查找结构文件…',
      trajModelLoading: '正在查找轨迹旁边的结构文件（gro/pdb/cif）…',
      trajModelMissing: '轨迹旁边没有找到结构文件（gro/pdb/cif）。',
      frameSlider: '轨迹帧',
    };

    /** Renderer chrome; colors and type come from the Harness theme tokens. */
    const PREVIEW_CSS = [
      '.msp-preview{position:absolute;inset:0;display:flex;min-width:0;min-height:0;',
      'background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);',
      'font-family:var(--dsw-font-family);font-size:var(--dsh-content-font-size-secondary,13px);',
      'line-height:1.6;white-space:normal;text-align:left}',
      '.msp-preview-host{position:relative;flex:1 1 auto;min-width:0;min-height:0;display:flex}',
      '.msp-preview-status{position:absolute;inset:0;display:flex;flex-direction:column;',
      'align-items:center;justify-content:center;gap:6px;padding:20px;text-align:center;',
      'color:var(--dsw-alias-label-secondary);pointer-events:none}',
      '.msp-preview[data-molstar-ready] .msp-preview-status{display:none}',
      '.msp-preview-message{margin:0;color:var(--dsw-alias-label-primary)}',
      '.msp-preview-detail{margin:0;max-width:32ch;word-break:break-word;',
      'font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px;',
      'color:var(--dsw-alias-state-error-primary)}',
      // Trajectory slider bar along the bottom of the preview.
      '.msp-traj-controls{position:absolute;left:8px;right:8px;bottom:8px;z-index:8;display:flex;',
      'align-items:center;gap:10px;padding:6px 10px;border-radius:8px;',
      'background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1)}',
      '.msp-traj-controls input[type=range]{flex:1 1 auto;min-width:0;margin:0;',
      'accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.msp-traj-label{flex:none;color:var(--dsw-alias-label-secondary);white-space:nowrap;',
      'font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;line-height:1.5}',
      // "Send this panel to the chat" — anchored inside the canvas area (the
      // same insets Mol*'s main region gets), so it floats over the 3D view in
      // both panel layouts and inside Better Sidebar surfaces too.
      '.msp-pin-btn{position:absolute;z-index:8;display:inline-flex;align-items:center;justify-content:center;',
      'width:26px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;',
      'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:.85}',
      '.msp-preview[data-molstar-layout="right"] .msp-pin-btn{',
      'top:calc(clamp(84px,24%,160px) + 10px);right:calc(clamp(170px,46%,320px) + 50px)}',
      '.msp-preview[data-molstar-layout="bottom"] .msp-pin-btn{',
      'top:calc(clamp(84px,24%,160px) + 10px);right:50px}',
      '.msp-pin-btn:hover{color:var(--dsw-alias-label-primary);opacity:1}',
      '.msp-pin-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.msp-pin-btn[data-molstar-panel-pin="copied"],.msp-pin-btn[data-molstar-panel-pin="inserted"]{color:var(--dsw-alias-state-success-primary);',
      'border-color:var(--dsw-alias-state-success-primary)}',
      // Mol*'s own layouts use fixed pixel insets sized for a full window. In a
      // Sidebar pane the sequence bar and the structure panel are arranged
      // against this container instead: `data-molstar-layout` chooses whether
      // the panel sits on the right or under the viewport.
      '.msp-preview[data-molstar-layout="right"] .msp-plugin .msp-layout-standard-landscape .msp-layout-top{',
      'position:absolute;inset:0 0 auto 0;height:clamp(84px,24%,160px)}',
      '.msp-preview[data-molstar-layout="right"] .msp-plugin .msp-layout-standard-landscape .msp-layout-main{',
      'position:absolute;inset:clamp(84px,24%,160px) clamp(170px,46%,320px) 0 0}',
      '.msp-preview[data-molstar-layout="right"] .msp-plugin .msp-layout-standard-landscape .msp-layout-right{',
      'position:absolute;inset:clamp(84px,24%,160px) 0 0 auto;width:clamp(170px,46%,320px)}',
      '.msp-preview[data-molstar-layout="bottom"] .msp-plugin .msp-layout-standard-landscape .msp-layout-top{',
      'position:absolute;inset:0 0 auto 0;height:clamp(84px,24%,160px)}',
      '.msp-preview[data-molstar-layout="bottom"] .msp-plugin .msp-layout-standard-landscape .msp-layout-main{',
      'position:absolute;inset:clamp(84px,24%,160px) 0 clamp(150px,38%,320px) 0}',
      '.msp-preview[data-molstar-layout="bottom"] .msp-plugin .msp-layout-standard-landscape .msp-layout-right{',
      'position:absolute;inset:auto 0 0 0;height:clamp(150px,38%,320px);width:auto;border-left:0;',
      'border-top:1px solid var(--dsw-alias-border-l1)}',
      // Toggling the control panel off must give its space back to the
      // viewport: the regions are hidden by Mol*'s own rules, so only the
      // reserved insets need collapsing here.
      '.msp-preview[data-molstar-layout="right"] .msp-plugin .msp-layout-standard-landscape .msp-layout-hide-top .msp-layout-main{',
      'top:0}',
      '.msp-preview[data-molstar-layout="right"] .msp-plugin .msp-layout-standard-landscape .msp-layout-hide-right .msp-layout-main{',
      'right:0}',
      '.msp-preview[data-molstar-layout="right"] .msp-plugin .msp-layout-standard-landscape .msp-layout-hide-top.msp-layout-hide-right .msp-layout-main{',
      'inset:0}',
      '.msp-preview[data-molstar-layout="bottom"] .msp-plugin .msp-layout-standard-landscape .msp-layout-hide-top .msp-layout-main{',
      'top:0}',
      '.msp-preview[data-molstar-layout="bottom"] .msp-plugin .msp-layout-standard-landscape .msp-layout-hide-right .msp-layout-main{',
      'bottom:0}',
      '.msp-preview[data-molstar-layout="bottom"] .msp-plugin .msp-layout-standard-landscape .msp-layout-hide-top.msp-layout-hide-right .msp-layout-main{',
      'inset:0}',
      '.msp-preview .msp-plugin .msp-layout-standard-landscape .msp-layout-top .msp-layout-static{overflow:hidden}',
    ].join('');

    /** Chrome for the header control that moves the structure panel. */
    const TOGGLE_CSS = [
      '.msp-layout-toggle{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;',
      'padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.msp-layout-toggle:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.msp-layout-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
    ].join('');

    /** Chrome for the standalone sidebar tab and its structure-file picker. */
    const TAB_CSS = [
      '.msp-tab{position:relative;display:flex;flex-direction:column;height:100%;min-height:320px;',
      'background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);',
      'font-family:var(--dsw-font-family);font-size:var(--dsh-content-font-size-secondary,13px);white-space:normal}',
      '.msp-tab-surface{position:relative;flex:1 1 auto;min-height:0}',
      '.msp-tab-picker{display:flex;flex-direction:column;gap:10px;padding:16px;overflow:auto}',
      '.msp-tab-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.msp-tab-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}',
      '.msp-tab-file{display:block;width:100%;text-align:left;padding:6px 8px;border:0;border-radius:5px;',
      'background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.msp-tab-file:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.msp-tab-file:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
    ].join('');

    /** Decode one address segment without ever throwing on malformed input. */
    function decodeSegment(segment) {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    }

    /**
     * Read the file path out of a Sidebar file address.
     * @param address - `dsh-resource://file/session/<sessionId>/<path>` or the absolute form.
     * @returns the decoded path, or an empty string when the address is not a file address.
     */
    function filePathOf(address) {
      if (typeof address !== 'string' || !address.startsWith(FILE_PREFIX)) return '';
      const end = address.search(/[?#]/);
      const body = address.slice(FILE_PREFIX.length, end === -1 ? undefined : end);
      const parts = body.split('/');
      if (parts[0] === 'session') return parts.slice(2).map(decodeSegment).join('/');
      if (parts[0] === 'absolute') return parts.slice(1).map(decodeSegment).join('/');
      return '';
    }

    /** @param path - a decoded path. @returns its final segment. */
    function fileNameOf(path) {
      const normalized = path.replace(/\\/g, '/');
      return normalized.slice(normalized.lastIndexOf('/') + 1);
    }

    /** @param address - a Sidebar file address. @returns the Session id it carries, or undefined. */
    function sessionIdOfAddress(address) {
      if (typeof address !== 'string' || !address.startsWith(FILE_PREFIX)) return undefined;
      const end = address.search(/[?#]/);
      const parts = address.slice(FILE_PREFIX.length, end === -1 ? undefined : end).split('/');
      return parts[0] === 'session' && parts[1] !== undefined && parts[1] !== ''
        ? decodeSegment(parts[1])
        : undefined;
    }

    /** @param name - a file name. @returns the lowercased suffix without its dot. */
    function suffixOf(name) {
      const dot = name.lastIndexOf('.');
      return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
    }

    /** @param name - a file name. @returns the Mol* format for that suffix, or undefined. */
    function formatOf(name) {
      return EXTENSION_FORMATS[suffixOf(name)];
    }

    /** @param name - a file name. @returns its Mol* coordinates format when it is a trajectory, or undefined. */
    function trajectoryFormatOf(name) {
      return TRAJECTORY_FORMATS[suffixOf(name)];
    }

    /** @param path - a file path. @returns its parent directory, '' when there is none. */
    function directoryOf(path) {
      const normalized = String(path).replace(/\\/g, '/');
      const cut = normalized.lastIndexOf('/');
      return cut < 0 ? '' : normalized.slice(0, cut);
    }

    /**
     * Unwrap a RemoteResult: return its value, or throw the remote error's message.
     * @param result - a `ctx.remote` call result.
     * @param fallbackMessage - used when the error carries no message.
     * @returns the unwrapped value.
     */
    function unwrapRemote(result, fallbackMessage) {
      if (result !== null && result !== undefined && result.ok === false) {
        const message =
          result.error !== null && result.error !== undefined && typeof result.error.message === 'string'
            ? result.error.message
            : fallbackMessage;
        throw new Error(message);
      }
      return result !== null && result !== undefined && result.ok === true ? result.value : result;
    }

    /** '#rgb'/'#rrggbb'/'rgb(r,g,b)' to a color int for Mol* uniform color themes. */
    function styleColorToInt(value) {
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

    /**
     * Decode file bytes for Mol*'s text parsers.
     * @param data - the complete file bytes.
     * @returns UTF-8 text, or latin-1 when the bytes are not valid UTF-8.
     */
    function decodeText(data) {
      if (typeof data === 'string') return data;
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
      if (!(bytes instanceof Uint8Array)) return '';
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        return new TextDecoder('latin1').decode(bytes);
      }
    }

    /**
     * Track the active theme's color scheme so the viewer can follow light/dark.
     * @param ctx - the Client plugin context.
     * @returns a store with `getScheme()` and `subscribe()` for `useSyncExternalStore`.
     */
    function createThemeStore(ctx) {
      let snapshot = ctx.theme.getTheme();
      const listeners = new Set();
      ctx.on('theme/change', (next) => {
        snapshot = next && next.active ? next : ctx.theme.getTheme();
        for (const listener of listeners) listener();
      });
      return {
        getScheme: () => (snapshot.active && snapshot.active.colorScheme === 'dark' ? 'dark' : 'light'),
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    }

    // ---------------------------------------------------------------------
    // Panel bridge. The Mol* panel lives in this browser context, while the
    // `molstar` tool runs on the Host, so the two meet at one loopback HTTP
    // route: the panel long-polls for commands and posts back snapshots and
    // results. Only this Session's open previews answer.
    // ---------------------------------------------------------------------
    /** Loopback route the Host half registers for the panel bridge. */
    const BRIDGE_PATH = '/molstar-bridge';
    /** Mounted viewers, newest last, so a command reaches the visible panel. */
    const viewers = new Map();
    /** One poll loop per Session that currently has a preview mounted. */
    const bridges = new Map();
    /** This plugin's context, kept for bridge-side file reads (the load op). */
    let pluginCtxRef = undefined;
    let viewSequence = 0;

    /**
     * Whether this page can reach the loopback bridge. The desktop shell serves
     * the page from file:// and carries `fetch` over an IPC bridge, so the
     * protocol says nothing about reachability: a relative fetch is the test.
     * @returns whether `fetch` exists.
     */
    function bridgeAvailable() {
      return typeof fetch === 'function';
    }

    /** One no-op probe per page load: proves the module is live and can reach the bridge route. */
    if (bridgeAvailable()) {
      fetch(`${BRIDGE_PATH}?session=__probe&wait=0`, { cache: 'no-store' }).catch(() => {});
    }

    /** Register one mounted viewer and make sure its Session's loop loop runs. */
    function registerViewer(view) {
      viewers.set(view.viewId, view);
      if (!bridgeAvailable()) return;
      let bridge = bridges.get(view.sessionId);
      if (bridge === undefined) {
        bridge = {
          sessionId: view.sessionId,
          clientId: `panel-${Date.now().toString(36)}-${(viewSequence++).toString(36)}`,
          abort: new AbortController(),
          count: 0,
          active: true,
        };
        bridges.set(view.sessionId, bridge);
        void bridgeLoop(bridge);
      }
      bridge.count += 1;
    }

    /** Drop one mounted viewer; the last one out stops its Session's loop. */
    function unregisterViewer(viewId) {
      const view = viewers.get(viewId);
      viewers.delete(viewId);
      if (view === undefined) return;
      const bridge = bridges.get(view.sessionId);
      if (bridge === undefined) return;
      bridge.count -= 1;
      if (bridge.count > 0) return;
      bridges.delete(view.sessionId);
      bridge.active = false;
      bridge.abort.abort();
    }

    /** @returns the most recently mounted viewer, or undefined. */
    function currentView() {
      let newest;
      for (const view of viewers.values()) {
        if (newest === undefined || view.at > newest.at) newest = view;
      }
      return newest;
    }

    /** @param ms - delay. @returns a promise that settles after it. */
    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Turn selected residues into an equivalent PyMOL selection, the same
     * language the tool accepts back.
     * @param residues - resolved residues from the viewer snapshot.
     * @returns one parenthesized clause per chain, joined with `or`.
     */
    function pymolFor(residues) {
      const byChain = new Map();
      for (const residue of residues) {
        const key = residue.chain === undefined || residue.chain === '' ? '' : String(residue.chain);
        const list = byChain.get(key) ?? [];
        list.push(Number(residue.seq));
        byChain.set(key, list);
      }
      const clauses = [];
      for (const [chain, numbers] of byChain) {
        const sorted = [...new Set(numbers)].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
        if (sorted.length === 0) continue;
        const runs = [];
        let start = sorted[0];
        let previous = sorted[0];
        for (const value of sorted.slice(1)) {
          if (value === previous + 1) {
            previous = value;
            continue;
          }
          runs.push(start === previous ? String(start) : `${start}-${previous}`);
          start = value;
          previous = value;
        }
        runs.push(start === previous ? String(start) : `${start}-${previous}`);
        clauses.push(chain === '' ? `resi ${runs.join('+')}` : `chain ${chain} and resi ${runs.join('+')}`);
      }
      return clauses.map((clause) => `(${clause})`).join(' or ');
    }

    /** Describe one mounted viewer for the tool: file, size and selection. */
    function describeView(view) {
      const snapshot = view.handle.snapshot();
      const residues = snapshot.selection.residues ?? [];
      return {
        file: view.fileName,
        format: view.format,
        layout: layoutStore.get(),
        structures: snapshot.structures,
        units: snapshot.units,
        selection: {
          atoms: snapshot.selection.elementCount,
          residues,
          pymol: pymolFor(residues),
        },
      };
    }

    /** Run one bridge command against the bound or current viewer. */
    async function runCommand(command) {
      const id = command === null || command === undefined ? undefined : command.id;
      const view = viewers.get(command && command.viewId) !== undefined
        ? viewers.get(command.viewId)
        : currentView();
      if (view === undefined) {
        return {
          id,
          ok: false,
          error: 'No Mol* structure preview is open in this window. Open a .pdb/.cif file in the right Sidebar first.',
        };
      }
      try {
        if (command.op === 'layout') {
          layoutStore.set(command.layout === 'bottom' ? 'bottom' : 'right');
          await sleep(120);
          return { id, ok: true, result: describeView(view) };
        }
        if (command.op === 'clear-style') {
          await view.handle.clearComponents();
          await sleep(120);
          return { id, ok: true, result: describeView(view) };
        }
        if (command.op === 'components') {
          if (typeof view.handle.listComponents !== 'function') {
            throw new Error('The open panel runs an older viewer module — refresh the page and retry.');
          }
          const result = describeView(view);
          result.components = view.handle.listComponents();
          return { id, ok: true, result };
        }
        if (command.op === 'opacity') {
          if (typeof view.handle.setRepresentationOpacity !== 'function') {
            throw new Error('The open panel runs an older viewer module — refresh the page and retry.');
          }
          const result = describeView(view);
          result.components = await view.handle.setRepresentationOpacity({
            component: command.component,
            representation: command.representation,
            alpha: command.alpha,
          });
          result.opacitySet = {
            component: command.component,
            representation: command.representation,
            alpha: command.alpha,
          };
          return { id, ok: true, result };
        }
        if (command.op === 'load') {
          if (typeof command.path !== 'string' || command.path.trim() === '') {
            throw new Error('`path` is required for load');
          }
          const files = workspaceFilesOf(pluginCtxRef);
          if (files === undefined) throw new Error('The workspace file reader is unavailable.');
          const read = unwrapRemote(
            await files.readBytes(view.sessionId, command.path, {}, undefined),
            'The file could not be read.',
          );
          const name = fileNameOf(String(command.path).replace(/\\/g, '/'));
          const format = STRUCTURE_FORMATS[suffixOf(name.toLowerCase())];
          if (format === undefined) {
            throw new Error(`Unsupported structure suffix ".${suffixOf(name.toLowerCase())}".`);
          }
          if (typeof view.handle.appendStructure !== 'function') {
            throw new Error('The open panel runs an older viewer module — refresh the page and retry.');
          }
          await view.handle.appendStructure({ data: decodeText(read !== null && read !== undefined ? read.data : undefined), format, label: name });
          await sleep(250);
          const result = describeView(view);
          result.loadedFile = name;
          return { id, ok: true, result };
        }
        if (command.op === 'state') {
          if (command.snapshot !== undefined && command.snapshot !== null) {
            await view.handle.setStateSnapshot(command.snapshot);
            await sleep(250);
          }
          const snapshot = view.handle.getStateSnapshot();
          const result = describeView(view);
          result.state = snapshot === undefined ? null : JSON.parse(JSON.stringify(snapshot));
          return { id, ok: true, result };
        }
        if (command.op === 'style') {
          if (typeof command.expression !== 'string' || command.expression.trim() === '') {
            throw new Error('`expression` is required for style');
          }
          const script = await require.async('./client.molscript.js');
          const expression =
            command.language === 'mol-script'
              ? script.toExpression(command.expression)
              : script.toPymolExpression(command.expression);
          if (command.clear === true) await view.handle.clearComponents();
          const fallbackColor = typeof command.color === 'string' ? styleColorToInt(command.color) : undefined;
          const representations = (
            Array.isArray(command.representations) && command.representations.length > 0
              ? command.representations
              : [{ type: 'ball-and-stick' }]
          ).map((rep) => ({
            type: typeof rep === 'object' && rep !== null && typeof rep.type === 'string' ? rep.type : 'ball-and-stick',
            color:
              typeof rep === 'object' && rep !== null && typeof rep.color === 'string'
                ? styleColorToInt(rep.color)
                : fallbackColor,
          }));
          const refs = await view.handle.addComponent(expression, {
            key: typeof command.key === 'string' && command.key !== '' ? command.key : undefined,
            label: typeof command.label === 'string' && command.label !== '' ? command.label : undefined,
            representations,
          });
          await sleep(200);
          const result = describeView(view);
          result.applied = {
            expression: command.expression,
            action: 'style',
            label: typeof command.label === 'string' ? command.label : undefined,
          };
          result.style = refs;
          return { id, ok: true, result };
        }
        if (command.op === 'snapshot') {
          return { id, ok: true, result: describeView(view) };
        }
        if (command.op === 'reset') {
          view.handle.resetCamera();
          await sleep(250);
          return { id, ok: true, result: describeView(view) };
        }
        if (command.op === 'clear') {
          view.handle.clearMarks(command.action || 'select');
          await sleep(120);
          return { id, ok: true, result: describeView(view) };
        }
        if (command.op === 'apply') {
          if (typeof command.expression !== 'string' || command.expression.trim() === '') {
            throw new Error('`expression` is required for apply');
          }
          const script = await require.async('./client.molscript.js');
          const expression =
            command.language === 'mol-script'
              ? script.toExpression(command.expression)
              : script.toPymolExpression(command.expression);
          view.handle.applyExpression(expression, command.action || 'select');
          await sleep(150);
          const result = describeView(view);
          result.applied = {
            expression: command.expression,
            language: command.language === 'mol-script' ? 'mol-script' : 'pymol',
            action: command.action || 'select',
          };
          return { id, ok: true, result };
        }
        return { id, ok: false, error: `unknown bridge operation ${JSON.stringify(command.op)}` };
      } catch (error) {
        return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    /** Long-poll the Host route, answer commands, and post the replies back. */
    async function bridgeLoop(bridge) {
      while (bridge.active) {
        try {
          const url = `${BRIDGE_PATH}?session=${encodeURIComponent(bridge.sessionId)}&client=${encodeURIComponent(bridge.clientId)}&wait=20000`;
          const response = await fetch(url, {
            signal: bridge.abort.signal,
            cache: 'no-store',
            headers: { accept: 'application/json' },
          });
          if (!response.ok) throw new Error(`bridge ${response.status}`);
          const payload = await response.json();
          if (payload !== null && payload !== undefined && payload.command) {
            const reply = await runCommand(payload.command);
            await fetch(BRIDGE_PATH, {
              method: 'POST',
              signal: bridge.abort.signal,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ session: bridge.sessionId, client: bridge.clientId, reply }),
            });
          }
          bridge.failures = 0;
        } catch {
          if (!bridge.active) return;
          bridge.failures = (bridge.failures ?? 0) + 1;
          await sleep(Math.min(30000, 1000 * 2 ** Math.min(bridge.failures, 5)));
        }
      }
    }

    /**
     * The structure panel's position: on the right of the viewport or under it.
     * Persisted per browser so every preview keeps the chosen arrangement.
     */
    const LAYOUT_STORAGE_KEY = 'dsh-molstar-panel-layout';
    const layoutListeners = new Set();
    let layoutMode = (() => {
      try {
        return window.localStorage.getItem(LAYOUT_STORAGE_KEY) === 'bottom' ? 'bottom' : 'right';
      } catch {
        return 'right';
      }
    })();
    const layoutStore = {
      get: () => layoutMode,
      subscribe: (listener) => {
        layoutListeners.add(listener);
        return () => layoutListeners.delete(listener);
      },
      set: (mode) => {
        const next = mode === 'bottom' ? 'bottom' : 'right';
        if (next === layoutMode) return next;
        layoutMode = next;
        try {
          window.localStorage.setItem(LAYOUT_STORAGE_KEY, next);
        } catch {
          // A blocked storage only loses the preference across reloads.
        }
        for (const listener of layoutListeners) listener();
        return next;
      },
      toggle: () => layoutStore.set(layoutMode === 'right' ? 'bottom' : 'right'),
    };

    /**
     * Header control that switches the structure panel between right and bottom.
     * Rendered only for the molecular-structure files this plugin previews.
     * @param props - document action props: the file's absolute path and copy.
     * @returns the toggle button, or nothing for other files.
     */
    function LayoutToggle(props) {
      const mode = React.useSyncExternalStore(layoutStore.subscribe, layoutStore.get, layoutStore.get);
      const path = typeof props.absolutePath === 'string' ? props.absolutePath : '';
      if (formatOf(fileNameOf(path)) === undefined) return null;
      const toBottom = mode === 'right';
      const label =
        typeof props.t === 'function'
          ? props.t(toBottom ? 'layoutBottom' : 'layoutRight')
          : toBottom
            ? 'Move the structure panel to the bottom'
            : 'Move the structure panel to the right';
      return h(
        React.Fragment,
        null,
        h('style', null, TOGGLE_CSS),
        h(
          'button',
          {
            type: 'button',
            className: 'msp-layout-toggle',
            title: label,
            'aria-label': label,
            'data-molstar-panel-layout': mode,
            onClick: () => layoutStore.toggle(),
          },
          h(
            'svg',
            { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: 'false' },
            h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 1.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }),
            toBottom
              ? h('rect', { x: 1.5, y: 9.5, width: 13, height: 4, rx: 1.2, fill: 'currentColor', opacity: 0.45 })
              : h('rect', { x: 9.5, y: 2.5, width: 5, height: 11, rx: 1.2, fill: 'currentColor', opacity: 0.45 }),
          ),
        ),
      );
    }

    /** Encode one mounted viewer's identity into a bind token for the chat. */
    function encodePanelToken(view) {
      try {
        const json = JSON.stringify({ v: 1, s: view.sessionId, w: view.viewId, f: view.fileName });
        const bytes = new TextEncoder().encode(json);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      } catch {
        return undefined;
      }
    }

    /** Copy text to the clipboard, best effort across clipboard APIs. */
    async function copyTextToClipboard(text) {
      try {
        if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        // Fall through to the legacy path.
      }
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok === true;
      } catch {
        return false;
      }
    }

    /**
     * One Mol* canvas: creates the viewer for the given bytes, reports status,
     * and registers the mounted viewer for the panel bridge.
     * @param props - structure bytes, file identity, Session, copy and theme store.
     * @returns the viewer host and, until it is ready, a status line.
     */
    function MolecularSurface(props) {
      const {
        bytes,
        fileName,
        format,
        sessionId,
        t,
        themeStore,
        pending,
        errorText,
        model,
        modelPending,
        trajectory,
        inputActions,
        pluginCtx,
      } = props;
      const isTrajectory = trajectoryFormatOf(fileName) !== undefined;
      const effectiveBytes = trajectory !== undefined ? trajectory.blob : bytes;
      const [frameInfo, setFrameInfo] = React.useState(undefined);
      const [pinState, setPinState] = React.useState('idle');

      /** Copy this panel's bind token (and current selection) for the chat. */
      const onPinPanel = async () => {
        if (typeof sessionId !== 'string' || sessionId === '' || format === undefined) {
          setPinState('noView');
          setTimeout(() => setPinState('idle'), 2000);
          return;
        }
        const token = encodePanelToken({ sessionId, viewId, fileName });
        if (token === undefined) {
          setPinState('failed');
          setTimeout(() => setPinState('idle'), 2000);
          return;
        }
        let text = '@molstar 绑定面板 ' + token;
        try {
          const handle = handleRef.current;
          if (handle !== null && typeof handle.snapshot === 'function') {
            const snapshot = handle.snapshot();
            if (
              snapshot !== undefined &&
              snapshot.selection !== undefined &&
              typeof snapshot.selection.pymol === 'string' &&
              snapshot.selection.pymol !== ''
            ) {
              text += '\n当前选中: ' + snapshot.selection.pymol;
            }
          }
        } catch {
          // The selection line is optional.
        }
        // 1) Insert into the owning Session's composer through its input shell.
        let inserted = false;
        try {
          const sessions =
            pluginCtx !== undefined && typeof pluginCtx.get === 'function' ? pluginCtx.get('sessions') : undefined;
          const scope = sessions !== undefined && typeof sessions.scope === 'function' ? sessions.scope(sessionId) : undefined;
          if (scope !== undefined && typeof scope.emit === 'function') {
            inserted = scope.emit('slash/input-insert-text', { text: text + '\n', span: undefined, continue: true }) === true;
          }
        } catch {
          inserted = false;
        }
        // 2) Slot-provided inputActions, when present.
        if (!inserted) {
          try {
            if (
              inputActions !== undefined &&
              inputActions !== null &&
              typeof inputActions.captureInsertion === 'function' &&
              typeof inputActions.insertText === 'function'
            ) {
              const span = inputActions.captureInsertion();
              inserted = inputActions.insertText(text + '\n', span) === true;
            }
          } catch {
            inserted = false;
          }
        }
        if (inserted) {
          setPinState('inserted');
          setTimeout(() => setPinState('idle'), 2500);
          return;
        }
        // 3) Clipboard fallback.
        const ok = await copyTextToClipboard(text);
        setPinState(ok === true ? 'copied' : 'failed');
        setTimeout(() => setPinState('idle'), 2500);
      };
      const hostRef = React.useRef(null);
      const handleRef = React.useRef(null);
      const viewId = React.useId();
      const [status, setStatus] = React.useState('loading');
      const [failure, setFailure] = React.useState('');
      const scheme = React.useSyncExternalStore(
        themeStore.subscribe,
        themeStore.getScheme,
        themeStore.getScheme,
      );
      const panelLayout = React.useSyncExternalStore(
        layoutStore.subscribe,
        layoutStore.get,
        layoutStore.get,
      );

      const hasBytes =
        effectiveBytes !== undefined && (effectiveBytes.byteLength === undefined || effectiveBytes.byteLength > 0);

      React.useEffect(() => {
        const host = hostRef.current;
        if (host === null || !hasBytes || format === undefined) return undefined;
        if (isTrajectory && (model === undefined || model.format === undefined || trajectory === undefined)) {
          return undefined;
        }
        let live = true;
        let handle = null;
        setStatus('loading');
        setFailure('');

        (async () => {
          const api = await require.async(CHUNK);
          if (!live) return;
          if (isTrajectory) {
            if (trajectory !== undefined) {
              handle = await api.createMolecularTrajectoryWindowed(host, {
                model: {
                  data: decodeText(model.bytes),
                  format: model.format,
                  label: model.fileName,
                },
                coordinatesFormat: format,
                coordinatesLabel: fileName,
                scheme: themeStore.getScheme(),
                trajectory,
                onFrame: (g, total) => setFrameInfo({ g, total }),
              });
            } else {
              handle = await api.createMolecularTrajectory(host, {
                model: {
                  data: decodeText(model.bytes),
                  format: model.format,
                  label: model.fileName,
                },
                coordinates: { data: effectiveBytes, format, label: fileName },
                scheme: themeStore.getScheme(),
              });
            }
          } else {
            handle = await api.createMolecularViewer(host, {
              data: decodeText(effectiveBytes),
              format,
              label: fileName,
              scheme: themeStore.getScheme(),
            });
          }
          if (!live) {
            handle.dispose();
            handle = null;
            return;
          }
          handleRef.current = handle;
          if (sessionId !== undefined) {
            registerViewer({ viewId, sessionId, handle, fileName, format, at: Date.now() });
          }
          setStatus('ready');
        })().catch((error) => {
          if (!live) return;
          setStatus('failed');
          setFailure(error instanceof Error ? error.message : String(error));
        });

        return () => {
          live = false;
          handleRef.current = null;
          if (handle !== null) handle.dispose();
          if (host !== null) host.replaceChildren();
          unregisterViewer(viewId);
        };
      }, [effectiveBytes, hasBytes, format, fileName, themeStore, model, isTrajectory, trajectory]);

      React.useEffect(() => {
        const handle = handleRef.current;
        if (handle === null) return;
        handle.setColorScheme(scheme);
      }, [scheme, status]);

      let statusLine = '';
      if (format === undefined) statusLine = t('unsupported');      else if (
        isTrajectory &&
        (model === undefined || model.bytes === undefined || model.bytes.byteLength === 0)
      ) {
        statusLine =
          modelPending === true
            ? t('trajModelLoading')
            : typeof errorText === 'string' && errorText !== ''
              ? errorText
              : t('trajModelMissing');
      } else if (!hasBytes) {
        statusLine =
          pending === true
            ? t('loadingViewer')
            : typeof errorText === 'string' && errorText !== ''
              ? errorText
              : t('noData');
      }
      else if (status === 'failed') statusLine = t('failed');
      else statusLine = t('loadingViewer');

      const pinLabel =
        typeof t === 'function'
          ? t(
              pinState === 'inserted'
                ? 'pinInserted'
                : pinState === 'copied'
                  ? 'pinCopied'
                  : pinState === 'failed'
                    ? 'pinFailed'
                    : pinState === 'noView'
                      ? 'pinNoView'
                      : 'pinToChat',
            )
          : 'Send this panel to the chat';

      return h(
        'div',
        {
          className: 'msp-preview',
          'data-molstar-preview': true,
          'data-molstar-layout': panelLayout,
          'data-molstar-state': status,
          'data-molstar-format': format,
          'data-molstar-ready': status === 'ready' ? '' : undefined,
        },
        h('style', null, PREVIEW_CSS),
        h('div', { ref: hostRef, className: 'msp-preview-host', 'data-molstar-host': true }),
        isTrajectory && trajectory !== undefined
          ? h(
              'div',
              { className: 'msp-traj-controls', 'data-molstar-traj-controls': true },
              h('input', {
                type: 'range',
                min: 0,
                max: Math.max(0, trajectory.totalFrames - 1),
                value: frameInfo !== undefined ? frameInfo.g : 0,
                'aria-label': t('frameSlider'),
                onChange: (event) => {
                  const next = Math.max(
                    0,
                    Math.min(trajectory.totalFrames - 1, Math.round(Number(event.target.value) || 0)),
                  );
                  setFrameInfo({ g: next, total: trajectory.totalFrames });
                  const handle = handleRef.current;
                  if (handle !== null && typeof handle.seekFrame === 'function') handle.seekFrame(next);
                },
              }),
              h(
                'span',
                { className: 'msp-traj-label' },
                frameInfo !== undefined
                  ? `${frameInfo.g + 1} / ${frameInfo.total}`
                  : `1 / ${trajectory.totalFrames}`,
              ),
            )
          : null,
        format !== undefined
          ? h(
              'button',
              {
                type: 'button',
                className: 'msp-pin-btn',
                title: pinLabel,
                'aria-label': pinLabel,
                'data-molstar-panel-pin': pinState,
                onClick: onPinPanel,
              },
              h(
                'svg',
                { viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true, focusable: 'false' },
                h('path', {
                  d: 'M2 3.5A1.5 1.5 0 0 1 3.5 2h7A1.5 1.5 0 0 1 12 3.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-2.6 2.2a.5.5 0 0 1-.8-.4V10h-.1A1.5 1.5 0 0 1 2 8.5v-5Z',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 1.2,
                  strokeLinejoin: 'round',
                }),
                h('circle', { cx: 7, cy: 6, r: 2.1, fill: 'currentColor', opacity: pinState === 'copied' || pinState === 'inserted' ? 1 : 0.45 }),
              ),
            )
          : null,
        status !== 'ready' &&
          h(
            'div',
            {
              className: 'msp-preview-status',
              'data-molstar-status': status,
              role: status === 'failed' ? 'alert' : 'status',
            },
            h('p', { className: 'msp-preview-message' }, statusLine),
            status === 'failed' && failure !== ''
              ? h('p', { className: 'msp-preview-detail' }, failure)
              : null,
          ),
      );
    }

    /**
     * Document-preview adapter: the sidebar document body's address and bytes
     * become one molecular canvas.
     * @param props - document body props.
     * @returns the canvas.
     */
    function MolstarPreview(props) {
      const { content, resourceAddress, t, themeStore, pluginCtx, inputActions } = props;
      const sessionId =
        props.sessionId !== undefined ? props.sessionId : sessionIdOfAddress(resourceAddress);
      const path = filePathOf(resourceAddress);
      const fileName = fileNameOf(path);
      const format = formatOf(fileName);
      const bytes = content !== undefined && content.kind === 'bytes' ? content.data : undefined;
      const isTrajectory = trajectoryFormatOf(fileName) !== undefined;
      const modelState = useTrajectoryModel(pluginCtx, sessionId, isTrajectory ? path : undefined);
      const model =
        modelState.kind === 'ready' && modelState.data !== undefined
          ? { bytes: modelState.data, fileName: modelState.fileName, format: modelState.format }
          : undefined;
      return h(MolecularSurface, {
        bytes,
        fileName,
        format,
        sessionId,
        t,
        themeStore,
        inputActions,
        pluginCtx,
        model,
        modelPending: modelState.kind === 'loading',
        errorText: modelState.kind === 'failed' ? modelState.message : undefined,
      });
    }

    /**
     * The plugin's compact molecule glyph for sidebar registrations.
     * @param props - `size` in pixels.
     * @returns the icon.
     */
    function MolstarGlyph(props) {
      const size = props !== null && props !== undefined && Number.isFinite(props.size) ? props.size : 18;
      return h(
        'svg',
        {
          viewBox: '0 0 64 64',
          width: size,
          height: size,
          'aria-hidden': true,
          focusable: 'false',
          style: { display: 'block' },
        },
        h('rect', { x: 2, y: 2, width: 60, height: 60, rx: 14, fill: '#10243a' }),
        h('path', {
          d: 'M20 44 32 22 45 41',
          fill: 'none',
          stroke: '#4f9fe0',
          strokeWidth: 4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: 32, cy: 22, r: 7, fill: '#e8f2fb' }),
        h('circle', { cx: 20, cy: 44, r: 6, fill: '#7cc4f2' }),
        h('circle', { cx: 45, cy: 41, r: 5.5, fill: '#5aa6dc' }),
      );
    }

    /** @returns the Session's workspace file reader, when the page provides one. */
    function workspaceFilesOf(ctx) {
      // The reader is a Remote endpoint: reading it is only allowed for a
      // context that declared `remote.workspaceFiles` in its inject list, so
      // callers pass this plugin's own context, never a foreign one.
      try {
        return ctx !== undefined && ctx !== null ? ctx.remote.workspaceFiles : undefined;
      } catch {
        return undefined;
      }
    }

    /** @returns `base` and `child` joined with a forward slash. */
    function joinPath(base, child) {
      if (typeof base !== 'string' || base === '') return child;
      return `${base.replace(/[\\/]+$/, '')}/${child}`;
    }

    /**
     * A sidebar tab can be seeded with a file path or a `dsh-resource://file/…`
     * address; the reader wants a filesystem path.
     * @param seed - the tab's path seed.
     * @returns the plain path.
     */
    function pathFromSeed(seed) {
      if (typeof seed !== 'string') return '';
      return seed.startsWith(FILE_PREFIX) ? filePathOf(seed) : seed;
    }

    /**
     * Read one file's complete bytes through the Session's file reader.
     * @param ctx - the Client context carrying `remote`.
     * @param sessionId - the Session whose workspace resolves the path.
     * @param path - absolute or workspace-relative path; undefined stays idle.
     * @returns the read state: `{ kind: 'idle' | 'loading' | 'ready' | 'failed', data?, message? }`.
     */
    function useFileBytes(ctx, sessionId, path) {
      const [state, setState] = React.useState({ kind: 'idle' });
      React.useEffect(() => {
        if (typeof path !== 'string' || path === '' || typeof sessionId !== 'string') {
          setState({ kind: 'idle' });
          return undefined;
        }
        const files = workspaceFilesOf(ctx);
        if (files === undefined) {
          setState({ kind: 'failed', message: 'The workspace file reader is unavailable.' });
          return undefined;
        }
        const controller = new AbortController();
        setState({ kind: 'loading' });
        (async () => {
          const result = await files.readBytes(sessionId, path, {}, controller.signal);
          if (controller.signal.aborted) return;
          // Remote calls return a RemoteResult: { ok: true, value } | { ok: false, error }.
          if (result !== null && result !== undefined && result.ok === false) {
            throw new Error(
              result.error !== undefined && result.error !== null && typeof result.error.message === 'string'
                ? result.error.message
                : 'The file could not be read.',
            );
          }
          const value = result !== null && result !== undefined && result.ok === true ? result.value : result;
          setState({
            kind: 'ready',
            data: value !== null && value !== undefined ? value.data : undefined,
          });
        })().catch((error) => {
          if (controller.signal.aborted) return;
          setState({
            kind: 'failed',
            message: error instanceof Error ? error.message : String(error),
          });
        });
        return () => controller.abort();
      }, [ctx, sessionId, path]);
      return state;
    }

    /**
     * List the structure files directly inside one workspace folder.
     * @param ctx - the Client context carrying `remote`.
     * @param sessionId - the Session whose workspace is listed.
     * @param cwd - that Session's working directory, when known.
     * @returns the listing state: `{ kind, files: string[], message? }`.
     */
    function useStructureFiles(ctx, sessionId, cwd) {
      const [state, setState] = React.useState({ kind: 'idle', files: [] });
      React.useEffect(() => {
        if (typeof sessionId !== 'string') return undefined;
        const files = workspaceFilesOf(ctx);
        if (files === undefined) {
          setState({ kind: 'failed', files: [], message: 'The workspace file reader is unavailable.' });
          return undefined;
        }
        const controller = new AbortController();
        setState({ kind: 'loading', files: [] });
        (async () => {
          const result = await files.list(
            sessionId,
            typeof cwd === 'string' && cwd !== '' ? cwd : '.',
            controller.signal,
          );
          if (controller.signal.aborted) return;
          if (result !== null && result !== undefined && result.ok === false) {
            throw new Error(
              result.error !== undefined && result.error !== null && typeof result.error.message === 'string'
                ? result.error.message
                : 'The folder could not be listed.',
            );
          }
          const value = result !== null && result !== undefined && result.ok === true ? result.value : result;
          const entries = value !== null && value !== undefined && Array.isArray(value.entries) ? value.entries : [];
          const structures = entries
            .filter((entry) => entry !== null && entry !== undefined && entry.type === 'file' && formatOf(entry.name) !== undefined)
            .map((entry) => entry.name)
            .sort((left, right) => left.localeCompare(right));
          setState({ kind: 'ready', files: structures });
        })().catch((error) => {
          if (controller.signal.aborted) return;
          setState({
            kind: 'failed',
            files: [],
            message: error instanceof Error ? error.message : String(error),
          });
        });
        return () => controller.abort();
      }, [ctx, sessionId, cwd]);
      return state;
    }

    /**
     * Find and read the structure model that belongs to one trajectory file:
     * exact GROMACS-style names first (confout.gro, …), then any structure
     * file in the same directory.
     * @param reader - the context with `remote.workspaceFiles` injected.
     * @param sessionId - the Session whose workspace is searched.
     * @param trajectoryPath - the opened trajectory's path, or undefined.
     * @returns the model state: `{ kind, data?, fileName?, format?, message? }`.
     */
    function useTrajectoryModel(reader, sessionId, trajectoryPath) {      const [state, setState] = React.useState({ kind: 'idle' });
      React.useEffect(() => {
        if (typeof trajectoryPath !== 'string' || trajectoryPath === '' || typeof sessionId !== 'string') {
          setState({ kind: 'idle' });
          return undefined;
        }
        const files = workspaceFilesOf(reader);
        if (files === undefined) {
          setState({ kind: 'failed', message: 'The workspace file reader is unavailable.' });
          return undefined;
        }
        const controller = new AbortController();
        setState({ kind: 'loading' });
        (async () => {
          const directory = directoryOf(trajectoryPath);
          const listed = unwrapRemote(
            await files.list(sessionId, directory === '' ? '.' : directory, controller.signal),
            'The folder could not be listed.',
          );
          if (controller.signal.aborted) return;
          const entries =
            listed !== null && listed !== undefined && Array.isArray(listed.entries) ? listed.entries : [];
          const filesOnly = entries.filter((entry) => entry !== null && entry !== undefined && entry.type === 'file');
          const byLowerName = new Map(
            filesOnly.map((entry) => [String(entry.name).toLowerCase(), String(entry.name)]),
          );
          let modelName;
          for (const candidate of TRAJECTORY_MODEL_NAMES) {
            if (byLowerName.has(candidate)) {
              modelName = byLowerName.get(candidate);
              break;
            }
          }
          if (modelName === undefined) {
            const self = String(trajectoryPath).replace(/\\/g, '/').split('/').pop().toLowerCase();
            const score = (name) => {
              const lower = String(name).toLowerCase();
              let value = 0;
              if (STRUCTURE_FORMATS[suffixOf(lower)] !== undefined) value += 10;
              if (/(conf|start|initial|topol|model|structure)/u.test(lower)) value += 5;
              if (suffixOf(lower) === 'gro') value += 3;
              return value;
            };
            modelName = filesOnly
              .map((entry) => String(entry.name))
              .filter((name) => name.toLowerCase() !== self && score(name) > 0)
              .sort((left, right) => score(right) - score(left) || left.localeCompare(right))[0];
          }
          if (modelName === undefined) {
            throw new Error('No structure file (gro/pdb/cif) found next to the trajectory.');
          }
          const modelPath = directory === '' ? modelName : joinPath(directory, modelName);
          const read = unwrapRemote(
            await files.readBytes(sessionId, modelPath, {}, controller.signal),
            'The model file could not be read.',
          );
          if (controller.signal.aborted) return;
          const lower = modelName.toLowerCase();
          setState({
            kind: 'ready',
            data: read !== null && read !== undefined ? read.data : undefined,
            fileName: modelName,
            format: STRUCTURE_FORMATS[suffixOf(lower)],
          });
        })().catch((error) => {
          if (controller.signal.aborted) return;
          setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
        });
        return () => controller.abort();
      }, [reader, sessionId, trajectoryPath]);
      return state;
    }

    /** Read one byte range of a workspace file. */
    async function readFileRange(files, sessionId, path, offset, length, signal) {
      const read = unwrapRemote(
        await files.readBytes(sessionId, path, { range: { offset, length } }, signal),
        'The trajectory could not be read.',
      );
      if (read === null || read === undefined || !(read.data instanceof Uint8Array)) {
        throw new Error('The trajectory could not be read.');
      }
      return read.data;
    }

    /** @returns the size in bytes of one workspace file. */
    async function statFileSize(files, sessionId, path, signal) {
      const stat = unwrapRemote(await files.stat(sessionId, path, signal), 'The file could not be statted.');
      return stat !== null && stat !== undefined && typeof stat.bytes === 'number' ? stat.bytes : 0;
    }

    /**
     * Walk one XTC frame at `off` inside `dv`; big-endian, matching Mol*'s reader.
     * @returns the frame's byte size, or undefined when the buffer ends first.
     */
    function xtcFrameSizeAt(dv, off) {
      if (off + 52 > dv.byteLength) return undefined;
      const natoms = dv.getInt32(off + 4);
      if (natoms <= 0) return undefined;
      if (natoms <= 9) {
        if (off + 52 + 4 + natoms * 12 > dv.byteLength) return undefined;
        return 52 + 4 + natoms * 12;
      }
      const head = off + 52;
      if (head + 40 > dv.byteLength) return undefined;
      const packed = Math.ceil(dv.getInt32(head + 36) / 4) * 4;
      if (head + 40 + packed > dv.byteLength) return undefined;
      return 52 + 40 + packed;
    }

    /**
     * Build a frame index for one trajectory, cheaply:
     * TRR frames are fixed-size (header of the first frame); XTC frames are
     * variable, so the file is scanned once by skipping compressed blocks.
     * @returns `{ kind: 'fixed', frameSize, count } | { kind: 'xtc', offsets, count }`.
     */
    async function buildTrajectoryIndex(files, sessionId, path, format, size, signal) {
      if (format === 'trr') {
        const head = await readFileRange(files, sessionId, path, 0, Math.min(size, 8192), signal);
        const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
        let off = 8; // magic + i1
        const versionSize = dv.getInt32(off);
        off += 4 + versionSize;
        const boxSize = dv.getInt32(off + 8);
        const virSize = dv.getInt32(off + 12);
        const presSize = dv.getInt32(off + 16);
        const coordSize = dv.getInt32(off + 28);
        const velSize = dv.getInt32(off + 32);
        const forceSize = dv.getInt32(off + 36);
        const natoms = dv.getInt32(off + 40);
        if (natoms <= 0) throw new Error('Bad TRR header.');
        const floatSize = coordSize > 0 ? coordSize / (3 * natoms) : boxSize > 0 ? boxSize / 9 : 4;
        off += 52 + 2 * floatSize;
        const frameSize =
          off + boxSize + virSize + presSize + coordSize + velSize + forceSize;
        if (frameSize <= 0 || frameSize > size) throw new Error('Bad TRR frame size.');
        return { kind: 'fixed', frameSize, count: Math.floor(size / frameSize) };
      }
      if (format === 'xtc') {
        const offsets = [];
        const CHUNK = 4 * 1024 * 1024;
        let base = 0;
        let buf = new Uint8Array(0);
        while (base + buf.byteLength < size) {
          const want = Math.min(CHUNK, size - base - buf.byteLength);
          const part = await readFileRange(files, sessionId, path, base + buf.byteLength, want, signal);
          const merged = new Uint8Array(buf.byteLength + part.byteLength);
          merged.set(buf, 0);
          merged.set(part, buf.byteLength);
          buf = merged;
          const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
          let pos = 0;
          for (;;) {
            const frame = xtcFrameSizeAt(dv, pos);
            if (frame === undefined) break;
            offsets.push(base + pos);
            pos += frame;
          }
          base += pos;
          buf = buf.slice(pos);
          if (signal.aborted) throw new Error('cancelled');
        }
        if (offsets.length === 0) throw new Error('No frames found in the XTC file.');
        return { kind: 'xtc', offsets, count: offsets.length };
      }
      throw new Error(`Windowed reading is not supported for the ${format} format.`);
    }

    /** Expand a `{ start, step, count }` window into global frame indices. */
    function windowIndices(window) {
      const indices = [];
      for (let i = 0; i < window.count; i++) indices.push(window.start + i * window.step);
      return indices;
    }

    /**
     * Read a set of whole frames and concatenate them into one trajectory
     * fragment Mol* can parse (XTC/TRR frames are self-contained).
     */
    async function readTrajectoryFrames(files, sessionId, path, format, index, size, indices, signal) {
      const spans = [];
      if (index.kind === 'fixed') {
        let runStart = -1;
        let runEnd = -1;
        for (const i of indices) {
          if (runStart < 0) {
            runStart = i;
            runEnd = i;
          } else if (i === runEnd + 1) {
            runEnd = i;
          } else {
            spans.push([runStart, runEnd]);
            runStart = i;
            runEnd = i;
          }
        }
        if (runStart >= 0) spans.push([runStart, runEnd]);
      } else {
        for (const i of indices) spans.push([i, i]);
      }
      const parts = [];
      const queue = spans.slice();
      const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
        for (;;) {
          const span = queue.shift();
          if (span === undefined) return;
          const [first, last] = span;
          let offset;
          let length;
          if (index.kind === 'fixed') {
            offset = first * index.frameSize;
            length = (last - first + 1) * index.frameSize;
          } else {
            offset = index.offsets[first];
            const end = last + 1 < index.count ? index.offsets[last + 1] : size;
            length = end - offset;
          }
          parts.push({ order: first, data: await readFileRange(files, sessionId, path, offset, length, signal) });
        }
      });
      await Promise.all(workers);
      parts.sort((a, b) => a.order - b.order);
      const total = parts.reduce((sum, part) => sum + part.data.byteLength, 0);
      const blob = new Uint8Array(total);
      let at = 0;
      for (const part of parts) {
        blob.set(part.data, at);
        at += part.data.byteLength;
      }
      return blob;
    }

    /**
     * Lazy trajectory source: builds the frame index, loads a strided first
     * window, and exposes `readWindow` for seek-driven refills.
     * @returns `{ state, readWindow }` — state `{ phase, total?, window?, blob?, message? }`.
     */
    function useWindowedTrajectory(reader, sessionId, path, trajFormat) {
      const [state, setState] = React.useState({ phase: 'idle' });
      const ctxRef = React.useRef(undefined);
      React.useEffect(() => {
        if (trajFormat === undefined || typeof path !== 'string' || path === '' || typeof sessionId !== 'string') {
          ctxRef.current = undefined;
          setState({ phase: 'idle' });
          return undefined;
        }
        const files = workspaceFilesOf(reader);
        if (files === undefined) {
          ctxRef.current = undefined;
          setState({ phase: 'error', message: 'The workspace file reader is unavailable.' });
          return undefined;
        }
        const controller = new AbortController();
        setState({ phase: 'indexing' });
        (async () => {
          const size = await statFileSize(files, sessionId, path, controller.signal);
          const index = await buildTrajectoryIndex(files, sessionId, path, trajFormat, size, controller.signal);
          const target = Math.min(64, index.count);
          const step = Math.max(1, Math.floor((index.count - 1) / Math.max(1, target - 1)));
          const count = Math.min(target, Math.floor((index.count - 1) / step) + 1);
          const window = { start: 0, step, count };
          const blob = await readTrajectoryFrames(
            files, sessionId, path, trajFormat, index, size, windowIndices(window), controller.signal,
          );
          ctxRef.current = { files, index, size };
          setState({ phase: 'ready', total: index.count, window, blob });
        })().catch((error) => {
          if (controller.signal.aborted) return;
          ctxRef.current = undefined;
          setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
        });
        return () => controller.abort();
      }, [reader, sessionId, path, trajFormat]);
      const readWindow = React.useCallback(
        async (window) => {
          const ctx = ctxRef.current;
          if (ctx === undefined) throw new Error('The trajectory index is not ready.');
          return readTrajectoryFrames(
            ctx.files, sessionId, path, trajFormat, ctx.index, ctx.size, windowIndices(window), undefined,
          );
        },
        [sessionId, path, trajFormat],
      );
      return { state, readWindow };
    }

    /**
     * The sidebar tab page: a seeded structure file, or a picker that lists the
     * Session folder's structure files.
     * @param props - better-sidebar tab props plus this plugin's `t` and `themeStore`.
     * @returns the page.
     */
    function MolstarSidebarTab(props) {
      const { ctx, scope, tab, t, themeStore, pluginCtx } = props;
      const reader = pluginCtx !== undefined ? pluginCtx : ctx;
      const cwd = scope !== undefined && scope !== null ? scope.cwd : undefined;
      const seeded =
        tab !== undefined && tab !== null && typeof tab.path === 'string' ? pathFromSeed(tab.path) : '';
      const [path, setPath] = React.useState(seeded);
      const scopeSessionId = scope !== undefined && scope !== null ? scope.sessionId : undefined;
      const sessionId =
        scopeSessionId !== undefined
          ? scopeSessionId
          : tab !== undefined && tab !== null && typeof tab.path === 'string'
            ? sessionIdOfAddress(tab.path)
            : undefined;
      React.useEffect(() => {
        if (seeded !== '') setPath(seeded);
      }, [seeded]);
      const fileName = fileNameOf(String(path).replace(/\\/g, '/'));
      const format = formatOf(fileName);
      const trajFormat = trajectoryFormatOf(fileName);
      const windowed = useWindowedTrajectory(reader, sessionId, path, trajFormat);
      const windowFailed = trajFormat !== undefined && windowed.state.phase === 'error';
      const bytesState = useFileBytes(
        reader,
        sessionId,
        format === undefined || (trajFormat !== undefined && !windowFailed) ? undefined : path,
      );
      const listing = useStructureFiles(reader, sessionId, cwd);
      const bytes = bytesState.kind === 'ready' ? bytesState.data : undefined;
      const isTrajectory = trajFormat !== undefined;
      const modelState = useTrajectoryModel(reader, sessionId, isTrajectory ? path : undefined);
      const model =
        modelState.kind === 'ready' && modelState.data !== undefined
          ? { bytes: modelState.data, fileName: modelState.fileName, format: modelState.format }
          : undefined;
      const trajectory =
        trajFormat !== undefined && windowed.state.phase === 'ready'
          ? {
              totalFrames: windowed.state.total,
              window: windowed.state.window,
              blob: windowed.state.blob,
              readWindow: windowed.readWindow,
            }
          : undefined;

      return h(
        'div',
        { className: 'msp-tab', 'data-molstar-tab': true },
        h('style', null, PREVIEW_CSS + TAB_CSS),
        format !== undefined
          ? h(
              'div',
              { className: 'msp-tab-surface' },
              h(MolecularSurface, {
                bytes,
                fileName,
                format,
                sessionId,
                t,
                themeStore,
                model,
                trajectory,
                modelPending: modelState.kind === 'loading',
                pending:
                  bytesState.kind === 'loading' ||
                  windowed.state.phase === 'indexing' ||
                  (trajFormat !== undefined && windowed.state.phase === 'idle'),
                errorText:
                  bytesState.kind === 'failed'
                    ? bytesState.message
                    : modelState.kind === 'failed'
                      ? modelState.message
                      : undefined,
              }),
            )
          : h(
              'div',
              { className: 'msp-tab-picker' },
              h('p', { className: 'msp-tab-hint' }, t('tabHint')),
              listing.kind === 'loading'
                ? h('p', { className: 'msp-tab-hint' }, t('tabLoading'))
                : listing.files.length === 0
                  ? h(
                      'p',
                      { className: 'msp-tab-hint' },
                      listing.kind === 'failed' ? listing.message : t('tabNoStructures'),
                    )
                  : h(
                      'ul',
                      { className: 'msp-tab-list' },
                      listing.files.map((name) =>
                        h(
                          'li',
                          { key: name },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'msp-tab-file',
                              onClick: () => setPath(joinPath(cwd, name)),
                            },
                            name,
                          ),
                        ),
                      ),
                    ),
            ),
      );
    }

    /**
     * The sidebar file viewer: a structure file opened from the tree renders
     * straight into Mol*.
     * @param props - better-sidebar file viewer props plus `t` and `themeStore`.
     * @returns the viewer.
     */
    function MolstarSidebarFileViewer(props) {
      const { ctx, scope, path, t, themeStore, pluginCtx } = props;
      const reader = pluginCtx !== undefined ? pluginCtx : ctx;
      const filePath = pathFromSeed(path);
      const sessionId =
        scope !== undefined && scope !== null && scope.sessionId !== undefined
          ? scope.sessionId
          : sessionIdOfAddress(path);
      const fileName = fileNameOf(String(filePath).replace(/\\/g, '/'));
      const format = formatOf(fileName);
      const trajFormat = trajectoryFormatOf(fileName);
      const windowed = useWindowedTrajectory(reader, sessionId, filePath, trajFormat);
      const windowFailed = trajFormat !== undefined && windowed.state.phase === 'error';
      const bytesState = useFileBytes(
        reader,
        sessionId,
        trajFormat !== undefined && !windowFailed ? undefined : filePath,
      );
      const bytes = bytesState.kind === 'ready' ? bytesState.data : undefined;
      const isTrajectory = trajFormat !== undefined;
      const modelState = useTrajectoryModel(reader, sessionId, isTrajectory ? filePath : undefined);
      const model =
        modelState.kind === 'ready' && modelState.data !== undefined
          ? { bytes: modelState.data, fileName: modelState.fileName, format: modelState.format }
          : undefined;
      const trajectory =
        trajFormat !== undefined && windowed.state.phase === 'ready'
          ? {
              totalFrames: windowed.state.total,
              window: windowed.state.window,
              blob: windowed.state.blob,
              readWindow: windowed.readWindow,
            }
          : undefined;
      return h(
        'div',
        { className: 'msp-tab', 'data-molstar-tab': true },
        h('style', null, PREVIEW_CSS + TAB_CSS),
        h(
          'div',
          { className: 'msp-tab-surface' },
          h(MolecularSurface, {
            bytes,
            fileName,
            format,
            sessionId,
            t,
            themeStore,
            model,
            trajectory,
            modelPending: modelState.kind === 'loading',
            pending:
              bytesState.kind === 'loading' ||
              windowed.state.phase === 'indexing' ||
              (trajFormat !== undefined && windowed.state.phase === 'idle'),
            errorText:
              bytesState.kind === 'failed'
                ? bytesState.message
                : modelState.kind === 'failed'
                  ? modelState.message
                  : undefined,
          }),
        ),
      );
    }

    /** Browser services this bundle needs before it can contribute anything. */
    const inject = [
      'slots',
      'locale',
      'documentPreviews',
      'theme',
      'remote',
      'remote.workspaceFiles',
    ];

    /** Register the implementation metadata, its copy, and its body. */
    function apply(ctx) {
      pluginCtxRef = ctx;
      const t = ctx.locale.bind(LOCALE_NS);
      ctx.effect(() => ctx.locale.register(LOCALE_NS, 'en', EN), 'molstar-preview: en copy');
      ctx.effect(() => ctx.locale.register(LOCALE_NS, 'zh', ZH), 'molstar-preview: zh copy');

      const themeStore = createThemeStore(ctx);

      ctx.effect(
        () =>
          ctx.documentPreviews.register({
            id: IMPL_ID,
            extensions: Object.keys(EXTENSION_FORMATS),
            binaryExtensions: Object.keys(TRAJECTORY_FORMATS),
            priority: 'extension',
            title: () => t('title'),
            loading: 'bytes-complete',
            wrap: false,
          }),
        'molstar-preview: document preview metadata',
      );

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.tab.document', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.tab.document',
                key: IMPL_ID,
                locale: LOCALE_NS,
                inject: () => ({ themeStore, pluginCtx: ctx }),
              },
              MolstarPreview,
            ),
          ),
        'molstar-preview: document preview body',
      );

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.tab.document.actions', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.tab.document.actions',
                id: 'molstar-preview/panel-layout',
                order: 20,
                locale: LOCALE_NS,
              },
              LayoutToggle,
            ),
          ),
        'molstar-preview: panel layout toggle',
      );

      // Optional integration with the Better Sidebar plugin: one tab page and
      // one file viewer, both reusing the same canvas. Absent service = the
      // stock document preview above is the only surface.
      ctx.inject(['betterSidebar'], (scoped) => {
        scoped.effect(
          () =>
            scoped.betterSidebar.registerTab({
              id: 'dsh-molstar-preview:molstar',
              title: () => t('title'),
              description: () => t('tabDescription'),
              icon: (size) => h(MolstarGlyph, { size }),
              order: 40,
              component: (props) => h(MolstarSidebarTab, { ...props, t, themeStore, pluginCtx: ctx }),
            }),
          'molstar-preview: better-sidebar tab',
        );
        scoped.effect(
          () =>
            scoped.betterSidebar.registerFileViewer({
              id: 'dsh-molstar-preview:molstar-viewer',
              title: () => t('title'),
              icon: (size) => h(MolstarGlyph, { size }),
              exts: Object.keys(EXTENSION_FORMATS),
              priority: 50,
              fetchStrategy: 'none',
              component: (props) => h(MolstarSidebarFileViewer, { ...props, t, themeStore, pluginCtx: ctx }),
            }),
          'molstar-preview: better-sidebar file viewer',
        );
      });
    }

    return { inject, apply };
  },
});
