// Structural check for the generated chunks.
//
//   node scripts/check-chunk.cjs client.molstar.js
//   node scripts/check-chunk.cjs client.molscript.js
//
// Mol*'s viewer module needs a real browser (DOM, WebGL feature detection), so
// that chunk is checked structurally. The parser chunk is evaluated and its
// exports are exercised, because it has no DOM dependencies.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = process.argv[2] || 'client.molstar.js';
const expectedChunk = path.basename(file);
const source = fs.readFileSync(file, 'utf8');
const registrations = [];
vm.runInNewContext(source, {
  window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
});

if (registrations.length !== 1) throw new Error(`expected one loader registration, got ${registrations.length}`);
const [registration] = registrations;
const failures = [];
const expect = (condition, label) => {
  if (!condition) failures.push(label);
};

expect(registration.id === 'dsh-molstar-preview', `registration id is ${registration.id}`);
expect(registration.chunk === expectedChunk, `chunk name is ${registration.chunk}, expected ${expectedChunk}`);
expect(typeof registration.factory === 'function', 'factory is not a function');

if (expectedChunk === 'client.molscript.js') {
  const api = registration.factory(() => undefined);
  expect(typeof api.toExpression === 'function', 'toExpression is not exported');
  expect(typeof api.toPymolExpression === 'function', 'toPymolExpression is not exported');
  expect(api.toPymolExpression('chain A and resi 42') && !!api.toPymolExpression('chain A and resi 42').head, 'pymol query does not compile to an apply expression');
  expect(api.toExpression('(sel.atom.all)') && !!api.toExpression('(sel.atom.all)').head, 'MolScript query does not compile to an apply expression');
  console.log('samples: pymol "chain A and resi 42" ok, mol-script "(sel.atom.all)" ok');
} else {
  const factorySource = registration.factory.toString();
  expect(/exports\.createMolecularViewer\s*=/.test(factorySource), 'createMolecularViewer is not exported');
  expect(/exports\.createMolecularTrajectory\s*=/.test(factorySource), 'createMolecularTrajectory is not exported');
  expect(/exports\.createMolecularTrajectoryWindowed\s*=/.test(factorySource), 'createMolecularTrajectoryWindowed is not exported');
  expect(/Viewer\.create\(/.test(factorySource), 'Viewer.create is not called');
  expect(/loadStructureFromData\(/.test(factorySource), 'loadStructureFromData is not called');
  expect(/loadTrajectory\(/.test(factorySource), 'loadTrajectory is not called');
  expect(/var molstar=\(\(\)=>/.test(factorySource), 'embedded Mol* IIFE is missing');
  expect(/return molstar;/.test(factorySource), 'Mol* IIFE result is not returned');
  expect(/CSS_LIGHT/.test(factorySource) && /CSS_DARK/.test(factorySource), 'both theme stylesheets are not embedded');
  expect(/data-molstar-skin/.test(factorySource), 'stylesheet swap is missing');
  expect(/snapshot\(\)/.test(factorySource), 'selection snapshot is missing');
  expect(/structureInteractivity/.test(factorySource), 'structureInteractivity is not used');
}

if (failures.length > 0) {
  console.error('chunk check failed:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log(`chunk ok: ${registration.id} ${registration.chunk} ${(source.length / 1024 / 1024).toFixed(2)} MiB`);
