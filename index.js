/**
 * Host half of the Mol* structure preview bundle.
 *
 * The preview itself is browser-side. This half contributes the model-facing
 * `molstar` tool and the loopback route the panel long-polls: a tool call is
 * queued for the calling Session, the open panel answers it, and the reply
 * becomes the tool result. Nothing is persisted; the viewer stays the source of
 * truth for what is on screen.
 */
export const inject = ['tools'];

/** Path the browser panel polls; served by the Host web server when present. */
const BRIDGE_PATH = '/molstar-bridge';
/** Longest a long-poll holds a request open. */
const MAX_WAIT_MS = 25000;
/** Largest bridge request body accepted. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Register the bridge route (when a web server exists) and the `molstar` tool.
 * @param ctx - the Host plugin context.
 */
export function apply(ctx) {
  /** @type {Map<string, Bridge>} per-Session command queues and replies. */
  const sessions = new Map();

  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'exact',
          path: BRIDGE_PATH,
          handler: (req, res) => handleBridge(req, res, sessions),
        }),
      'molstar-preview: panel bridge route',
    );
  });

  ctx.effect(() => ctx.tools.register(molstarTool(sessions)), 'molstar-preview: molstar tool');
}

/**
 * @typedef {object} Bridge
 * @property {unknown[]} queue pending commands waiting for a poll.
 * @property {Set<(command: unknown) => void>} waiters parked long-poll responses.
 * @property {Map<string, { resolve: (value: unknown) => void, reject: (error: Error) => void, timer: NodeJS.Timeout }>} pending
 *   tool calls waiting for the panel's reply.
 * @property {number} lastPoll timestamp of the last poll from this page.
 */

/**
 * Read or create one Session's bridge state.
 * @param {Map<string, Bridge>} sessions - all bridge states.
 * @param {string} sessionId - the Session owning the panel.
 * @returns the bridge state.
 */
function bridgeFor(sessions, sessionId) {
  let bridge = sessions.get(sessionId);
  if (bridge === undefined) {
    bridge = { queue: [], waiters: new Set(), pending: new Map(), lastPoll: 0 };
    sessions.set(sessionId, bridge);
  }
  return bridge;
}

/**
 * Serve one long-poll (GET) or panel update/reply (POST).
 * @param {import('node:http').IncomingMessage} req - the request.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {Map<string, Bridge>} sessions - all bridge states.
 */
async function handleBridge(req, res, sessions) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const querySession = url.searchParams.get('session') ?? '';

    // The panel may reach this route through the browser network, where the
    // desktop shell's file:// page has the opaque `null` origin. Echo it (and
    // the app's own origin) so the page can read the long-poll response.
    const origin = req.headers.origin;
    const host = req.headers.host;
    const trustedOrigin =
      origin === undefined ||
      origin === 'null' ||
      origin.startsWith('file:') ||
      (host !== undefined && (origin === `http://${host}` || origin === `https://${host}`));
    if (origin !== undefined && trustedOrigin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
    }

    if (req.method === 'GET') {
      if (querySession === '') {
        writeJson(res, 400, { error: 'missing session' });
        return;
      }
      if (querySession === '__diag') {
        writeJson(res, 200, {
          sessions: [...sessions.entries()].map(([id, state]) => ({
            id,
            lastPoll: state.lastPoll,
            waiters: state.waiters.size,
            pending: state.pending.size,
            queued: state.queue.length,
          })),
        });
        return;
      }
      const bridge = bridgeFor(sessions, querySession);
      bridge.lastPoll = Date.now();
      const queued = bridge.queue.shift();
      if (queued !== undefined) {
        writeJson(res, 200, { command: queued });
        return;
      }
      const waitMs = clampNumber(Number(url.searchParams.get('wait') ?? 20000), 0, MAX_WAIT_MS);
      if (waitMs === 0) {
        writeJson(res, 200, { command: null });
        return;
      }
      await parkPoll(bridge, waitMs, res);
      return;
    }

    if (req.method === 'OPTIONS') {
      if (!trustedOrigin) {
        writeJson(res, 403, { error: 'cross-origin bridge request refused' });
        return;
      }
      res.writeHead(204, {
        'access-control-allow-origin': origin ?? '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      });
      res.end();
      return;
    }

    if (req.method === 'POST') {
      // Same-origin only. A JSON content type already forces a preflight for
      // any cross-origin web caller, and that preflight is answered only for a
      // trusted origin above.
      if (!trustedOrigin) {
        writeJson(res, 403, { error: 'cross-origin bridge request refused' });
        return;
      }
      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.toLowerCase().startsWith('application/json')) {
        writeJson(res, 415, { error: 'bridge requires application/json' });
        return;
      }
      const body = await readJson(req);
      const bodySession =
        body !== null && typeof body === 'object' && typeof body.session === 'string' ? body.session : '';
      const sessionId = bodySession !== '' ? bodySession : querySession;
      if (sessionId === '') {
        writeJson(res, 400, { error: 'missing session' });
        return;
      }
      const bridge = bridgeFor(sessions, sessionId);
      bridge.lastPoll = Date.now();
      if (body !== null && typeof body.reply === 'object' && body.reply !== null) {
        settleReply(bridge, body.reply);
      }
      writeJson(res, 200, { ok: true });
      return;
    }

    writeJson(res, 405, { error: 'method not allowed' });
  } catch (error) {
    writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Hold one poll open until a command arrives or the wait expires.
 * @param {Bridge} bridge - the Session's bridge state.
 * @param {number} waitMs - how long to hold the response.
 * @param {import('node:http').ServerResponse} res - the response to answer.
 * @returns a promise resolved once the response was written.
 */
function parkPoll(bridge, waitMs, res) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (command) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      bridge.waiters.delete(finish);
      if (!res.writableEnded) writeJson(res, 200, { command: command ?? null });
      resolve();
    };
    const timer = setTimeout(() => finish(null), waitMs);
    bridge.waiters.add(finish);
    res.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      bridge.waiters.delete(finish);
      resolve();
    });
  });
}

/**
 * Deliver the panel's reply to the waiting tool call.
 * @param {Bridge} bridge - the Session's bridge state.
 * @param {{ id?: unknown, ok?: unknown, result?: unknown, error?: unknown }} reply - decoded reply.
 */
function settleReply(bridge, reply) {
  const id = String(reply.id ?? '');
  const pending = bridge.pending.get(id);
  if (pending === undefined) return;
  bridge.pending.delete(id);
  clearTimeout(pending.timer);
  if (reply.ok === true) pending.resolve(reply.result);
  else pending.reject(new Error(String(reply.error ?? 'the Mol* panel reported an error')));
}

/**
 * Choose the Session whose open panel should answer: the caller's own when it
 * is live, otherwise the most recently polled one (the panel the user is
 * actually looking at, which can belong to another Session in the sidebar).
 * @param {Map<string, Bridge>} sessions - all bridge states.
 * @param {string} sessionId - the calling Session.
 * @returns the target Session id, or undefined when no page is polling.
 */
function pickTargetSession(sessions, sessionId) {
  const now = Date.now();
  const own = sessions.get(sessionId);
  if (own !== undefined && now - own.lastPoll < 15000) return sessionId;
  let best;
  for (const [id, state] of sessions) {
    if (id.startsWith('__')) continue;
    if (now - state.lastPoll >= 30000) continue;
    if (best === undefined || state.lastPoll > best.lastPoll) best = { id, lastPoll: state.lastPoll };
  }
  return best === undefined ? undefined : best.id;
}

/**
 * Decode a panel bind token produced by the preview's "Send this panel to the
 * chat" button (base64url JSON `{ v, s: sessionId, w: viewId, f: fileName }`).
 * @param {string} token - the token string.
 * @returns the decoded target, or undefined when malformed.
 */
function decodePanelToken(token) {
  try {
    const b64 = String(token).replace(/-/g, '+').replace(/_/g, '/');
    const data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    if (data !== null && typeof data === 'object' && typeof data.s === 'string' && data.s !== '') {
      return {
        sessionId: data.s,
        viewId: typeof data.w === 'string' && data.w !== '' ? data.w : undefined,
        fileName: typeof data.f === 'string' ? data.f : undefined,
      };
    }
  } catch {
    // Malformed tokens are rejected by the caller.
  }
  return undefined;
}

/**
 * Queue one command for the panel and wait for its reply.
 * @param {Map<string, Bridge>} sessions - all bridge states.
 * @param {string} sessionId - the calling Session.
 * @param {Record<string, unknown>} command - operation payload.
 * @param {number} timeoutMs - how long to wait.
 * @param {{ sessionId: string, viewId?: string, fileName?: string }} [explicit] - a bound panel target.
 * @returns {{ result: unknown, sessionId: string }} the panel's result and the Session that answered.
 */
function sendCommand(sessions, sessionId, command, timeoutMs, explicit) {
  const target =
    explicit !== undefined ? explicit.sessionId : pickTargetSession(sessions, sessionId);
  if (target === undefined) {
    return Promise.reject(
      new Error(
        'No Mol* preview is open. Open a .pdb/.cif file (the right-Sidebar document preview, or the Mol* tab in Better Sidebar), then call this tool again.',
      ),
    );
  }
  const bridge = bridgeFor(sessions, target);
  if (explicit !== undefined && Date.now() - bridge.lastPoll >= 30000) {
    return Promise.reject(
      new Error(
        `The bound panel (${explicit.fileName ?? target}) is offline — its page or preview was closed. Reopen the preview and bind it again with the "Send this panel to the chat" button.`,
      ),
    );
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const budget = timeoutMs;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bridge.pending.delete(id);
      reject(
        new Error(
          `The Mol* panel did not answer within ${Math.round(budget / 1000)}s. Make sure a structure file is open in the sidebar and the page is visible, then retry.`,
        ),
      );
    }, budget);
    bridge.pending.set(id, {
      resolve: (value) => resolve({ result: value, sessionId: target }),
      reject,
      timer,
    });

    const full = { ...command, id };
    if (explicit !== undefined && explicit.viewId !== undefined) full.viewId = explicit.viewId;
    let parked;
    for (const waiter of bridge.waiters) {
      parked = waiter;
      bridge.waiters.delete(waiter);
      break;
    }
    if (parked !== undefined) parked(full);
    else bridge.queue.push(full);
  });
}

/**
 * Build the model-facing tool definition.
 * @param {Map<string, Bridge>} sessions - all bridge states.
 * @returns a tool definition for the registry.
 */
function molstarTool(sessions) {
  return {
    name: 'molstar',
    description:
      'Operate the Mol* 3D structure panel in the right Sidebar and read what the user has selected there. '
      + 'Use action=status to check whether a structure preview is open, action=selection to read the user\'s current '
      + 'selection as residues (chain, residue number, component) plus an equivalent PyMOL query, '
      + 'action=components to list every structure component in the panel with its representations '
      + '(type, color theme, uniform color) and visibility, action=apply to '
      + 'select/highlight/focus arbitrary residues from a query, action=style to add a persistent styled component '
      + '(one query, one or more representations such as cartoon plus ball-and-stick, optional uniform color — e.g. '
      + 'highlight all HIS as cartoon+ball-and-stick in orange), action=clear-style to remove styled components, '
      + 'action=state to export or import the full Mol* view state (the MolJ JSON save format), action=load to '
      + 'append another structure file to the open panel (repeat for superposition of apo/holo or poses), '
      + 'action=clear to '
      + 'remove marks, action=reset to restore the camera, and action=layout to move the structure panel to the '
      + 'right side or under the viewport. '
      + 'Queries use PyMOL selection syntax by default ("chain A and resi 42-49", "resn HIS", "polymer and chain B"); '
      + 'pass language=mol-script for Mol* S-expressions such as "(sel.atom.all)". '
      + 'When the user pastes a "@molstar 绑定面板 <token>" line (from the preview\'s "Send this panel to the chat" '
      + 'button) into the conversation, pass that token as `panel` on EVERY subsequent call: the conversation then '
      + 'reads and modifies that exact pinned panel, independent of which panel the user is currently viewing. '
      + 'Without a token, the call targets this Session\'s own panel, else the most recently active one. '
      + 'The panel must be open on a structure file: ask the user to open it if a call reports that nothing is open.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'selection', 'components', 'apply', 'style', 'opacity', 'clear-style', 'state', 'load', 'clear', 'reset', 'layout'],
          description: 'status: describe the panel; selection: read the current selection; components: list the panel\'s structure components and each representation\'s type/color/opacity; apply: run a query; style: add a styled component; opacity: change one representation\'s opacity; clear-style: remove styled components; state: export/import the Mol* view state; load: append another structure file to the panel; clear: remove marks; reset: reset the camera; layout: move the structure panel to the right or the bottom.',
        },
        expression: {
          type: 'string',
          description: 'Selection query for action=apply and action=style.',
        },
        panel: {
          type: 'string',
          description: 'Panel bind token from the preview\'s "Send this panel to the chat" button; pass on every call once the user has bound a panel.',
        },
        file: {
          type: 'string',
          description: 'Workspace file path for action=load: append that structure to the open panel (repeatable for superposition).',
        },
        component: {
          type: 'integer',
          description: 'Component index for action=opacity, as listed by action=components.',
        },
        representation: {
          type: 'integer',
          description: 'Representation index within the component for action=opacity, as listed by action=components.',
        },
        alpha: {
          type: 'number',
          description: 'Opacity for action=opacity, 0 (transparent) to 1 (opaque).',
        },
        representations: {
          type: 'array',
          description: 'Representation list for action=style, e.g. [{type:"cartoon"},{type:"ball-and-stick",color:"#ff8800"}].',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', description: 'cartoon | ball-and-stick | surface | label | ...' },
              color: { type: 'string', description: 'Uniform color (#rrggbb, #rgb, or rgb(r,g,b)).' },
            },
            required: ['type'],
          },
        },
        color: {
          type: 'string',
          description: 'Default uniform color for action=style representations without their own color.',
        },
        label: {
          type: 'string',
          description: 'Display label of the styled component for action=style.',
        },
        key: {
          type: 'string',
          description: 'Component key for action=style (deduplicates repeated calls).',
        },
        clear: {
          type: 'boolean',
          description: 'For action=style: remove previously styled components first.',
        },
        snapshot: {
          type: 'object',
          description: 'For action=state: a Mol* state snapshot (MolJ JSON) to apply; omit to export the current one.',
        },
        layout: {
          type: 'string',
          enum: ['right', 'bottom'],
          description: 'Panel position for action=layout.',
        },
        language: {
          type: 'string',
          enum: ['pymol', 'mol-script'],
          description: 'Query language for action=apply and action=style (default pymol).',
        },
        mode: {
          type: 'string',
          enum: ['select', 'highlight', 'focus'],
          description: 'What action=apply (or action=clear) does to the structure (default select).',
        },
        timeoutMs: {
          type: 'integer',
          description: 'How long to wait for the panel (default 12000, max 60000).',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string', description: 'Human-readable panel state.' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const agent = exec.agent;
      if (agent === undefined) throw new Error('molstar requires an owning agent session');
      const sessionId = agent.session.id;
      const action = args.action;
      let command;
      if (action === 'apply') {
        if (typeof args.expression !== 'string' || args.expression.trim() === '') {
          throw new Error('action=apply needs `expression`, for example "chain A and resi 42-49"');
        }
        command = {
          op: 'apply',
          expression: args.expression,
          language: args.language === 'mol-script' ? 'mol-script' : 'pymol',
          action: args.mode ?? 'select',
        };
      } else if (action === 'clear') {
        command = { op: 'clear', action: args.mode ?? 'select' };
      } else if (action === 'style') {
        if (typeof args.expression !== 'string' || args.expression.trim() === '') {
          throw new Error('action=style needs `expression`, for example "resn HIS"');
        }
        command = {
          op: 'style',
          expression: args.expression,
          language: args.language === 'mol-script' ? 'mol-script' : 'pymol',
          representations: args.representations,
          color: args.color,
          label: args.label,
          key: args.key,
          clear: args.clear === true,
        };
      } else if (action === 'clear-style') {
        command = { op: 'clear-style' };
      } else if (action === 'load') {
        if (typeof args.file !== 'string' || args.file.trim() === '') {
          throw new Error('action=load needs `file`, a workspace path like "confout.gro" or an absolute path');
        }
        command = { op: 'load', path: args.file };
      } else if (action === 'components') {
        command = { op: 'components' };
      } else if (action === 'opacity') {
        command = {
          op: 'opacity',
          component: Number(args.component),
          representation: Number(args.representation),
          alpha: Number(args.alpha),
        };
      } else if (action === 'state') {
        command = { op: 'state', snapshot: args.snapshot };
      } else if (action === 'reset') {
        command = { op: 'reset' };
      } else if (action === 'layout') {
        command = { op: 'layout', layout: args.layout === 'bottom' ? 'bottom' : 'right' };
      } else {
        command = { op: 'snapshot' };
      }

      const timeoutMs = clampNumber(Number(args.timeoutMs ?? 12000), 1000, 60000);
      let bound;
      if (typeof args.panel === 'string' && args.panel.trim() !== '') {
        bound = decodePanelToken(args.panel.trim());
        if (bound === undefined) {
          throw new Error('`panel` token could not be parsed — generate it with the "Send this panel to the chat" button on the preview.');
        }
      }
      const answer = await withAbort(sendCommand(sessions, sessionId, command, timeoutMs, bound), exec.signal);
      return { text: formatResult(action, answer.result, answer.sessionId, sessionId) };
    },
  };
}

/**
 * Turn a panel result into the text the model reads.
 * @param {string} action - the requested action.
 * @param {any} result - panel-provided snapshot.
 * @param {string} [answeredBy] - the Session whose panel answered.
 * @param {string} [caller] - the calling Session.
 * @returns the formatted text.
 */
function formatResult(action, result, answeredBy, caller) {
  if (result === null || typeof result !== 'object') return 'The Mol* panel returned no data.';
  const lines = [];
  if (answeredBy !== undefined && caller !== undefined && answeredBy !== caller) {
    lines.push(`Note: this panel belongs to Session ${String(answeredBy).slice(0, 12)}…, not the calling one.`);
  }
  lines.push(`Mol* panel: ${result.file ?? '(unknown file)'} [${result.format ?? '?'}]`);
  lines.push(`Structures loaded: ${result.structures ?? 0} (units: ${result.units ?? 0})`);
  if (result.layout !== undefined) {
    lines.push(`Structure panel: ${result.layout === 'bottom' ? 'bottom' : 'right'}`);
  }

  const applied = result.applied;
  if (applied !== undefined) {
    lines.push(
      applied.action === 'style'
        ? `Styled component "${applied.label ?? 'component'}" from ${applied.expression}.`
        : `Applied ${applied.action} via ${applied.language}: ${applied.expression}`,
    );
  }
  if (action === 'reset') lines.push('Camera reset.');
  if (action === 'clear-style') lines.push('Styled components removed.');
  if (action === 'load' && typeof result.loadedFile === 'string') {
    lines.push(`Appended structure: ${result.loadedFile}`);
  }
  if (action === 'opacity' && result.opacitySet !== undefined) {
    lines.push(
      `Opacity set: component ${result.opacitySet.component}, representation ${result.opacitySet.representation} → alpha ${result.opacitySet.alpha}.`,
    );
  }
  if (action === 'components') {
    const components = Array.isArray(result.components) ? result.components : [];
    if (components.length === 0) {
      lines.push('Components: none.');
    } else {
      lines.push(`Components (${components.length}):`);
      for (const component of components) {
        const where =
          typeof component.structureLabel === 'string'
            ? `${component.structure}: ${component.structureLabel}`
            : `structure ${component.structure}`;
        const source =
          typeof component.selector === 'string'
            ? `selector=${component.selector}`
            : typeof component.expression === 'string'
              ? `query=${component.expression.length > 120 ? component.expression.slice(0, 120) + '…' : component.expression}`
              : 'source=?';
        const reps = Array.isArray(component.representations) ? component.representations : [];
        const repText =
          reps.length === 0
            ? 'no representations'
            : reps
                .map((rep) => {
                  const color = typeof rep.color === 'string' ? rep.color : '?';
                  const value = typeof rep.colorValue === 'string' ? ` ${rep.colorValue}` : '';
                  const opacity = typeof rep.opacity === 'number' && rep.opacity !== 1 ? `, opacity ${rep.opacity}` : '';
                  const hidden = rep.visible === false ? ' (hidden)' : '';
                  return `${rep.type ?? '?'} [${color}${value}${opacity}]${hidden}`;
                })
                .join(', ');
        const hidden = component.visible === false ? ' (hidden)' : '';
        lines.push(`  - "${component.label ?? component.selector ?? 'component'}" in ${where} — ${source}; ${repText}${hidden}`);
      }
    }
  }
  if (action === 'state') {
    if (result.state === null || result.state === undefined) {
      lines.push('State snapshot: unavailable.');
    } else {
      const json = JSON.stringify(result.state);
      lines.push(`State snapshot exported (${(json.length / 1024).toFixed(1)} KiB of MolJ JSON). Pass it back as \`snapshot\` to restore this view.`);
    }
  }

  const selection = result.selection ?? {};
  const residues = Array.isArray(selection.residues) ? selection.residues : [];
  if (residues.length === 0) {
    lines.push('Selection: empty — nothing is selected in the panel right now.');
    return lines.join('\n');
  }

  const byChain = new Map();
  for (const residue of residues) {
    const chain = residue.chain === undefined || residue.chain === '' ? '' : String(residue.chain);
    const list = byChain.get(chain) ?? [];
    list.push(residue);
    byChain.set(chain, list);
  }
  lines.push(`Selection: ${residues.length} residue(s), ${selection.atoms ?? 0} atom(s)`);
  for (const [chain, list] of byChain) {
    const text = list
      .slice(0, 200)
      .map((residue) => `${residue.seq}${residue.insertion ? `^${residue.insertion}` : ''}(${residue.comp})`)
      .join(', ');
    lines.push(`  chain ${chain || '(none)'}: ${text}${list.length > 200 ? `, … ${list.length - 200} more` : ''}`);
  }
  if (selection.pymol) lines.push(`Equivalent PyMOL selection: ${selection.pymol}`);
  return lines.join('\n');
}

/** Resolve an operation but fail as soon as the caller's turn is cancelled. */
function withAbort(promise, signal) {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(new Error('cancelled'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Write one JSON response and end it. */
function writeJson(res, status, body) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Read a JSON request body, bounded by {@link MAX_BODY_BYTES}. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('bridge request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error(`invalid bridge body: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    req.on('error', reject);
  });
}

/** Clamp a number into an inclusive range, tolerating NaN. */
function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
