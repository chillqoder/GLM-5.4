// Extracts the inline module from a built HTML file and syntax-checks it with node.
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.argv[2];
const html = readFileSync(file, 'utf8');
const m = html.match(/<script type="module">\n([\s\S]*?)\n<\/script>/);
if (!m) { console.error('no module script found'); process.exit(2); }
writeFileSync('/tmp/aqua-module-check.mjs', m[1]);
