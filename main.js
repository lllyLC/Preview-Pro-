const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

let win, ready = false;
let queue = [];

const read = (paths) => paths.map((p) => ({ name: path.basename(p), bytes: fs.readFileSync(p) }));
function openPaths(paths) {
  const files = read(paths);
  if (win && ready) win.webContents.send('files', files);
  else queue.push(...files);
}
const menu = (cmd) => () => win && win.webContents.send('menu', cmd);

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 560,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: '#221824',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    ready = true;
    if (queue.length) { win.webContents.send('files', queue); queue = []; }
  });
  win.on('closed', () => { win = null; ready = false; });
}

app.on('open-file', (e, p) => { e.preventDefault(); openPaths([p]); });

app.whenReady().then(() => {
  ipcMain.handle('open', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF & Images', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    return r.canceled ? [] : read(r.filePaths);
  });
  ipcMain.handle('save', async (_e, name, bytes) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: name });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, Buffer.from(bytes));
    return r.filePath;
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: menu('open') },
      { label: 'Export as PDF…', accelerator: 'CmdOrCtrl+S', click: menu('export') },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: menu('close') },
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: menu('undo') },
      { type: 'separator' },
      { role: 'copy' }, { role: 'selectAll' },
      { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: menu('find') },
    ] },
    { label: 'View', submenu: [
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: menu('zin') },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: menu('zout') },
      { label: 'Fit Width', accelerator: 'CmdOrCtrl+0', click: menu('fit') },
      { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+Alt+S', click: menu('side') },
      { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ]));

  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
