import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, Progress } from "./api.js";
const bridge: Bridge = {
  request: (request) => ipcRenderer.invoke("rewind:request", request),
  pickFolder: () => ipcRenderer.invoke("rewind:pick"),
  openOutput: (id) => ipcRenderer.invoke("rewind:open", id),
  cancel: () => ipcRenderer.invoke("rewind:cancel"),
  onProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, p: Progress) =>
      callback(p);
    ipcRenderer.on("rewind:progress", listener);
    return () => ipcRenderer.removeListener("rewind:progress", listener);
  },
};
contextBridge.exposeInMainWorld("rewind", bridge);
