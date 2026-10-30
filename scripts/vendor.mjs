import { copyFileSync, mkdirSync } from 'node:fs';

const files = [
  ['node_modules/@mozilla/readability/Readability.js', 'extension/vendor/Readability.js'],
  ['node_modules/webextension-polyfill/dist/browser-polyfill.js', 'extension/vendor/browser-polyfill.js'],
];

mkdirSync('extension/vendor', { recursive: true });
for (const [from, to] of files) {
  copyFileSync(from, to);
  console.log(`copied ${from} -> ${to}`);
}
