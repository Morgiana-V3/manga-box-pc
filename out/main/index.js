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
    const raw = request.url.replace("manga-file://", "");
    const noQuery = raw.split("?")[0].split("#")[0];
    const filePath = decodeURIComponent(noQuery);
    callback({ path: filePath });
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
function imagePathToDataUrl(filePath) {
  try {
    const ext = getExt(filePath);
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : ext === ".bmp" ? "image/bmp" : "image/jpeg";
    const data = fs.readFileSync(filePath).toString("base64");
    return `data:${mime};base64,${data}`;
  } catch {
    return void 0;
  }
}
function readChapterOrder(seriesPath) {
  const orderFile = path.join(seriesPath, ".manga-order");
  if (!fs.existsSync(orderFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(orderFile, "utf-8"));
  } catch {
    return null;
  }
}
function sortChapterDirs(seriesPath, dirNames) {
  const order = readChapterOrder(seriesPath);
  if (!order) return [...dirNames].sort(naturalSort);
  const dirSet = new Set(dirNames);
  const validOrder = order.filter((n) => dirSet.has(n));
  const inOrder = new Set(validOrder);
  const unordered = dirNames.filter((n) => !inOrder.has(n)).sort(naturalSort);
  return [...validOrder, ...unordered];
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
electron.ipcMain.handle("dialog:openFileOrFolder", async () => {
  const result = await electron.dialog.showOpenDialog({
    title: "选择漫画文件夹或压缩包",
    filters: [{ name: "Comic Archives", extensions: ["zip", "cbz", "cbr"] }],
    properties: ["openFile", "openDirectory", "multiSelections"]
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
    const ext = path.extname(name).toLowerCase();
    const base = path.basename(name, path.extname(name));
    try {
      const stat = fs.statSync(sourcePath);
      if (stat.isDirectory()) {
        let destPath = path.join(destDir, name);
        if (fs.existsSync(destPath)) {
          destPath = path.join(destDir, `${base}_${Date.now()}`);
        }
        fs.cpSync(sourcePath, destPath, { recursive: true });
        autoRenameImages(destPath);
      } else if (ARCHIVE_EXTS.includes(ext)) {
        let destPath = path.join(destDir, base);
        if (fs.existsSync(destPath)) {
          destPath = path.join(destDir, `${base}_${Date.now()}`);
        }
        fs.mkdirSync(destPath, { recursive: true });
        const zip = new AdmZip(sourcePath);
        zip.extractAllTo(destPath, true);
        const extracted = fs.readdirSync(destPath, { withFileTypes: true });
        if (extracted.length === 1 && extracted[0].isDirectory()) {
          const innerDir = path.join(destPath, extracted[0].name);
          const innerEntries = fs.readdirSync(innerDir);
          for (const ie of innerEntries) {
            fs.renameSync(path.join(innerDir, ie), path.join(destPath, ie));
          }
          try {
            fs.rmdirSync(innerDir);
          } catch {
          }
        }
        autoRenameImages(destPath);
      } else {
        let destPath = path.join(destDir, name);
        if (fs.existsSync(destPath)) {
          destPath = path.join(destDir, `${base}_${Date.now()}${ext}`);
        }
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
electron.ipcMain.handle(
  "fs:createSeries",
  async (_event, libraryDir, seriesName) => {
    try {
      const trimmed = seriesName.trim();
      if (!trimmed) return false;
      let destPath = path.join(libraryDir, trimmed);
      if (fs.existsSync(destPath)) {
        destPath = path.join(libraryDir, `${trimmed}_${Date.now()}`);
      }
      fs.mkdirSync(destPath, { recursive: true });
      fs.writeFileSync(path.join(destPath, ".manga-series"), "", "utf-8");
      return true;
    } catch (err) {
      console.error("createSeries failed:", err);
      return false;
    }
  }
);
electron.ipcMain.handle("fs:scanLibrary", async (_event, folderPath) => {
  if (!fs.existsSync(folderPath)) return [];
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const books = [];
  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
      const hasSubs = subEntries.some((e) => e.isDirectory());
      const hasSeriesMarker = fs.existsSync(path.join(fullPath, ".manga-series"));
      if (hasSubs || hasSeriesMarker) {
        const chapterDirNames = subEntries.filter((e) => e.isDirectory()).map((e) => e.name);
        const sortedChapterNames = sortChapterDirs(fullPath, chapterDirNames);
        let totalPages = 0;
        let cover = null;
        for (const chName of sortedChapterNames) {
          const chPath = path.join(fullPath, chName);
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
          coverData: cover ? imagePathToDataUrl(cover) : void 0,
          pageCount: totalPages,
          chapterCount: sortedChapterNames.length,
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
            coverData: imagePathToDataUrl(path.join(fullPath, images[0])),
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
      return files.map((f) => {
        const abs = path.join(bookPath, f);
        const st = fs.statSync(abs);
        const ver = `${Math.trunc(st.mtimeMs)}-${Math.trunc(st.ctimeMs)}`;
        return `manga-file://${encodeURIComponent(abs)}?v=${ver}`;
      });
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
  const dirNames = fs.readdirSync(seriesPath, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const sortedNames = sortChapterDirs(seriesPath, dirNames);
  const chapters = [];
  for (let i = 0; i < sortedNames.length; i++) {
    const chPath = path.join(seriesPath, sortedNames[i]);
    const imgs = fs.readdirSync(chPath).filter((f) => IMAGE_EXTS.includes(getExt(f))).sort(naturalSort);
    if (imgs.length > 0) {
      chapters.push({
        id: btoa(encodeURIComponent(chPath)),
        title: sortedNames[i],
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
      const orderFile = path.join(seriesPath, ".manga-order");
      fs.writeFileSync(orderFile, JSON.stringify(chapterNames, null, 2), "utf-8");
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
      const diskImages = fs.readdirSync(bookPath).filter((f) => IMAGE_EXTS.includes(getExt(f)));
      const lowerMap = new Map(diskImages.map((n) => [n.toLowerCase(), n]));
      const normalize = (val) => {
        const noQuery = val.split("?")[0].split("#")[0];
        const noProto = noQuery.startsWith("manga-file://") ? noQuery.replace("manga-file://", "") : noQuery;
        const decoded = decodeURIComponent(noProto);
        const name = path.basename(decoded.replace(/\\/g, "/"));
        return name;
      };
      const orderedNames = [];
      for (const raw of filenames) {
        const wanted = normalize(raw);
        if (diskImages.includes(wanted)) {
          orderedNames.push(wanted);
          continue;
        }
        const matched = lowerMap.get(wanted.toLowerCase());
        if (!matched) {
          console.error("renamePages failed: source file not found", { bookPath, raw, wanted });
          return false;
        }
        orderedNames.push(matched);
      }
      if (orderedNames.length !== diskImages.length) {
        console.error("renamePages failed: page count mismatch", {
          bookPath,
          ordered: orderedNames.length,
          disk: diskImages.length
        });
        return false;
      }
      const tmpMaps = [];
      for (let i = 0; i < orderedNames.length; i++) {
        const ext = getExt(orderedNames[i]);
        const tmpName = `_rename_tmp_${i}${ext}`;
        fs.renameSync(path.join(bookPath, orderedNames[i]), path.join(bookPath, tmpName));
        tmpMaps.push({ tmp: tmpName, ext });
      }
      for (let i = 0; i < tmpMaps.length; i++) {
        const finalName = `${String(i + 1).padStart(3, "0")}${tmpMaps[i].ext}`;
        fs.renameSync(path.join(bookPath, tmpMaps[i].tmp), path.join(bookPath, finalName));
      }
      await Promise.all(
        electron.BrowserWindow.getAllWindows().map((w) => w.webContents.session.clearCache())
      );
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
      const oldName = path.basename(bookPath);
      const newPath = path.join(parent, newTitle);
      if (fs.existsSync(newPath) && newPath !== bookPath) return null;
      if (newPath !== bookPath) {
        fs.renameSync(bookPath, newPath);
        const orderFile = path.join(parent, ".manga-order");
        if (fs.existsSync(orderFile)) {
          try {
            const order = JSON.parse(fs.readFileSync(orderFile, "utf-8"));
            const updated = order.map((n) => n === oldName ? newTitle : n);
            fs.writeFileSync(orderFile, JSON.stringify(updated, null, 2), "utf-8");
          } catch {
          }
        }
      }
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
