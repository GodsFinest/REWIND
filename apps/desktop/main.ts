import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { requestSchema } from "../../packages/core/requests.js";
import { noSymlinks } from "../../packages/core/fs.js";
if (process.env.REWIND_HOME)
  app.setPath(
    "userData",
    path.join(process.env.REWIND_HOME, "electron-profile"),
  );
const base = __dirname;
let window: BrowserWindow;
let worker: Worker;
let sequence = 0;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (e: Error) => void }
>();
const grants = new Set<string>();
function call(message: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...message });
  });
}
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("Untrusted IPC sender");
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  worker = new Worker(path.join(base, "worker.cjs"), {
    workerData: {
      evidenceFile: app.isPackaged
        ? path.join(base, "evaluation.json")
        : path.join(app.getAppPath(), "results", "summary.json"),
      managed:
        process.env.REWIND_HOME ||
        (!app.isPackaged
          ? path.join(process.cwd(), ".rewind", "desktop")
          : path.join(app.getPath("userData"), "workspace")),
    },
  });
  worker.on("message", (m) => {
    if (m.progress) {
      window?.webContents.send("rewind:progress", m.progress);
      return;
    }
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.result);
    }
  });
  worker.on("exit", (code) => {
    for (const p of pending.values())
      p.reject(
        new Error(
          "Storage worker stopped (code " + code + "). Restart REWIND.",
        ),
      );
    pending.clear();
  });
  worker.on("error", (e) => {
    for (const p of pending.values()) p.reject(e);
    pending.clear();
  });
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 640,
    backgroundColor: "#101312",
    title: "REWIND",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(base, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e) => e.preventDefault());
  window.webContents.on("will-attach-webview", (e) => e.preventDefault());
  ipcMain.handle("rewind:request", async (event, raw) => {
    trusted(event);
    const request = requestSchema.parse(raw);
    if (
      request.action === "setup" &&
      ![request.source, ...request.roots].every((p) =>
        grants.has(path.resolve(p)),
      )
    )
      throw new Error("Choose all directories using the native picker");
    if (
      request.action === "restore" &&
      !grants.has(path.resolve(request.parent))
    )
      throw new Error("Choose destination parent using the native picker");
    return call({ request });
  });
  ipcMain.handle("rewind:pick", async (e) => {
    trusted(e);
    const result = await dialog.showOpenDialog(window, {
      title: "Choose a folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) return null;
    const p = await noSymlinks(result.filePaths[0]);
    grants.add(p);
    return p;
  });
  ipcMain.handle("rewind:cancel", (e) => {
    trusted(e);
    worker.postMessage({ cancel: true });
  });
  ipcMain.handle("rewind:open", async (e, id) => {
    trusted(e);
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      throw new Error("Invalid receipt id");
    const destination = await call({ output: id });
    shell.showItemInFolder(destination as string);
  });
  // Test-only automation uses CDP; storage APIs and folder grants stay unchanged.
  if (process.env.REWIND_DEV_URL)
    await window.loadURL(process.env.REWIND_DEV_URL);
  else await window.loadFile(path.join(base, "renderer", "index.html"));
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  void worker?.terminate();
});
