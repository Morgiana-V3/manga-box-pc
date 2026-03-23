"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
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
function checkIsSeries(folderPath) {
  try {
    if (fs.existsSync(path.join(folderPath, ".manga-series"))) return true;
    return fs.readdirSync(folderPath, { withFileTypes: true }).some((e) => e.isDirectory());
  } catch {
    return false;
  }
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
  "fs:deletePages",
  async (_event, bookPath, pageKeys) => {
    try {
      for (const key of pageKeys) {
        const filePath = path.join(bookPath, key);
        if (fs.existsSync(filePath)) {
          await electron.shell.trashItem(filePath);
        }
      }
      return true;
    } catch (err) {
      console.error("deletePages failed:", err);
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
let sniffWin = null;
let sniffWinVisible = true;
const sniffedImages = /* @__PURE__ */ new Map();
const sniffedRequestHeaders = /* @__PURE__ */ new Map();
let sniffSession = null;
let cdpAttached = false;
let pendingRequests = 0;
let lastNetworkActivityTime = 0;
const IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
  "image/svg+xml"
];
const IMG_URL_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"];
const BINARY_MIMES = ["application/octet-stream", "binary/octet-stream"];
function isImageResource(url, contentType) {
  if (contentType) {
    const lower = contentType.toLowerCase();
    if (IMAGE_MIMES.some((m) => lower.includes(m))) return true;
    if (BINARY_MIMES.some((m) => lower.includes(m))) {
      return hasImageExt(url);
    }
  }
  return hasImageExt(url);
}
function hasImageExt(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return IMG_URL_EXTS.some((ext) => pathname.endsWith(ext) || pathname.includes(ext + "?"));
  } catch {
    return false;
  }
}
function getMainWin() {
  return electron.BrowserWindow.getAllWindows().find((w) => w !== sniffWin) ?? null;
}
function waitForNetworkIdle(quietMs = 2e3, timeoutMs = 3e4) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      const now = Date.now();
      if (now - startTime > timeoutMs) {
        resolve();
        return;
      }
      if (pendingRequests <= 0 && now - lastNetworkActivityTime >= quietMs) {
        resolve();
        return;
      }
      setTimeout(check, 300);
    };
    setTimeout(check, Math.min(quietMs, 500));
  });
}
function attachCDP() {
  if (!sniffWin || sniffWin.isDestroyed() || cdpAttached) return;
  const dbg = sniffWin.webContents.debugger;
  try {
    dbg.attach("1.3");
    cdpAttached = true;
  } catch (err) {
    console.error("CDP attach failed:", err);
    return;
  }
  dbg.sendCommand("Network.enable", {
    maxPostDataSize: 0,
    // 不需要 POST body
    maxTotalBufferSize: 0
  }).catch(() => {
  });
  dbg.sendCommand("Network.setCacheDisabled", {
    cacheDisabled: true
  }).catch(() => {
  });
  dbg.on("message", (_event, method, params) => {
    if (method === "Network.requestWillBeSent") {
      pendingRequests++;
      lastNetworkActivityTime = Date.now();
      const reqUrl = params.request?.url ?? "";
      const headers = params.request?.headers ?? {};
      if (reqUrl && !sniffedRequestHeaders.has(reqUrl)) {
        sniffedRequestHeaders.set(reqUrl, headers);
      }
      if (reqUrl && hasImageExt(reqUrl) && !sniffedImages.has(reqUrl)) {
        sniffedImages.set(reqUrl, {
          url: reqUrl,
          size: 0,
          // 此阶段还不知道大小
          contentType: ""
        });
        const mainWin = getMainWin();
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send("sniff:image-found", {
            url: reqUrl,
            size: 0,
            contentType: ""
          });
        }
      }
    } else if (method === "Network.responseReceived") {
      lastNetworkActivityTime = Date.now();
      const response = params.response ?? {};
      const reqUrl = response.url ?? "";
      const mimeType = response.mimeType ?? "";
      const contentLength = response.headers?.["content-length"] ? parseInt(response.headers["content-length"], 10) : response.headers?.["Content-Length"] ? parseInt(response.headers["Content-Length"], 10) : 0;
      if (reqUrl && isImageResource(reqUrl, mimeType)) {
        if (contentLength > 0 && contentLength < 5120) return;
        if (!sniffedImages.has(reqUrl)) {
          sniffedImages.set(reqUrl, {
            url: reqUrl,
            size: contentLength,
            contentType: mimeType
          });
          const mainWin = getMainWin();
          if (mainWin && !mainWin.isDestroyed()) {
            mainWin.webContents.send("sniff:image-found", {
              url: reqUrl,
              size: contentLength,
              contentType: mimeType
            });
          }
        } else {
          const existing = sniffedImages.get(reqUrl);
          if (existing.size === 0 || !existing.contentType) {
            existing.size = contentLength;
            existing.contentType = mimeType;
            sniffedImages.set(reqUrl, existing);
            const mainWin = getMainWin();
            if (mainWin && !mainWin.isDestroyed()) {
              mainWin.webContents.send("sniff:image-updated", {
                url: reqUrl,
                size: contentLength,
                contentType: mimeType
              });
            }
          }
        }
      }
    } else if (method === "Network.requestServedFromCache") {
      lastNetworkActivityTime = Date.now();
      const requestId = params.requestId ?? "";
      if (requestId) {
        pendingRequests = Math.max(0, pendingRequests - 1);
      }
    } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
      pendingRequests = Math.max(0, pendingRequests - 1);
      lastNetworkActivityTime = Date.now();
    }
  });
}
function detachCDP() {
  if (!cdpAttached) return;
  try {
    if (sniffWin && !sniffWin.isDestroyed()) {
      sniffWin.webContents.debugger.detach();
    }
  } catch {
  }
  cdpAttached = false;
  pendingRequests = 0;
}
const TRIGGER_LAZY_LOAD_SCRIPT = `
  (function() {
    const lazySrcAttrs = ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc',
      'data-lazy', 'data-url', 'data-echo', 'data-source', 'data-origin'];
    const imgs = document.querySelectorAll('img');
    let triggered = 0;
    for (const img of imgs) {
      if (img.src && !img.src.startsWith('data:') && img.complete && img.naturalWidth > 0) continue;
      for (const attr of lazySrcAttrs) {
        const val = img.getAttribute(attr);
        if (val && val.startsWith('http')) {
          img.src = val;
          triggered++;
          break;
        }
      }
    }
    // 强制 eager loading
    const lazyImgs = document.querySelectorAll('img[loading="lazy"], img[data-src]');
    for (const img of lazyImgs) {
      img.loading = 'eager';
    }
    return triggered;
  })()
`;
const SCROLL_AND_CAPTURE_SCRIPT = `
  new Promise(async (resolve) => {
    const captured = new Set();
    const results = [];

    function findScrollContainer() {
      const commonSelectors = [
        '.reader-container', '.comic-container', '.manga-container',
        '.chapter-content', '.reading-content', '.comic-content',
        '#comic-container', '#reader', '#viewer', '#content',
        '.viewer', '.reader', '[class*="reader"]', '[class*="viewer"]',
        '[class*="comic"]', '[class*="manga"]',
        '[class*="chapter"]', '[class*="scroll"]',
        'main', 'article', '.main-content', '.page-content'
      ];
      for (const sel of commonSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el && el.scrollHeight > el.clientHeight + 100) return el;
        } catch {}
      }
      const docEl = document.documentElement;
      const body = document.body;
      if (docEl.scrollHeight > docEl.clientHeight + 100) return docEl;
      if (body.scrollHeight > body.clientHeight + 100) return body;

      let best = null;
      let bestH = 0;
      for (const el of document.querySelectorAll('div, main, section, article')) {
        const style = getComputedStyle(el);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay') {
          if (el.scrollHeight > el.clientHeight + 100 && el.scrollHeight > bestH) {
            bestH = el.scrollHeight;
            best = el;
          }
        }
      }
      return best || docEl;
    }

    let container = findScrollContainer();
    let isDoc = container === document.documentElement || container === document.body;

    function refreshContainer() {
      const c = findScrollContainer();
      const d = c === document.documentElement || c === document.body;
      const newMax = d ? document.documentElement.scrollHeight - window.innerHeight : c.scrollHeight - c.clientHeight;
      const oldMax = isDoc ? document.documentElement.scrollHeight - window.innerHeight : container.scrollHeight - container.clientHeight;
      if (c !== container && (newMax > oldMax * 1.2 || oldMax <= 10)) {
        container = c;
        isDoc = d;
      }
    }

    const getStep = () => Math.floor((isDoc ? window.innerHeight : container.clientHeight) * 0.6);
    const getTop = () => isDoc ? (window.scrollY || document.documentElement.scrollTop) : container.scrollTop;
    const getMax = () => isDoc ? document.documentElement.scrollHeight - window.innerHeight : container.scrollHeight - container.clientHeight;
    const scroll = (n) => { if (isDoc) window.scrollBy(0, n); else container.scrollTop += n; };

    function captureCanvases() {
      let count = 0;
      for (const cvs of document.querySelectorAll('canvas')) {
        if (cvs.width < 100 || cvs.height < 100) continue;
        const rect = cvs.getBoundingClientRect();
        const cRect = isDoc ? { top: 0, bottom: window.innerHeight } : container.getBoundingClientRect();
        if (rect.bottom < cRect.top - 800 || rect.top > cRect.bottom + 800) continue;
        try {
          const ctx = cvs.getContext('2d');
          if (ctx) {
            let ok = false;
            for (const [x,y] of [[cvs.width/2,cvs.height/2],[cvs.width/4,cvs.height/4],[cvs.width*3/4,cvs.height*3/4]]) {
              if (ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data[3] > 0) { ok = true; break; }
            }
            if (!ok) continue;
          }
          const d = cvs.toDataURL('image/png');
          if (d && d.length > 1000 && !captured.has(d)) { captured.add(d); results.push(d); count++; }
        } catch {}
      }
      return count;
    }

    function triggerLazy() {
      const attrs = ['data-src','data-original','data-lazy-src','data-actualsrc','data-lazy','data-url','data-echo'];
      for (const img of document.querySelectorAll('img')) {
        if (img.src && !img.src.startsWith('data:') && img.complete && img.naturalWidth > 0) continue;
        for (const a of attrs) { const v = img.getAttribute(a); if (v && v.startsWith('http')) { img.src = v; break; } }
      }
    }

    // 滚到顶部
    if (isDoc) window.scrollTo(0, 0); else container.scrollTop = 0;
    await new Promise(r => setTimeout(r, 500));
    refreshContainer();
    captureCanvases();  // 初始捕获

    let lastMax = 0, sameCount = 0, iterations = 0;
    const MAX_ITER = 500;  // 与 AUTO_SCROLL_SCRIPT 保持一致

    while (iterations < MAX_ITER) {
      iterations++;
      if (iterations % 5 === 0) refreshContainer();

      triggerLazy();
      captureCanvases();
      scroll(getStep());
      // 每步等待 350ms（与自动滚动一致）
      await new Promise(r => setTimeout(r, 350));

      const top = getTop(), max = getMax();

      if (top >= max - 10) {
        // 到底了，多等一会让图片和后续内容加载
        await new Promise(r => setTimeout(r, 2000));
        triggerLazy();
        captureCanvases();
        refreshContainer();
        const newMax = getMax();
        if (newMax > max + 30) { sameCount = 0; lastMax = newMax; continue; }
        // 再给一次机会
        await new Promise(r => setTimeout(r, 1500));
        captureCanvases();
        refreshContainer();
        const newMax2 = getMax();
        if (newMax2 > max + 30) { sameCount = 0; lastMax = newMax2; continue; }
        break;
      }

      if (max === lastMax) {
        sameCount++;
        // 与自动滚动一致的宽松阈值
        if (sameCount >= 15) {
          refreshContainer();
          const newMax = getMax();
          if (newMax > max + 30) { sameCount = 0; lastMax = newMax; continue; }
          // 在同高度但还没到底的情况下，继续尝试滚动
          if (top < max - 50) { sameCount = 8; continue; }
          break;
        }
      } else {
        sameCount = 0;
        lastMax = max;
      }
    }

    // 最终捕获
    triggerLazy();
    captureCanvases();
    resolve(results);
  })
`;
electron.ipcMain.handle("sniff:start", async (_event, url) => {
  try {
    if (sniffWin && !sniffWin.isDestroyed()) {
      detachCDP();
      sniffWin.close();
    }
    sniffedImages.clear();
    sniffedRequestHeaders.clear();
    pendingRequests = 0;
    lastNetworkActivityTime = Date.now();
    sniffSession = electron.session.fromPartition("persist:sniffer");
    sniffWin = new electron.BrowserWindow({
      width: 1100,
      height: 750,
      show: sniffWinVisible,
      title: "嗅探预览 - MangaBox",
      autoHideMenuBar: true,
      webPreferences: {
        session: sniffSession,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false
      }
    });
    sniffWin.webContents.on("page-title-updated", (_e, title) => {
      if (sniffWin && !sniffWin.isDestroyed()) {
        sniffWin.setTitle(`${title} - MangaBox 嗅探预览`);
      }
    });
    sniffWin.webContents.on("did-navigate", (_e, navUrl) => {
      const mainWin = getMainWin();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send("sniff:url-changed", navUrl);
      }
    });
    sniffWin.webContents.on("did-navigate-in-page", (_e, navUrl) => {
      const mainWin = getMainWin();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send("sniff:url-changed", navUrl);
      }
    });
    sniffWin.on("closed", () => {
      detachCDP();
      sniffWin = null;
      const mainWin = getMainWin();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send("sniff:window-closed");
      }
    });
    attachCDP();
    await sniffWin.loadURL(url);
    await waitForNetworkIdle(2e3, 15e3);
    try {
      await sniffWin.webContents.executeJavaScript(TRIGGER_LAZY_LOAD_SCRIPT);
    } catch {
    }
    await waitForNetworkIdle(2e3, 1e4);
    return true;
  } catch (err) {
    console.error("sniff:start failed:", err);
    return false;
  }
});
electron.ipcMain.handle("sniff:stop", async () => {
  detachCDP();
  if (sniffWin && !sniffWin.isDestroyed()) {
    sniffWin.close();
  }
  sniffWin = null;
  sniffedImages.clear();
  sniffedRequestHeaders.clear();
});
electron.ipcMain.handle("sniff:triggerLazy", async () => {
  if (!sniffWin || sniffWin.isDestroyed()) return 0;
  try {
    const countBefore = sniffedImages.size;
    await sniffWin.webContents.executeJavaScript(TRIGGER_LAZY_LOAD_SCRIPT);
    await waitForNetworkIdle(1500, 8e3);
    return sniffedImages.size - countBefore;
  } catch {
    return 0;
  }
});
electron.ipcMain.handle("sniff:togglePreview", async (_event, visible) => {
  sniffWinVisible = visible;
  if (sniffWin && !sniffWin.isDestroyed()) {
    if (visible) {
      sniffWin.show();
      sniffWin.focus();
    } else {
      sniffWin.hide();
    }
  }
  return sniffWinVisible;
});
electron.ipcMain.handle("sniff:isPreviewVisible", async () => {
  if (sniffWin && !sniffWin.isDestroyed()) {
    return sniffWin.isVisible();
  }
  return false;
});
electron.ipcMain.handle("sniff:focusPreview", async () => {
  if (sniffWin && !sniffWin.isDestroyed()) {
    sniffWin.show();
    sniffWin.focus();
  }
});
electron.ipcMain.handle("sniff:checkLogin", async (_event, url) => {
  try {
    if (!sniffSession) {
      sniffSession = electron.session.fromPartition("persist:sniffer");
    }
    const cookies = await sniffSession.cookies.get({ url });
    return {
      hasCookies: cookies.length > 0,
      cookieCount: cookies.length
    };
  } catch {
    return { hasCookies: false, cookieCount: 0 };
  }
});
electron.ipcMain.handle("sniff:clearCookies", async (_event, url) => {
  try {
    if (!sniffSession) return true;
    if (url) {
      const cookies = await sniffSession.cookies.get({ url });
      for (const cookie of cookies) {
        const cookieUrl = `${cookie.secure ? "https" : "http"}://${cookie.domain?.replace(/^\./, "")}${cookie.path || "/"}`;
        await sniffSession.cookies.remove(cookieUrl, cookie.name);
      }
    } else {
      await sniffSession.clearStorageData({ storages: ["cookies"] });
    }
    return true;
  } catch (err) {
    console.error("sniff:clearCookies failed:", err);
    return false;
  }
});
electron.ipcMain.handle("sniff:getImages", async () => {
  return Array.from(sniffedImages.values());
});
electron.ipcMain.handle("sniff:executeJS", async (_event, code) => {
  if (!sniffWin || sniffWin.isDestroyed()) return null;
  try {
    return await sniffWin.webContents.executeJavaScript(code);
  } catch (err) {
    console.error("sniff:executeJS failed:", err);
    return null;
  }
});
electron.ipcMain.handle("sniff:getCurrentURL", async () => {
  if (!sniffWin || sniffWin.isDestroyed()) return "";
  return sniffWin.webContents.getURL();
});
electron.ipcMain.handle("sniff:navigate", async (_event, url) => {
  if (!sniffWin || sniffWin.isDestroyed()) return false;
  try {
    await sniffWin.loadURL(url);
    await waitForNetworkIdle(2e3, 1e4);
    try {
      await sniffWin.webContents.executeJavaScript(TRIGGER_LAZY_LOAD_SCRIPT);
    } catch {
    }
    await waitForNetworkIdle(1500, 8e3);
    return true;
  } catch {
    return false;
  }
});
electron.ipcMain.handle("sniff:clearImages", async () => {
  sniffedImages.clear();
  sniffedRequestHeaders.clear();
});
electron.ipcMain.handle("sniff:autoScroll", async () => {
  if (!sniffWin || sniffWin.isDestroyed()) return { newNetworkImages: 0, canvasDataUrls: [] };
  try {
    const countBefore = sniffedImages.size;
    const canvasDataUrls = await sniffWin.webContents.executeJavaScript(SCROLL_AND_CAPTURE_SCRIPT, true) || [];
    await waitForNetworkIdle(2500, 15e3);
    return {
      newNetworkImages: sniffedImages.size - countBefore,
      canvasDataUrls
    };
  } catch (err) {
    console.error("sniff:autoScroll failed:", err);
    return { newNetworkImages: 0, canvasDataUrls: [] };
  }
});
electron.ipcMain.handle("sniff:captureCanvas", async () => {
  if (!sniffWin || sniffWin.isDestroyed()) return [];
  try {
    const dataUrls = await sniffWin.webContents.executeJavaScript(`
      (function() {
        const results = [];
        for (const cvs of document.querySelectorAll('canvas')) {
          if (cvs.width < 100 || cvs.height < 100) continue;
          try {
            const ctx = cvs.getContext('2d');
            if (ctx) {
              let hasContent = false;
              for (const [x, y] of [
                [cvs.width/2, cvs.height/2], [cvs.width/4, cvs.height/4],
                [cvs.width*3/4, cvs.height/4], [cvs.width/4, cvs.height*3/4],
                [cvs.width*3/4, cvs.height*3/4], [cvs.width/2, cvs.height/4],
                [cvs.width/2, cvs.height*3/4]
              ]) {
                if (ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3] > 0) { hasContent = true; break; }
              }
              if (!hasContent) continue;
            }
            const d = cvs.toDataURL('image/png');
            if (d && d.length > 1000) results.push(d);
          } catch {}
        }
        return results;
      })()
    `);
    return dataUrls || [];
  } catch (err) {
    console.error("sniff:captureCanvas failed:", err);
    return [];
  }
});
electron.ipcMain.handle("sniff:scrollAndCapture", async () => {
  if (!sniffWin || sniffWin.isDestroyed()) return [];
  try {
    const mainWin = getMainWin();
    const allDataUrls = await sniffWin.webContents.executeJavaScript(SCROLL_AND_CAPTURE_SCRIPT, true);
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send("sniff:download-progress", {
        current: allDataUrls?.length || 0,
        total: allDataUrls?.length || 0,
        downloaded: allDataUrls?.length || 0
      });
    }
    return allDataUrls || [];
  } catch (err) {
    console.error("sniff:scrollAndCapture failed:", err);
    return [];
  }
});
electron.ipcMain.handle(
  "sniff:saveDataUrlsToLibrary",
  async (_event, dataUrls, mangaTitle, libraryDir) => {
    try {
      const trimmed = mangaTitle.trim() || `抓取_${Date.now()}`;
      let destPath = path.join(libraryDir, trimmed);
      if (fs.existsSync(destPath)) {
        destPath = path.join(libraryDir, `${trimmed}_${Date.now()}`);
      }
      fs.mkdirSync(destPath, { recursive: true });
      const mainWin = getMainWin();
      let saved = 0;
      for (let i = 0; i < dataUrls.length; i++) {
        try {
          const dataUrl = dataUrls[i];
          const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
          if (!match) continue;
          const ext = match[1] === "jpeg" ? ".jpg" : `.${match[1]}`;
          const buffer = Buffer.from(match[2], "base64");
          if (buffer.length < 10240) continue;
          const filename = `${String(saved + 1).padStart(3, "0")}${ext}`;
          fs.writeFileSync(path.join(destPath, filename), buffer);
          saved++;
        } catch {
        }
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send("sniff:download-progress", {
            current: i + 1,
            total: dataUrls.length,
            downloaded: saved
          });
        }
      }
      if (saved === 0) {
        try {
          fs.rmdirSync(destPath);
        } catch {
        }
        return false;
      }
      return true;
    } catch (err) {
      console.error("sniff:saveDataUrlsToLibrary failed:", err);
      return false;
    }
  }
);
electron.ipcMain.handle(
  "sniff:saveGrab",
  async (_event, opts) => {
    try {
      const mainWin = getMainWin();
      const { mode, canvasDataUrls, networkUrls, libraryDir } = opts;
      const chapterName = opts.chapterName.trim() || `抓取_${Date.now()}`;
      const totalItems = canvasDataUrls.length + networkUrls.length;
      let destPath;
      if (mode === "series") {
        let seriesDir;
        if (opts.seriesPath && fs.existsSync(opts.seriesPath)) {
          seriesDir = opts.seriesPath;
        } else {
          const seriesName = (opts.seriesName || chapterName).trim();
          seriesDir = path.join(libraryDir, seriesName);
          if (!fs.existsSync(seriesDir)) {
            fs.mkdirSync(seriesDir, { recursive: true });
            fs.writeFileSync(path.join(seriesDir, ".manga-series"), "", "utf-8");
          }
        }
        destPath = path.join(seriesDir, chapterName);
        if (fs.existsSync(destPath)) {
          destPath = path.join(seriesDir, `${chapterName}_${Date.now()}`);
        }
        fs.mkdirSync(destPath, { recursive: true });
      } else {
        destPath = path.join(libraryDir, chapterName);
        if (fs.existsSync(destPath)) {
          destPath = path.join(libraryDir, `${chapterName}_${Date.now()}`);
        }
        fs.mkdirSync(destPath, { recursive: true });
      }
      let saved = 0;
      let progress = 0;
      for (let i = 0; i < canvasDataUrls.length; i++) {
        progress++;
        try {
          const dataUrl = canvasDataUrls[i];
          const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
          if (!match) continue;
          const ext = match[1] === "jpeg" ? ".jpg" : `.${match[1]}`;
          const buffer = Buffer.from(match[2], "base64");
          if (buffer.length < 10240) continue;
          const filename = `${String(saved + 1).padStart(3, "0")}${ext}`;
          fs.writeFileSync(path.join(destPath, filename), buffer);
          saved++;
        } catch {
        }
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send("sniff:download-progress", {
            current: progress,
            total: totalItems,
            downloaded: saved
          });
        }
      }
      for (let i = 0; i < networkUrls.length; i++) {
        progress++;
        const url = networkUrls[i];
        let ext = ".jpg";
        try {
          const pathname = new URL(url).pathname.toLowerCase();
          const m = pathname.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?|$)/i);
          if (m) ext = `.${m[1]}`;
        } catch {
        }
        const filename = `${String(saved + 1).padStart(3, "0")}${ext}`;
        const ok = await downloadImage(url, path.join(destPath, filename));
        if (ok) saved++;
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send("sniff:download-progress", {
            current: progress,
            total: totalItems,
            downloaded: saved
          });
        }
      }
      if (saved === 0) {
        try {
          fs.rmdirSync(destPath);
        } catch {
        }
        return { ok: false, savedCount: 0 };
      }
      return { ok: true, savedCount: saved };
    } catch (err) {
      console.error("sniff:saveGrab failed:", err);
      return { ok: false, savedCount: 0 };
    }
  }
);
electron.ipcMain.handle(
  "sniff:getSeriesList",
  async (_event, libraryDir) => {
    try {
      if (!fs.existsSync(libraryDir)) return [];
      const entries = fs.readdirSync(libraryDir, { withFileTypes: true });
      const seriesList = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(libraryDir, entry.name);
        if (checkIsSeries(fullPath)) {
          const chapters = fs.readdirSync(fullPath, { withFileTypes: true }).filter((e) => e.isDirectory());
          seriesList.push({
            name: entry.name,
            path: fullPath,
            chapterCount: chapters.length
          });
        }
      }
      return seriesList.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    } catch (err) {
      console.error("sniff:getSeriesList failed:", err);
      return [];
    }
  }
);
async function getSessionCookies(url) {
  try {
    if (!sniffSession) return "";
    const cookies = await sniffSession.cookies.get({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return "";
  }
}
function downloadImage(imageUrl, destPath, retries = 3) {
  return new Promise((resolve) => {
    const doDownload = async (attempt) => {
      try {
        const urlObj = new URL(imageUrl);
        const getter = urlObj.protocol === "https:" ? https.get : http.get;
        const originalHeaders = sniffedRequestHeaders.get(imageUrl);
        const headers = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": originalHeaders?.["Referer"] || originalHeaders?.["referer"] || urlObj.origin,
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        };
        if (originalHeaders?.["Cookie"] || originalHeaders?.["cookie"]) {
          headers["Cookie"] = originalHeaders["Cookie"] || originalHeaders["cookie"];
        } else {
          const sessionCookie = await getSessionCookies(imageUrl);
          if (sessionCookie) headers["Cookie"] = sessionCookie;
        }
        if (originalHeaders?.["Origin"] || originalHeaders?.["origin"]) {
          headers["Origin"] = originalHeaders["Origin"] || originalHeaders["origin"];
        }
        const req = getter(imageUrl, { headers }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            downloadImage(res.headers.location, destPath, attempt).then(resolve);
            return;
          }
          if (!res.statusCode || res.statusCode >= 400) {
            if (attempt < retries) {
              setTimeout(() => doDownload(attempt + 1), 500 * attempt);
            } else {
              resolve(false);
            }
            return;
          }
          const file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve(true);
          });
          file.on("error", () => {
            if (attempt < retries) {
              setTimeout(() => doDownload(attempt + 1), 500 * attempt);
            } else {
              resolve(false);
            }
          });
        });
        req.on("error", () => {
          if (attempt < retries) {
            setTimeout(() => doDownload(attempt + 1), 500 * attempt);
          } else {
            resolve(false);
          }
        });
        req.setTimeout(3e4, () => {
          req.destroy();
          if (attempt < retries) {
            setTimeout(() => doDownload(attempt + 1), 500 * attempt);
          } else {
            resolve(false);
          }
        });
      } catch {
        resolve(false);
      }
    };
    doDownload(1);
  });
}
electron.ipcMain.handle(
  "sniff:saveToLibrary",
  async (_event, imageUrls, mangaTitle, libraryDir) => {
    try {
      const trimmed = mangaTitle.trim() || `抓取_${Date.now()}`;
      let destPath = path.join(libraryDir, trimmed);
      if (fs.existsSync(destPath)) {
        destPath = path.join(libraryDir, `${trimmed}_${Date.now()}`);
      }
      fs.mkdirSync(destPath, { recursive: true });
      const mainWin = getMainWin();
      let downloaded = 0;
      for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i];
        let ext = ".jpg";
        try {
          const pathname = new URL(url).pathname.toLowerCase();
          const match = pathname.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?|$)/i);
          if (match) ext = `.${match[1]}`;
        } catch {
        }
        const filename = `${String(i + 1).padStart(3, "0")}${ext}`;
        const ok = await downloadImage(url, path.join(destPath, filename));
        if (ok) downloaded++;
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send("sniff:download-progress", {
            current: i + 1,
            total: imageUrls.length,
            downloaded
          });
        }
      }
      return downloaded > 0;
    } catch (err) {
      console.error("sniff:saveToLibrary failed:", err);
      return false;
    }
  }
);
