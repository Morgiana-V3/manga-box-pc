import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimizeWindow: (): void => ipcRenderer.send('window-minimize'),
  maximizeWindow: (): void => ipcRenderer.send('window-maximize'),
  closeWindow: (): void => ipcRenderer.send('window-close'),

  // 对话框
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  openArchive: (): Promise<string[]> => ipcRenderer.invoke('dialog:openArchive'),
  openFileOrFolder: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFileOrFolder'),

  // 漫画库管理
  getDefaultLibraryDir: (): Promise<string> => ipcRenderer.invoke('fs:getDefaultLibraryDir'),
  importBook: (sourcePath: string, destDir: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:importBook', sourcePath, destDir),
  removeBook: (bookPath: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:removeBook', bookPath),
  deletePages: (bookPath: string, pageKeys: string[]): Promise<boolean> =>
    ipcRenderer.invoke('fs:deletePages', bookPath, pageKeys),
  createSeries: (libraryDir: string, seriesName: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:createSeries', libraryDir, seriesName),

  // 文件系统
  scanLibrary: (folderPath: string) => ipcRenderer.invoke('fs:scanLibrary', folderPath),
  getPages: (bookPath: string, bookType: 'folder' | 'archive') =>
    ipcRenderer.invoke('fs:getPages', bookPath, bookType),
  getChapters: (seriesPath: string) => ipcRenderer.invoke('fs:getChapters', seriesPath),

  // 编辑操作
  renamePages: (bookPath: string, filenames: string[]): Promise<boolean> =>
    ipcRenderer.invoke('fs:renamePages', bookPath, filenames),
  reorderChapters: (seriesPath: string, chapterNames: string[]): Promise<boolean> =>
    ipcRenderer.invoke('fs:reorderChapters', seriesPath, chapterNames),
  renameBook: (bookPath: string, newTitle: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:renameBook', bookPath, newTitle),

  // 持久化存储
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  storeDelete: (key: string) => ipcRenderer.invoke('store:delete', key),

  // Shell
  openPath: (targetPath: string): Promise<void> => ipcRenderer.invoke('shell:openPath', targetPath)
})
