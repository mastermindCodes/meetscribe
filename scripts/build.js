/**
 * MeetScribe Build Script
 * Copies source files and generates PNG icons from SVG.
 * Run: node scripts/build.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');
const DIST = path.resolve(__dirname, '..', 'dist');

// Files to copy (extension files only — no dev tools)
const INCLUDE = [
  'manifest.json',
  '_locales/en/messages.json',
  '_locales/ar/messages.json',
  'LICENSE',
  'README.md',
  'src/content/meet-captions.js',
  'src/content/zoom-captions.js',
  'src/content/teams-captions.js',
  'src/background/service-worker.js',
  'src/panel/panel.html',
  'src/panel/panel.css',
  'src/panel/panel.js',
  'src/lib/caption-store.js',
];

// Clean dist
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true });
}
fs.mkdirSync(DIST, { recursive: true });

// Copy files
for (const file of INCLUDE) {
  const srcPath = path.join(SRC, file);
  const dstPath = path.join(DIST, file);
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.copyFileSync(srcPath, dstPath);
  console.log(`  ✓ ${file}`);
}

// Generate placeholder PNG icons (1x1 transparent PNG as placeholder)
// Users should replace these with real icons
function generatePlaceholderPNG(size) {
  // Minimal valid 1-pixel PNG (transparent) - placeholder
  const png = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG header
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 pixel
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, // RGBA, 8-bit
    0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x78, 0x9C, 0x62, 0x00, 0x00, 0x00, 0x02, 
    0x00, 0x01, 0xE5, 0x27, 0xDE, 0xFC, 0x00, 0x00, 
    0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, // IEND chunk
    0x60, 0x82
  ]);
  return png;
}

// Write placeholder icons
for (const size of [16, 48, 128]) {
  const pngPath = path.join(DIST, 'public', `icon${size}.png`);
  fs.mkdirSync(path.dirname(pngPath), { recursive: true });
  fs.writeFileSync(pngPath, generatePlaceholderPNG(size));
  console.log(`  ✓ public/icon${size}.png (placeholder)`);
}

console.log(`\n✅ Built to dist/ — ${INCLUDE.length} files + icons`);
console.log('   Load unpacked in chrome://extensions/');
