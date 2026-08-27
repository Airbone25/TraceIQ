const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const desktopConfig = require('./desktop-config.cjs');
const desktopServer = require('./desktop-server.cjs');

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
    title: 'TraceIQ',
    backgroundColor: '#17181c',
    webPreferences: {
      preload: preloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
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
    return base === 'first-run.html' || base === 'settings.html';
  }
  const host = url.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  return host === '127.0.0.1' || host === 'localhost';
}

function openExternalSafe(url) {
  const allowed = /^https:\/\//i.test(url);
  if (!allowed) return;
  shell.openExternal(url).catch(() => {});
}

// ---------- First-run / Settings pages ----------

function loadFirstRun() {
  mainWindow.loadFile(path.join(__dirname, 'desktop', 'first-run.html'));
  mainWindow.setTitle('TraceIQ — Setup');
}

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
    title: 'TraceIQ Settings',
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
    // Reapply the (idempotent) schema each launch so a fresh/updated metadata DB works.
    try {
      console.log('[boot] provisioning schema…');
      await desktopServer.provisionSchema();
      console.log('[boot] schema ok');
    } catch (err) {
      console.error('[boot] schema provisioning FAILED:', err.message);
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Metadata database unavailable',
        message: 'Could not connect to the MySQL database that stores app data.',
        detail: `${err.message}\n\nOpen Settings to correct the MySQL details, then relaunch.`,
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
      `Port ${port} is already in use by another application.\n\nClose the other application, or open Settings and change the TraceIQ server port, then relaunch.`
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
      `The TraceIQ background server crashed during startup (exit code ${result.code}).\n\nCheck your MySQL and Groq settings, then relaunch. See the logs for details.`
    );
    return;
  }
  if (timedOut) {
    await desktopServer.stopServer();
    dialog.showErrorBox(
      'Server failed to start',
      `The TraceIQ server did not become ready within 25s on port ${port}. Check your MySQL and Groq settings, then relaunch.`
    );
    return;
  }
  mainWindow.setTitle('TraceIQ');
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
ipcMain.handle('desktop:get-config', () => {
  const cfg = desktopConfig.loadConfig();
  return {
    groqModel: cfg.groqModel,
    serverPort: cfg.serverPort,
    metadata: cfg.metadata,
    limits: cfg.limits,
    groqKey: maskKey(cfg.groqApiKey),
    version: app.getVersion(),
    userDataPath: app.getPath('userData'),
  };
});

async function handleSaveFirstRun(_e, payload) {
  payload = payload || {};
  const key = String(payload.groqApiKey || '').trim();
  if (!key) {
    return { ok: false, error: 'A Groq API key is required.' };
  }
  const current = desktopConfig.loadConfig();
  const next = {
    ...current,
    groqApiKey: key,
    groqModel: String(payload.groqModel || current.groqModel || 'openai/gpt-oss-120b').trim(),
    metadata: {
      mysqlHost: String(payload.mysqlHost || current.metadata.mysqlHost || '127.0.0.1'),
      mysqlPort: parseInt(payload.mysqlPort || current.metadata.mysqlPort || '3306', 10),
      mysqlUser: String(payload.mysqlUser || current.metadata.mysqlUser || 'root'),
      mysqlPassword: String(payload.mysqlPassword || current.metadata.mysqlPassword || ''),
      mysqlDatabase: String(payload.mysqlDatabase || current.metadata.mysqlDatabase || 'traceiq'),
    },
  };
  desktopConfig.saveConfig(next);

  // Validate the metadata MySQL connection right away by provisioning the schema.
  try {
    await desktopServer.provisionSchema();
  } catch (err) {
    return { ok: false, error: `Could not reach the metadata MySQL database:\n${err.message}` };
  }
  desktopServer.startServer();
  try {
    await desktopServer.waitForServer(25000);
  } catch (err) {
    await desktopServer.stopServer();
    return { ok: false, error: `Server failed to start after saving: ${err.message}` };
  }
  mainWindow.setTitle('TraceIQ');
  mainWindow.loadURL(`http://127.0.0.1:${desktopConfig.loadConfig().serverPort}/`);
  return { ok: true };
}
ipcMain.handle('desktop:save-first-run', handleSaveFirstRun);

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
    };
  }
  desktopConfig.saveConfig(next);

  const changedPort = current.serverPort && payload.serverPort && parseInt(payload.serverPort, 10) !== current.serverPort;
  if (changedPort) {
    next.serverPort = parseInt(payload.serverPort, 10);
    desktopConfig.saveConfig(next);
  }

  // Reflect the new configuration: apply schema, restart the server, reload the app.
  try {
    await desktopServer.provisionSchema();
  } catch (err) {
    return { ok: false, error: `Metadata MySQL error: ${err.message}` };
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
      label: 'File',
      submenu: [
        { label: 'Settings…', click: openSettings, accelerator: 'CmdOrCtrl+,' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
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
    {
      label: 'Help',
      submenu: [
        {
          label: 'About TraceIQ',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About TraceIQ',
              message: `TraceIQ v${app.getVersion()}`,
              detail: `Data directory:\n${app.getPath('userData')}\n\nThe app runs a local-only server on 127.0.0.1. Always use a read-only MySQL user for investigation connections.`,
              buttons: ['OK', 'Open Data Folder'],
            }).then(({ response }) => {
              if (response === 1) shell.openPath(app.getPath('userData'));
            });
          },
        },
        {
          label: 'Open User Data Folder',
          click: () => shell.openPath(app.getPath('userData')),
        },
        {
          label: 'Get a Groq API key',
          click: () => openExternalSafe('https://console.groq.com'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Lifecycle ----------

app.whenReady().then(async () => {
  app.setAppUserModelId('com.traceiq.desktop');
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  desktopConfig.loadConfig(); // generates + persists APP_SECRET if missing
  buildMenu();

  mainWindow = createMainWindow();
  mainWindow.loadFile(path.join(__dirname, 'desktop', 'loading.html'));

  if (desktopConfig.isConfigured()) {
    mainWindow.webContents.once('did-finish-load', () => bootApp());
  } else {
    mainWindow.webContents.once('did-finish-load', () => loadFirstRun());
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      if (desktopConfig.isConfigured()) bootApp();
      else loadFirstRun();
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
