const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * Creates an isolated temp directory tree that mirrors the APPDATA structure
 * the app expects. Returns the root path to use as APPDATA.
 *
 * Must be called BEFORE requiring any api/* module, because NeDB opens
 * its datastore files at require time using process.env.APPDATA.
 */
function createTestEnv(prefix = 'pos') {
  const dir = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  fs.mkdirSync(path.join(dir, 'POS', 'server', 'databases'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'POS', 'uploads'), { recursive: true });
  return dir;
}

function removeTestEnv(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

module.exports = { createTestEnv, removeTestEnv };
