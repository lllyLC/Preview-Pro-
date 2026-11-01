const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  open: () => ipcRenderer.invoke('open'),
  save: (name, bytes) => ipcRenderer.invoke('save', name, bytes),
  on: (channel, fn) => {
    if (['files', 'menu'].includes(channel)) ipcRenderer.on(channel, (_e, ...a) => fn(...a));
  },
});
