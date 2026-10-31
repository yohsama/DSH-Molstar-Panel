// Regenerate `client.molscript.js` — the lazy chunk that compiles standard
// MolScript text (for example `SELECT chain A and resno 42:57`) into a Mol*
// query expression, using Mol*'s own parser and transpiler.
//
// Build tooling is not shipped with the plugin at runtime; only the produced
// chunk is. To rebuild:
//
//   npm pack molstar@5.13.1 --pack-destination .build
//   tar -xzf .build/molstar-5.13.1.tgz -C .build
//   npm install esbuild                       (anywhere; pass its module path)
//   node scripts/build-molscript-chunk.mjs .build/package client.molscript.js <path-to-esbuild-module>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [molstarDir, outFile, esbuildModule] = process.argv.slice(2);
if (!molstarDir || !outFile) {
  console.error('usage: node scripts/build-molscript-chunk.mjs <unpacked molstar dir> <out file> [esbuild module path]');
  process.exit(2);
}

const esbuild = await import(
  esbuildModule
    ? new URL(`file:///${esbuildModule.replace(/\\/g, '/')}`).href
    : 'esbuild'
);

const pkg = JSON.parse(fs.readFileSync(path.join(molstarDir, 'package.json'), 'utf8'));
const license = fs.readFileSync(path.join(molstarDir, 'LICENSE'), 'utf8');

const toAbsPath = (file) => path.resolve(file).replace(/\\/g, '/');
const entrySource = `
import { parseMolScript } from ${JSON.stringify(toAbsPath(path.join(molstarDir, 'lib/mol-script/language/parser.js')))};
import { transpileMolScript } from ${JSON.stringify(toAbsPath(path.join(molstarDir, 'lib/mol-script/script/mol-script/symbols.js')))};
import { transpiler as pymolTranspiler } from ${JSON.stringify(toAbsPath(path.join(molstarDir, 'lib/mol-script/transpilers/pymol/parser.js')))};

/** Compile one MolScript S-expression query into a Mol* query expression. */
export function toExpression(text) {
  const parsed = parseMolScript(String(text));
  if (parsed.length === 0) throw new Error('empty MolScript expression');
  return transpileMolScript(parsed[0]);
}

/** Compile a PyMOL-style selection (e.g. \`chain A and resi 42\`). */
export function toPymolExpression(text) {
  return pymolTranspiler(String(text));
}

/** The parser alone, for callers that need the raw script nodes. */
export { parseMolScript };
`;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-molscript-'));
const entryFile = path.join(tempDir, 'entry.mjs');
fs.writeFileSync(entryFile, entrySource);

const built = await esbuild.build({
  entryPoints: [entryFile],
  bundle: true,
  format: 'iife',
  globalName: 'MolScriptParserBundle',
  minify: true,
  legalComments: 'none',
  write: false,
  logLevel: 'silent',
});
fs.rmSync(tempDir, { recursive: true, force: true });

const output = built.outputFiles[0].text;
const header = `//! MolScript parser and transpiler from Mol* ${pkg.version} — MIT licensed.\n`
  + license.split('\n').map((line) => `//${line}`).join('\n')
  + `\n//! Bundled by scripts/build-molscript-chunk.mjs. Do not edit by hand.\n`;

const chunk = `${header}(function () {
${output}
window.__ModuleLoader__.load({
  id: 'dsh-molstar-preview',
  chunk: 'client.molscript.js',
  factory: () => MolScriptParserBundle,
});
})();
`;

fs.writeFileSync(outFile, chunk);
console.log(`wrote ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KiB, molstar ${pkg.version})`);
