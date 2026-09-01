const { contextBridge, ipcRenderer } = require('electron');

// Minimal, safe surface exposed to the renderer.
// The renderer itself (the normal web UI) ships with nodeIntegration/contextIsolation
// locked down; only these explicit, validated helpers are exposed.
contextBridge.exposeInMainWorld('traceiqDesktop', {
  getAppVersion: () => ipcRenderer.invoke('desktop:get-app-version'),
  getUserDataPath: () => ipcRenderer.invoke('desktop:get-user-data-path'),
  getConfigState: () => ipcRenderer.invoke('desktop:get-config'),

  // Settings
  saveSettings: (payload) => ipcRenderer.invoke('desktop:save-settings', payload),
  openUserDataFolder: () => ipcRenderer.invoke('desktop:open-user-data-folder'),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  relaunchApp: () => ipcRenderer.invoke('desktop:relaunch'),

  // Server status for the settings page
  getServerStatus: () => ipcRenderer.invoke('desktop:server-status'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
});
