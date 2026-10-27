// electron-builder packs `dependencies` and their transitive dependencies, but NOT peer
// dependencies. A package that requires a peer at load time therefore crashes the installed
// app on launch ("Cannot find module 'i18next'" after the @pulsetechnologies/i18n 0.9.0 bump).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const runtime = new Set(Object.keys(pkg.dependencies || {}));

function requiredPackages(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1];
    if (spec.startsWith('.') || spec.startsWith('node:') || builtinModules.includes(spec) || spec === 'electron') continue;
    names.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
  }
  return names;
}

test('every package the shipped main-process files require is a runtime dependency', () => {
  const missing = [];
  for (const file of pkg.build.files.filter((f) => f.endsWith('.js') && !f.includes('*'))) {
    for (const name of requiredPackages(file)) if (!runtime.has(name)) missing.push(`${file} -> ${name}`);
  }
  assert.deepEqual(missing, []);
});

test('every required peer dependency of a runtime dependency is itself a runtime dependency', () => {
  const missing = [];
  for (const dep of runtime) {
    const meta = require(path.join(root, 'node_modules', dep, 'package.json'));
    for (const peer of Object.keys(meta.peerDependencies || {})) {
      const optional = meta.peerDependenciesMeta && meta.peerDependenciesMeta[peer] && meta.peerDependenciesMeta[peer].optional;
      if (!optional && !runtime.has(peer)) missing.push(`${dep} needs peer ${peer}`);
    }
  }
  assert.deepEqual(missing, []);
});
