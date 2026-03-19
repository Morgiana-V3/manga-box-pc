"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store");
const AdmZip = require("adm-zip");
const store = new Store();
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"];
const ARCHIVE_EXTS = [".zip", ".cbz", ".cbr"];
let DEFAULT_LIBRARY_DIR = "";
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: "#1a1a2e",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
electron.app.whenReady().then(() => {
  DEFAULT_LIBRARY_DIR = path.join(electron.app.getPath("userData"), "manga-library");
  fs.mkdirSync(DEFAULT_LIBRARY_DIR, { recursive: true });
  electron.protocol.registerFileProtocol("manga-file", (request, callback) => {
    const url = decodeURIComponent(request.url.replace("manga-file://", ""));
    callback({ path: url });
  });
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
function getExt(filename) {
  const idx = filename.lastIndexOf(".");
  if (idx === -1) return "";
  return filename.slice(idx).toLowerCase();
}
function naturalSort(a, b) {
  return a.localeCompare(b, void 0, { numeric: true, sensitivity: "base" });
}
function autoRenameImages(folderPath) {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const hasSubs = entries.some((e) => e.isDirectory());
  if (hasSubs) {
    for (const entry of entries) {
      if (entry.isDirectory()) {
        autoRenameImages(path.join(folderPath, entry.name));
      }
    }
  } else {
    const images = entries.filter((e) => e.isFile() && IMAGE_EXTS.includes(getExt(e.name))).map((e) => e.name).sort(naturalSort);
    if (images.length === 0) return;
    const tmpMaps = [];
    for (let i = 0; i < images.length; i++) {
      const ext = getExt(images[i]);
      const tmpName = `_tmp_${i}${ext}`;
      fs.renameSync(path.join(folderPath, images[i]), path.join(folderPath, tmpName));
      tmpMaps.push({ tmp: tmpName, ext });
    }
    for (let i = 0; i < tmpMaps.length; i++) {
      const finalName = `${String(i + 1).padStart(3, "0")}${tmpMaps[i].ext}`;
      fs.renameSync(path.join(folderPath, tmpMaps[i].tmp), path.join(folderPath, finalName));
    }
  }
}
electron.ipcMain.on("window-minimize", (e) => electron.BrowserWindow.fromWebContents(e.sender)?.minimize());
electron.ipcMain.on("window-maximize", (e) => {
  const win = electron.BrowserWindow.fromWebContents(e.sender);
  if (win?.isMaximized()) win.unmaximize();
  else win?.maximize();
});
electron.ipcMain.on("window-close", (e) => electron.BrowserWindow.fromWebContents(e.sender)?.close());
electron.ipcMain.handle("dialog:openFolder", async () => {
  const result = await electron.dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});
electron.ipcMain.handle("dialog:openArchive", async () => {
  const result = await electron.dialog.showOpenDialog({
    filters: [{ name: "Comic Archives", extensions: ["zip", "cbz", "cbr"] }],
    properties: ["openFile", "multiSelections"]
  });
  if (result.canceled || !result.filePaths.length) return [];
  return result.filePaths;
});
electron.ipcMain.handle("fs:getDefaultLibraryDir", () => DEFAULT_LIBRARY_DIR);
electron.ipcMain.handle(
  "fs:importBook",
  async (_event, sourcePath, destDir) => {
    if (!fs.existsSync(sourcePath)) return false;
    fs.mkdirSync(destDir, { recursive: true });
    const name = path.basename(sourcePath);
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    let destPath = path.join(destDir, name);
    if (fs.existsSync(destPath)) {
      destPath = path.join(destDir, `${base}_${Date.now()}${ext}`);
    }
    try {
      const stat = fs.statSync(sourcePath);
      if (stat.isDirectory()) {
        fs.cpSync(sourcePath, destPath, { recursive: true });
        autoRenameImages(destPath);
      } else {
        fs.copyFileSync(sourcePath, destPath);
      }
      return true;
    } catch (err) {
      console.error("importBook failed:", sourcePath, err);
      return false;
    }
  }
);
electron.ipcMain.handle("fs:removeBook", async (_event, bookPath) => {
  try {
    if (!fs.existsSync(bookPath)) return true;
    await electron.shell.trashItem(bookPath);
    return true;
  } catch (err) {
    console.error("removeBook failed:", bookPath, err);
    return false;
  }
});
electron.ipcMain.handle("fs:scanLibrary", async (_event, folderPath) => {
  if (!fs.existsSync(folderPath)) return [];
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const books = [];
  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
      const hasSubs = subEntries.some((e) => e.isDirectory());
      if (hasSubs) {
        const chapterDirs = subEntries.filter((e) => e.isDirectory()).sort((a, b) => naturalSort(a.name, b.name));
        let totalPages = 0;
        let cover = null;
        for (const ch of chapterDirs) {
          const chPath = path.join(fullPath, ch.name);
          const imgs = fs.readdirSync(chPath).filter((f) => IMAGE_EXTS.includes(getExt(f))).sort(naturalSort);
          totalPages += imgs.length;
          if (!cover && imgs.length > 0) cover = path.join(chPath, imgs[0]);
        }
        books.push({
          id: btoa(encodeURIComponent(fullPath)),
          title: entry.name,
          path: fullPath,
          type: "folder",
          kind: "series",
          cover,
          pageCount: totalPages,
          chapterCount: chapterDirs.length,
          addedAt: fs.statSync(fullPath).mtimeMs
        });
      } else {
        const images = subEntries.filter((e) => e.isFile() && IMAGE_EXTS.includes(getExt(e.name))).map((e) => e.name).sort(naturalSort);
        if (images.length > 0) {
          books.push({
            id: btoa(encodeURIComponent(fullPath)),
            title: entry.name,
            path: fullPath,
            type: "folder",
            kind: "single",
            cover: path.join(fullPath, images[0]),
            pageCount: images.length,
            addedAt: fs.statSync(fullPath).mtimeMs
          });
        }
      }
    } else if (ARCHIVE_EXTS.includes(getExt(entry.name))) {
      try {
        const zip = new AdmZip(fullPath);
        const pages = zip.getEntries().filter((e) => IMAGE_EXTS.includes(getExt(e.entryName)) && !e.isDirectory).sort((a, b) => naturalSort(a.entryName, b.entryName));
        if (pages.length > 0) {
          books.push({
            id: btoa(encodeURIComponent(fullPath)),
            title: entry.name.replace(/\.[^.]+$/, ""),
            path: fullPath,
            type: "archive",
            kind: "single",
            cover: null,
            coverData: `data:image/jpeg;base64,${pages[0].getData().toString("base64")}`,
            pageCount: pages.length,
            addedAt: fs.statSync(fullPath).mtimeMs
          });
        }
      } catch (err) {
        console.error("Failed to read archive:", fullPath, err);
      }
    }
  }
  return books.sort((a, b) => a.title.localeCompare(b.title, "zh"));
});
electron.ipcMain.handle(
  "fs:getPages",
  async (_event, bookPath, bookType) => {
    if (bookType === "folder") {
      const files = fs.readdirSync(bookPath).filter((f) => IMAGE_EXTS.includes(getExt(f))).sort(naturalSort);
      return files.map((f) => `manga-file://${encodeURIComponent(path.join(bookPath, f))}`);
    } else {
      const zip = new AdmZip(bookPath);
      const pages = zip.getEntries().filter((e) => IMAGE_EXTS.includes(getExt(e.entryName)) && !e.isDirectory).sort((a, b) => naturalSort(a.entryName, b.entryName));
      return pages.map((e) => {
        const data = e.getData().toString("base64");
        const mime = getExt(e.entryName) === ".png" ? "image/png" : "image/jpeg";
        return `data:${mime};base64,${data}`;
      });
    }
  }
);
electron.ipcMain.handle("fs:getChapters", async (_event, seriesPath) => {
  if (!fs.existsSync(seriesPath)) return [];
  const entries = fs.readdirSync(seriesPath, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => naturalSort(a.name, b.name));
  const chapters = [];
  for (let i = 0; i < entries.length; i++) {
    const chPath = path.join(seriesPath, entries[i].name);
    const imgs = fs.readdirSync(chPath).filter((f) => IMAGE_EXTS.includes(getExt(f))).sort(naturalSort);
    if (imgs.length > 0) {
      chapters.push({
        id: btoa(encodeURIComponent(chPath)),
        title: entries[i].name,
        path: chPath,
        cover: path.join(chPath, imgs[0]),
        pageCount: imgs.length,
        index: i
      });
    }
  }
  return chapters;
});
electron.ipcMain.handle(
  "fs:reorderChapters",
  async (_event, seriesPath, chapterNames) => {
    try {
      const tmpNames = [];
      for (let i = 0; i < chapterNames.length; i++) {
        const tmpName = `_reorder_tmp_${i}`;
        fs.renameSync(path.join(seriesPath, chapterNames[i]), path.join(seriesPath, tmpName));
        tmpNames.push(tmpName);
      }
      for (let i = 0; i < tmpNames.length; i++) {
        fs.renameSync(path.join(seriesPath, tmpNames[i]), path.join(seriesPath, chapterNames[i]));
      }
      return true;
    } catch (err) {
      console.error("reorderChapters failed:", err);
      return false;
    }
  }
);
electron.ipcMain.handle(
  "fs:renamePages",
  async (_event, bookPath, filenames) => {
    try {
      const tmpMaps = [];
      for (let i = 0; i < filenames.length; i++) {
        const ext = getExt(filenames[i]);
        const tmpName = `_rename_tmp_${i}${ext}`;
        fs.renameSync(path.join(bookPath, filenames[i]), path.join(bookPath, tmpName));
        tmpMaps.push({ tmp: tmpName, ext });
      }
      for (let i = 0; i < tmpMaps.length; i++) {
        const finalName = `${String(i + 1).padStart(3, "0")}${tmpMaps[i].ext}`;
        fs.renameSync(path.join(bookPath, tmpMaps[i].tmp), path.join(bookPath, finalName));
      }
      return true;
    } catch (err) {
      console.error("renamePages failed:", err);
      return false;
    }
  }
);
electron.ipcMain.handle(
  "fs:renameBook",
  async (_event, bookPath, newTitle) => {
    try {
      const parent = path.dirname(bookPath);
      const newPath = path.join(parent, newTitle);
      if (fs.existsSync(newPath) && newPath !== bookPath) return null;
      if (newPath !== bookPath) fs.renameSync(bookPath, newPath);
      return newPath;
    } catch (err) {
      console.error("renameBook failed:", err);
      return null;
    }
  }
);
electron.ipcMain.handle("store:get", (_event, key) => store.get(key));
electron.ipcMain.handle("store:set", (_event, key, value) => store.set(key, value));
electron.ipcMain.handle("store:delete", (_event, key) => store.delete(key));
electron.ipcMain.handle("shell:openPath", async (_event, targetPath) => {
  await electron.shell.openPath(targetPath);
});
