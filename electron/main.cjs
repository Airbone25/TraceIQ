const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const desktopConfig = require('./desktop-config.cjs');
const desktopServer = require('./desktop-server.cjs');
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch { /* electron-updater not installed in dev */ }

let mainWindow = null;
let settingsWindow = null;
let booting = false;

function preloadPath() {
  return path.join(__dirname, 'preload.cjs');
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    title: 'Whybase',
    backgroundColor: '#17181c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  // Prevent the app window from navigating away from the local server or the
  // bundled first-run/settings pages.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      openExternalSafe(url);
    }
  });
  return win;
}

function isAllowedNavigation(url) {
  if (url.startsWith('file:')) {
    const p = url.replace('file://', '').split('?')[0];
    const base = path.basename(p);
    return base === 'settings.html';
  }
  const host = url.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  return host === '127.0.0.1' || host === 'localhost';
}

function openExternalSafe(url) {
  const allowed = /^https:\/\//i.test(url);
  if (!allowed) return;
  shell.openExternal(url).catch(() => {});
}

// ---------- Settings pages ----------

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 620,
    height: 720,
    parent: mainWindow,
    modal: false,
    title: 'Whybase Settings',
    backgroundColor: '#17181c',
    webPreferences: {
      preload: preloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'desktop', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ---------- Boot flow ----------

async function bootApp() {
  if (booting) return;
  booting = true;
  console.log('[boot] starting…');
  try {
    // Verify the MongoDB product-data store is reachable before starting.
    try {
      console.log('[boot] checking MongoDB…');
      await desktopServer.checkDatabase();
      console.log('[boot] MongoDB ok');
    } catch (err) {
      console.error('[boot] MongoDB check FAILED:', err.message);
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Product-data store unavailable',
        message: 'Could not connect to the MongoDB database that stores app data.',
        detail: `${err.message}\n\nThe MongoDB connection is baked into this build and cannot be changed from Settings.`,
        buttons: ['Open Settings', 'Quit'],
      }).then(({ response }) => {
        if (response === 0) openSettings();
        else app.quit();
      });
      booting = false;
      return;
    }
    await startServerAndLoad();
  } finally {
    booting = false;
  }
}

async function startServerAndLoad() {
  const port = desktopConfig.loadConfig().serverPort;
  const portFree = await desktopServer.isPortAvailable(port);
  if (!portFree) {
    dialog.showErrorBox(
      'Port already in use',
      `Port ${port} is already in use by another application.\n\nClose the other application, or open Settings and change the Whybase server port, then relaunch.`
    );
    return;
  }
  let child = desktopServer.startServer();
  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  let timedOut = false;
  const healthPromise = desktopServer.waitForServer(25000).catch(() => { timedOut = true; });
  const result = await Promise.race([exitPromise, healthPromise.then(() => null)]);
  if (result) {
    await desktopServer.stopServer();
    console.error('Server exited before becoming ready', result);
    dialog.showErrorBox(
      'Server failed to start',
      `The Whybase background server crashed during startup (exit code ${result.code}).\n\nCheck your MongoDB and Groq settings, then relaunch. See the logs for details.`
    );
    return;
  }
  if (timedOut) {
    await desktopServer.stopServer();
    dialog.showErrorBox(
      'Server failed to start',
      `The Whybase server did not become ready within 25s on port ${port}. Check your MongoDB and Groq settings, then relaunch.`
    );
    return;
  }
  mainWindow.setTitle('Whybase');
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

// ---------- IPC ----------

function maskKey(value) {
  if (!value) return { has: false, masked: '' };
  const last4 = value.slice(-4);
  return { has: true, masked: `••••••••${last4}` };
}

ipcMain.handle('desktop:get-app-version', () => app.getVersion());
ipcMain.handle('desktop:get-user-data-path', () => app.getPath('userData'));
ipcMain.handle('desktop:open-user-data-folder', () => {
  shell.openPath(app.getPath('userData')).catch(() => {});
  return true;
});
ipcMain.handle('desktop:open-external', (_e, url) => {
  openExternalSafe(String(url));
  return true;
});
ipcMain.handle('desktop:relaunch', () => {
  app.relaunch();
  app.exit(0);
  return true;
});
ipcMain.handle('desktop:server-status', () => {
  return { configured: desktopConfig.isConfigured(), port: desktopConfig.loadConfig().serverPort };
});
ipcMain.handle('desktop:check-for-updates', async () => {
  if (!autoUpdater || !app.isPackaged) return { ok: false, error: 'Auto-update only in packaged build' };
  try {
    const res = await autoUpdater.checkForUpdatesAndNotify();
    return { ok: true, version: res?.updateInfo?.version || null };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});
ipcMain.handle('desktop:get-config', () => {
  const cfg = desktopConfig.loadConfig();
  return {
    groqModel: cfg.groqModel,
    serverPort: cfg.serverPort,
    mongodbUri: cfg.mongodbUri,
    metadata: cfg.metadata,
    limits: cfg.limits,
    groqKey: maskKey(cfg.groqApiKey),
    version: app.getVersion(),
    userDataPath: app.getPath('userData'),
  };
});

ipcMain.handle('desktop:save-settings', async (_e, payload) => {
  payload = payload || {};
  const current = desktopConfig.loadConfig();
  const next = { ...current };

  if (typeof payload.groqApiKey === 'string' && payload.groqApiKey.trim() !== '') {
    next.groqApiKey = payload.groqApiKey.trim();
  }
  if (typeof payload.groqModel === 'string') {
    next.groqModel = payload.groqModel.trim() || 'openai/gpt-oss-120b';
  }
  if (payload.metadata && typeof payload.metadata === 'object') {
    next.metadata = {
      ...current.metadata,
      mysqlHost: String(payload.metadata.mysqlHost || current.metadata.mysqlHost),
      mysqlPort: parseInt(payload.metadata.mysqlPort || current.metadata.mysqlPort || '3306', 10),
      mysqlUser: String(payload.metadata.mysqlUser || current.metadata.mysqlUser),
      mysqlPassword: String(payload.metadata.mysqlPassword != null ? payload.metadata.mysqlPassword : current.metadata.mysqlPassword),
      mysqlDatabase: String(payload.metadata.mysqlDatabase || current.metadata.mysqlDatabase),
      mysqlUseSsl: Boolean(payload.metadata.mysqlUseSsl ?? current.metadata.mysqlUseSsl),
      mysqlSslRejectUnauthorized: payload.metadata.mysqlSslRejectUnauthorized != null ? Boolean(payload.metadata.mysqlSslRejectUnauthorized) : (current.metadata.mysqlSslRejectUnauthorized ?? true),
    };
  }
  desktopConfig.saveConfig(next);

  const changedPort = current.serverPort && payload.serverPort && parseInt(payload.serverPort, 10) !== current.serverPort;
  if (changedPort) {
    next.serverPort = parseInt(payload.serverPort, 10);
    desktopConfig.saveConfig(next);
  }

  // Reflect the new configuration: verify the store, restart the server, reload the app.
  try {
    await desktopServer.checkDatabase();
  } catch (err) {
    return { ok: false, error: `MongoDB connection error: ${err.message}` };
  }
  await desktopServer.stopServer();
  desktopServer.startServer();
  try {
    await desktopServer.waitForServer(25000);
  } catch (err) {
    return { ok: false, error: `Server failed to restart: ${err.message}` };
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(`http://127.0.0.1:${desktopConfig.loadConfig().serverPort}/`);
  }
  return { ok: true };
});

// ---------- Menu ----------
// Native menu bar is hidden by default (autoHideMenuBar: true + setMenuBarVisibility(false)).
// File/Help are removed for a cleaner frame — access Settings via the in-app gear icon.
// Press Alt to temporarily show the menu if needed. To fully disable even the Alt reveal,
// uncomment `Menu.setApplicationMenu(null)` and remove the template below.

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', click: openSettings },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  // Hide File/Help — keep only View (and macOS app menu). View stays hidden until Alt is pressed.
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  // To completely remove the menu bar (no Alt reveal), uncomment:
  // Menu.setApplicationMenu(null);
}

// ---------- Auto-update (GitHub Releases) ----------

function sendUpdaterStatus(payload) {
  for (const win of [mainWindow, settingsWindow]) {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('updater:status', payload);
    }
  }
}

function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking for updates');
    sendUpdaterStatus({ status: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info?.version);
    sendUpdaterStatus({ status: 'available', version: info?.version || null });
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up to date');
    sendUpdaterStatus({ status: 'up-to-date', version: app.getVersion() });
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] update downloaded:', info?.version);
    sendUpdaterStatus({ status: 'downloaded', version: info?.version || null });
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: 'A new version of Whybase has been downloaded.',
      detail: 'Restart now to apply the update?',
      buttons: ['Restart', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.on('error', (err) => {
    console.log('[updater] error:', err?.message || err);
    sendUpdaterStatus({ status: 'error', error: err?.message || String(err) });
  });
  // Check 5s after boot, then every 6h
  setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 5000);
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 6 * 60 * 60 * 1000);
}

// ---------- Lifecycle ----------

app.whenReady().then(async () => {
  app.setAppUserModelId('com.whybase.desktop');
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  desktopConfig.loadConfig(); // generates + persists APP_SECRET if missing
  buildMenu();

  mainWindow = createMainWindow();
  mainWindow.loadFile(path.join(__dirname, 'desktop', 'loading.html'));

  mainWindow.webContents.once('did-finish-load', () => bootApp());

  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      bootApp();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function shutdown() {
  try {
    await desktopServer.stopServer();
  } catch { /* ignore */ }
}

app.on('before-quit', (e) => {
  shutdown();
});

app.on('will-quit', () => {
  shutdown();
});
