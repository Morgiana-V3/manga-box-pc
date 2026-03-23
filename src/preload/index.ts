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

  // 在线抓取 / 嗅探
  sniffStart: (url: string): Promise<boolean> => ipcRenderer.invoke('sniff:start', url),
  sniffStop: (): Promise<void> => ipcRenderer.invoke('sniff:stop'),
  sniffTriggerLazy: (): Promise<number> => ipcRenderer.invoke('sniff:triggerLazy'),
  sniffTogglePreview: (visible: boolean): Promise<boolean> => ipcRenderer.invoke('sniff:togglePreview', visible),
  sniffIsPreviewVisible: (): Promise<boolean> => ipcRenderer.invoke('sniff:isPreviewVisible'),
  sniffFocusPreview: (): Promise<void> => ipcRenderer.invoke('sniff:focusPreview'),
  sniffCheckLogin: (url: string): Promise<{ hasCookies: boolean; cookieCount: number }> =>
    ipcRenderer.invoke('sniff:checkLogin', url),
  sniffClearCookies: (url?: string): Promise<boolean> => ipcRenderer.invoke('sniff:clearCookies', url),
  sniffGetImages: (): Promise<Array<{ url: string; size: number; contentType: string }>> =>
    ipcRenderer.invoke('sniff:getImages'),
  sniffExecuteJS: (code: string): Promise<unknown> => ipcRenderer.invoke('sniff:executeJS', code),
  sniffGetCurrentURL: (): Promise<string> => ipcRenderer.invoke('sniff:getCurrentURL'),
  sniffNavigate: (url: string): Promise<boolean> => ipcRenderer.invoke('sniff:navigate', url),
  sniffClearImages: (): Promise<void> => ipcRenderer.invoke('sniff:clearImages'),
  sniffAutoScroll: (): Promise<{ newNetworkImages: number; canvasDataUrls: string[] }> => ipcRenderer.invoke('sniff:autoScroll'),
  sniffCaptureCanvas: (): Promise<string[]> => ipcRenderer.invoke('sniff:captureCanvas'),
  sniffScrollAndCapture: (): Promise<string[]> => ipcRenderer.invoke('sniff:scrollAndCapture'),
  sniffSaveDataUrlsToLibrary: (dataUrls: string[], title: string, libraryDir: string): Promise<boolean> =>
    ipcRenderer.invoke('sniff:saveDataUrlsToLibrary', dataUrls, title, libraryDir),
  sniffSaveToLibrary: (imageUrls: string[], title: string, libraryDir: string): Promise<boolean> =>
    ipcRenderer.invoke('sniff:saveToLibrary', imageUrls, title, libraryDir),
  sniffSaveGrab: (opts: {
    mode: 'single' | 'series'
    seriesPath: string
    seriesName: string
    chapterName: string
    canvasDataUrls: string[]
    networkUrls: string[]
    libraryDir: string
  }): Promise<{ ok: boolean; savedCount: number }> =>
    ipcRenderer.invoke('sniff:saveGrab', opts),
  sniffGetSeriesList: (libraryDir: string): Promise<Array<{ name: string; path: string; chapterCount: number }>> =>
    ipcRenderer.invoke('sniff:getSeriesList', libraryDir),
  onSniffImageFound: (callback: (data: { url: string; size: number; contentType: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { url: string; size: number; contentType: string }): void => callback(data)
    ipcRenderer.on('sniff:image-found', handler)
    return () => ipcRenderer.removeListener('sniff:image-found', handler)
  },
  onSniffImageUpdated: (callback: (data: { url: string; size: number; contentType: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { url: string; size: number; contentType: string }): void => callback(data)
    ipcRenderer.on('sniff:image-updated', handler)
    return () => ipcRenderer.removeListener('sniff:image-updated', handler)
  },
  onSniffDownloadProgress: (callback: (data: { current: number; total: number; downloaded: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { current: number; total: number; downloaded: number }): void => callback(data)
    ipcRenderer.on('sniff:download-progress', handler)
    return () => ipcRenderer.removeListener('sniff:download-progress', handler)
  },
  onSniffWindowClosed: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('sniff:window-closed', handler)
    return () => ipcRenderer.removeListener('sniff:window-closed', handler)
  },
  onSniffUrlChanged: (callback: (url: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string): void => callback(url)
    ipcRenderer.on('sniff:url-changed', handler)
    return () => ipcRenderer.removeListener('sniff:url-changed', handler)
  },

  // 持久化存储
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  storeDelete: (key: string) => ipcRenderer.invoke('store:delete', key),

  // Shell
  openPath: (targetPath: string): Promise<void> => ipcRenderer.invoke('shell:openPath', targetPath)
})
