const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("scannerAPI", {
  scanContract: (payload) => ipcRenderer.invoke("scan-contract", payload),
});
