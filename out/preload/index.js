"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  // 窗口控制
  minimizeWindow: () => electron.ipcRenderer.send("window-minimize"),
  maximizeWindow: () => electron.ipcRenderer.send("window-maximize"),
  closeWindow: () => electron.ipcRenderer.send("window-close"),
  // 对话框
  openFolder: () => electron.ipcRenderer.invoke("dialog:openFolder"),
  openArchive: () => electron.ipcRenderer.invoke("dialog:openArchive"),
  openFileOrFolder: () => electron.ipcRenderer.invoke("dialog:openFileOrFolder"),
  // 漫画库管理
  getDefaultLibraryDir: () => electron.ipcRenderer.invoke("fs:getDefaultLibraryDir"),
  importBook: (sourcePath, destDir) => electron.ipcRenderer.invoke("fs:importBook", sourcePath, destDir),
  removeBook: (bookPath) => electron.ipcRenderer.invoke("fs:removeBook", bookPath),
  deletePages: (bookPath, pageKeys) => electron.ipcRenderer.invoke("fs:deletePages", bookPath, pageKeys),
  createSeries: (libraryDir, seriesName) => electron.ipcRenderer.invoke("fs:createSeries", libraryDir, seriesName),
  // 文件系统
  scanLibrary: (folderPath) => electron.ipcRenderer.invoke("fs:scanLibrary", folderPath),
  getPages: (bookPath, bookType) => electron.ipcRenderer.invoke("fs:getPages", bookPath, bookType),
  getChapters: (seriesPath) => electron.ipcRenderer.invoke("fs:getChapters", seriesPath),
  // 编辑操作
  renamePages: (bookPath, filenames) => electron.ipcRenderer.invoke("fs:renamePages", bookPath, filenames),
  reorderChapters: (seriesPath, chapterNames) => electron.ipcRenderer.invoke("fs:reorderChapters", seriesPath, chapterNames),
  renameBook: (bookPath, newTitle) => electron.ipcRenderer.invoke("fs:renameBook", bookPath, newTitle),
  // 在线抓取 / 嗅探
  sniffStart: (url) => electron.ipcRenderer.invoke("sniff:start", url),
  sniffStop: () => electron.ipcRenderer.invoke("sniff:stop"),
  sniffTriggerLazy: () => electron.ipcRenderer.invoke("sniff:triggerLazy"),
  sniffTogglePreview: (visible) => electron.ipcRenderer.invoke("sniff:togglePreview", visible),
  sniffIsPreviewVisible: () => electron.ipcRenderer.invoke("sniff:isPreviewVisible"),
  sniffFocusPreview: () => electron.ipcRenderer.invoke("sniff:focusPreview"),
  sniffCheckLogin: (url) => electron.ipcRenderer.invoke("sniff:checkLogin", url),
  sniffClearCookies: (url) => electron.ipcRenderer.invoke("sniff:clearCookies", url),
  sniffGetImages: () => electron.ipcRenderer.invoke("sniff:getImages"),
  sniffExecuteJS: (code) => electron.ipcRenderer.invoke("sniff:executeJS", code),
  sniffGetCurrentURL: () => electron.ipcRenderer.invoke("sniff:getCurrentURL"),
  sniffNavigate: (url) => electron.ipcRenderer.invoke("sniff:navigate", url),
  sniffClearImages: () => electron.ipcRenderer.invoke("sniff:clearImages"),
  sniffAutoScroll: () => electron.ipcRenderer.invoke("sniff:autoScroll"),
  sniffCaptureCanvas: () => electron.ipcRenderer.invoke("sniff:captureCanvas"),
  sniffScrollAndCapture: () => electron.ipcRenderer.invoke("sniff:scrollAndCapture"),
  sniffSaveDataUrlsToLibrary: (dataUrls, title, libraryDir) => electron.ipcRenderer.invoke("sniff:saveDataUrlsToLibrary", dataUrls, title, libraryDir),
  sniffSaveToLibrary: (imageUrls, title, libraryDir) => electron.ipcRenderer.invoke("sniff:saveToLibrary", imageUrls, title, libraryDir),
  sniffSaveGrab: (opts) => electron.ipcRenderer.invoke("sniff:saveGrab", opts),
  sniffGetSeriesList: (libraryDir) => electron.ipcRenderer.invoke("sniff:getSeriesList", libraryDir),
  onSniffImageFound: (callback) => {
    const handler = (_event, data) => callback(data);
    electron.ipcRenderer.on("sniff:image-found", handler);
    return () => electron.ipcRenderer.removeListener("sniff:image-found", handler);
  },
  onSniffImageUpdated: (callback) => {
    const handler = (_event, data) => callback(data);
    electron.ipcRenderer.on("sniff:image-updated", handler);
    return () => electron.ipcRenderer.removeListener("sniff:image-updated", handler);
  },
  onSniffDownloadProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    electron.ipcRenderer.on("sniff:download-progress", handler);
    return () => electron.ipcRenderer.removeListener("sniff:download-progress", handler);
  },
  onSniffWindowClosed: (callback) => {
    const handler = () => callback();
    electron.ipcRenderer.on("sniff:window-closed", handler);
    return () => electron.ipcRenderer.removeListener("sniff:window-closed", handler);
  },
  onSniffUrlChanged: (callback) => {
    const handler = (_event, url) => callback(url);
    electron.ipcRenderer.on("sniff:url-changed", handler);
    return () => electron.ipcRenderer.removeListener("sniff:url-changed", handler);
  },
  // 持久化存储
  storeGet: (key) => electron.ipcRenderer.invoke("store:get", key),
  storeSet: (key, value) => electron.ipcRenderer.invoke("store:set", key, value),
  storeDelete: (key) => electron.ipcRenderer.invoke("store:delete", key),
  // Shell
  openPath: (targetPath) => electron.ipcRenderer.invoke("shell:openPath", targetPath)
});
