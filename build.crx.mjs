/**
 * Build script for Malim CRX.
 *
 * Copies:
 * 1. OpenRussian.mdx → dist/ (or malim-crx/ directly)
 * 2. Generates icon files from app-icon.png
 *
 * Usage: node build.js
 */

import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, '..');
const CRX = __dirname;
const TARGET = CRX;

function main() {
  console.log('🔨 Building Malim CRX...\n');

  // 1. Copy OpenRussian.mdx into CRX root
  const mdxSrc = join(ROOT, 'src-tauri', 'src', 'dict', 'assets', 'OpenRussian.mdx');
  const mdxDst = join(TARGET, 'OpenRussian.mdx');

  if (existsSync(mdxSrc)) {
    copyFileSync(mdxSrc, mdxDst);
    const size = statSync(mdxDst).size;
    console.log(`  ✅ Copied OpenRussian.mdx (${(size / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    console.warn('  ⚠️  OpenRussian.mdx not found at:', mdxSrc);
    console.warn('     Dictionary lookups will be unavailable until the file is placed at:');
    console.warn('     ', mdxDst);
  }

  // 2. Generate icons from app-icon.png
  const iconSrc = join(ROOT, 'app-icon.png');
  if (existsSync(iconSrc)) {
    console.log('  ✅ app-icon.png found — will use for icons');
    // Copy to icons directory
    mkdirSync(join(TARGET, 'icons'), { recursive: true });
    copyFileSync(iconSrc, join(TARGET, 'icons', 'icon128.png'));
    // For 16/48, we'd need sharp to resize. Placeholder for now.
    writeFileSync(join(TARGET, 'icons', 'icon16.png'), ''); // will be same PNG
    writeFileSync(join(TARGET, 'icons', 'icon48.png'), '');
    console.log('  ⚠️  16px/48px icons need manual resizing (use app-icon.png → icons/)');
  } else {
    console.warn('  ⚠️  app-icon.png not found');
  }

  console.log('\n✅ Build complete.');
  console.log('   Load unpacked extension at chrome://extensions');
}

main();
