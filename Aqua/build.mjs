#!/usr/bin/env node
// Builds the single-file deliverable `aquarium.html` from the chunks in src/.
//
//   node build.mjs          -> aquarium.html (final, self-contained except Three.js CDN imports)
//   node build.mjs --dev    -> also dev/aquarium-dev.html (with dev hooks) and dev/preview.html (model inspector)
//
// All chunks share one ES-module scope; they are concatenated in filename order.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, 'src');
const devDir = join(root, 'dev');

const THREE_VERSION = readFileSync(join(srcDir, 'THREE_VERSION'), 'utf8').trim();
const importMap = JSON.stringify({
  imports: {
    three: `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`,
    'three/addons/': `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/`,
  },
}, null, 2);

const template = readFileSync(join(srcDir, 'template.html'), 'utf8');
const css = readFileSync(join(srcDir, 'style.css'), 'utf8');

const read = (file) => `\n// ─────────────────────────── ${file.split('/').slice(-1)[0]} ───────────────────────────\n`
  + readFileSync(file, 'utf8');

const chunks = readdirSync(srcDir).filter((f) => /^\d+_.*\.js$/.test(f)).sort().map((f) => join(srcDir, f));
const mainChunk = chunks.find((f) => f.endsWith('130_main.js'));
const libChunks = chunks.filter((f) => f !== mainChunk);

function assemble(files, title, body) {
  const script = files.map(read).join('\n');
  if (script.includes('</script')) throw new Error('A chunk contains "</script" which would terminate the inline module.');
  return template
    .replace('/*{{CSS}}*/', () => css)
    .replaceAll('{{TITLE}}', title)
    .replace('{{IMPORTMAP}}', () => importMap)
    .replace('{{BODY}}', () => body)
    .replace('//{{SCRIPT}}', () => script);
}

const bodyMain = readFileSync(join(srcDir, 'body_main.html'), 'utf8').trim();
const bodyPreview = readFileSync(join(srcDir, 'body_preview.html'), 'utf8').trim();

// Final deliverable
mkdirSync(root, { recursive: true });
const out = join(root, 'aquarium.html');
writeFileSync(out, assemble([...libChunks, mainChunk], 'Living Glass Aquarium', bodyMain));

// Development builds
if (process.argv.includes('--dev')) {
  mkdirSync(devDir, { recursive: true });
  writeFileSync(join(devDir, 'aquarium-dev.html'), assemble([...libChunks, mainChunk, join(devDir, 'devtools.js')], 'Aquarium (dev)', bodyMain));
  writeFileSync(join(devDir, 'preview.html'), assemble([...libChunks, join(devDir, 'preview_main.js')], 'Model preview', bodyPreview));
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`built ${out} (${kb(Buffer.byteLength(readFileSync(out, 'utf8')))}, three@${THREE_VERSION}, ${libChunks.length + 1} chunks)`
  + (process.argv.includes('--dev') ? ` + dev builds (${libChunks.length + 1} chunks each)` : ''));
