#!/usr/bin/env node
/**
 * Zips release-builds/POS-win32-x64 into release-builds/POS-win32-x64.zip
 * Works on Windows (PowerShell Compress-Archive) and macOS/Linux (zip CLI).
 * Usage: node scripts/zip-release.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'release-builds', 'POS-win32-x64');
const outZip = path.join(root, 'release-builds', 'POS-win32-x64.zip');

if (!fs.existsSync(buildDir)) {
  console.error(`Build directory not found: ${buildDir}`);
  console.error('Run "npm run package-win" first.');
  process.exit(1);
}

if (fs.existsSync(outZip)) {
  fs.unlinkSync(outZip);
}

console.log(`Zipping ${buildDir} → ${outZip} ...`);

if (process.platform === 'win32') {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${buildDir}' -DestinationPath '${outZip}'"`,
    { stdio: 'inherit' }
  );
} else {
  execSync(`zip -r "${outZip}" "${buildDir}"`, { stdio: 'inherit', cwd: root });
}

const sizeMB = (fs.statSync(outZip).size / 1024 / 1024).toFixed(1);
console.log(`Done: release-builds/POS-win32-x64.zip (${sizeMB} MB)`);
