/**
 * Shared Electron launch helper for Playwright E2E tests.
 *
 * Flow on a fresh APPDATA:
 *   1. App starts → no auth in electron-store → login form appears
 *   2. Seed admin user + server-side settings + electron-store platform via API/evaluate
 *   3. Login with admin/admin → app reloads
 *   4. After reload: settings present in DB → no modal → POS view ready
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { _electron: electron } = require('@playwright/test');

const APP_DIR = path.resolve(__dirname, '..', '..');
const ELECTRON_BIN = require('electron');

async function launchApp() {
  const testDir = path.join(
    os.tmpdir(),
    `pos-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  fs.mkdirSync(path.join(testDir, 'POS', 'server', 'databases'), { recursive: true });
  fs.mkdirSync(path.join(testDir, 'POS', 'uploads'), { recursive: true });

  let electronApp;
  try {
    electronApp = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: [path.join(APP_DIR, 'start.js')],
      cwd: APP_DIR,
      env: { ...process.env, APPDATA: testDir },
    });

    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Wait for embedded Express server to be ready
    await waitForServer();

    // Seed admin user, server-side settings, and electron-store platform
    // ALL before login — so the page reload after login finds everything ready.
    await page.evaluate(async () => {
      await fetch('http://localhost:8001/api/users/check');
      await fetch('http://localhost:8001/api/settings/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '', app: 'Standalone Point of Sale',
          store: 'Test Store', address_one: '1 Test St', address_two: 'Test City',
          contact: '555-0000', tax: '', symbol: '$', percentage: '0',
          charge_tax: '', footer: 'Thank you', img: '', remove: '',
        }),
      });
    });
    await page.waitForTimeout(400);

    // Set platform in electron-store via the renderer (nodeIntegration=true, require works)
    await page.evaluate(() => {
      const Store = require('electron-store');
      const s = new Store();
      s.set('settings', {
        app: 'Standalone Point of Sale',
        store: 'Test Store', symbol: '$', percentage: '0',
        till: 1, mac: '',
      });
    });

    // Login with admin / admin
    await page.waitForSelector('#account', { timeout: 12000 });
    await page.fill('#account input[name="username"]', 'admin');
    await page.fill('#account input[name="password"]', 'admin');
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.click('#account input[type="submit"]'),
    ]);
    await page.waitForTimeout(1500);

    // Safety net: dismiss settings modal if it still appears
    const settingsModal = page.locator('#settingsModal');
    const isVisible = await settingsModal.isVisible({ timeout: 2000 }).catch(() => false);
    if (isVisible) {
      await page.locator('#settings_form #save_settings').click();
      await page.waitForTimeout(800);
    }

    // Wait until POS view is present
    await page.waitForSelector('#pos_view', { timeout: 15000 });

    return { electronApp, page, testDir };
  } catch (err) {
    if (electronApp) await electronApp.close().catch(() => {});
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
    throw err;
  }
}

async function closeApp(electronApp, testDir) {
  if (electronApp) await electronApp.close().catch(() => {});
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
}

async function waitForServer(retries = 20) {
  const http = require('http');
  for (let i = 0; i < retries; i++) {
    const ok = await new Promise(resolve => {
      const req = http.get('http://localhost:8001/', res => resolve(res.statusCode < 500));
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => { req.destroy(); resolve(false); });
    });
    if (ok) return;
    await new Promise(r => setTimeout(r, 500));
  }
}

module.exports = { launchApp, closeApp };
