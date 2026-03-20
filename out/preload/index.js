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
  createSeries: (libraryDir, seriesName) => electron.ipcRenderer.invoke("fs:createSeries", libraryDir, seriesName),
  // 文件系统
  scanLibrary: (folderPath) => electron.ipcRenderer.invoke("fs:scanLibrary", folderPath),
  getPages: (bookPath, bookType) => electron.ipcRenderer.invoke("fs:getPages", bookPath, bookType),
  getChapters: (seriesPath) => electron.ipcRenderer.invoke("fs:getChapters", seriesPath),
  // 编辑操作
  renamePages: (bookPath, filenames) => electron.ipcRenderer.invoke("fs:renamePages", bookPath, filenames),
  reorderChapters: (seriesPath, chapterNames) => electron.ipcRenderer.invoke("fs:reorderChapters", seriesPath, chapterNames),
  renameBook: (bookPath, newTitle) => electron.ipcRenderer.invoke("fs:renameBook", bookPath, newTitle),
  // 持久化存储
  storeGet: (key) => electron.ipcRenderer.invoke("store:get", key),
  storeSet: (key, value) => electron.ipcRenderer.invoke("store:set", key, value),
  storeDelete: (key) => electron.ipcRenderer.invoke("store:delete", key),
  // Shell
  openPath: (targetPath) => electron.ipcRenderer.invoke("shell:openPath", targetPath)
});
