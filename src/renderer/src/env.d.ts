/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface Chapter {
  id: string
  title: string
  path: string
  cover: string | null
  pageCount: number
  index: number
}

interface Book {
  id: string
  title: string
  path: string
  type: 'folder' | 'archive'
  /** single = 单本（直接含图片），series = 系列（含子目录话数） */
  kind: 'single' | 'series'
  cover: string | null
  coverData?: string
  pageCount: number
  chapterCount?: number
  addedAt: number
}

interface ReadProgress {
  page: number
  total: number
  lastReadAt: number
}

/** 阅读器上下文，用于章节阅读（不在 library store 中的路径） */
interface ReaderContext {
  bookPath: string
  bookType: 'folder' | 'archive'
  title: string
  /** 所属系列 bookId，返回时导航到系列页 */
  seriesId?: string
  chapterIndex?: number
  totalChapters?: number
}

interface SeriesInfo {
  name: string
  path: string
  chapterCount: number
}

interface SniffedImage {
  url: string
  size: number
  contentType: string
}

interface DownloadProgress {
  current: number
  total: number
  downloaded: number
}

interface ElectronAPI {
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  openFolder: () => Promise<string | null>
  openArchive: () => Promise<string[]>
  openFileOrFolder: () => Promise<string[]>
  getDefaultLibraryDir: () => Promise<string>
  importBook: (sourcePath: string, destDir: string) => Promise<boolean>
  removeBook: (bookPath: string) => Promise<boolean>
  deletePages: (bookPath: string, pageKeys: string[]) => Promise<boolean>
  createSeries: (libraryDir: string, seriesName: string) => Promise<boolean>
  scanLibrary: (folderPath: string) => Promise<Book[]>
  getPages: (bookPath: string, bookType: 'folder' | 'archive') => Promise<string[]>
  getChapters: (seriesPath: string) => Promise<Chapter[]>
  renamePages: (bookPath: string, filenames: string[]) => Promise<boolean>
  reorderChapters: (seriesPath: string, chapterNames: string[]) => Promise<boolean>
  renameBook: (bookPath: string, newTitle: string) => Promise<string | null>
  // 在线抓取 / 嗅探
  sniffStart: (url: string) => Promise<boolean>
  sniffStop: () => Promise<void>
  sniffGetImages: () => Promise<SniffedImage[]>
  sniffExecuteJS: (code: string) => Promise<unknown>
  sniffGetCurrentURL: () => Promise<string>
  sniffNavigate: (url: string) => Promise<boolean>
  sniffClearImages: () => Promise<void>
  sniffAutoScroll: () => Promise<number>
  sniffCaptureCanvas: () => Promise<string[]>
  sniffScrollAndCapture: () => Promise<string[]>
  sniffSaveDataUrlsToLibrary: (dataUrls: string[], title: string, libraryDir: string) => Promise<boolean>
  sniffSaveToLibrary: (imageUrls: string[], title: string, libraryDir: string) => Promise<boolean>
  sniffSaveGrab: (opts: {
    mode: 'single' | 'series'
    seriesPath: string
    seriesName: string
    chapterName: string
    canvasDataUrls: string[]
    networkUrls: string[]
    libraryDir: string
  }) => Promise<{ ok: boolean; savedCount: number }>
  sniffGetSeriesList: (libraryDir: string) => Promise<SeriesInfo[]>
  onSniffImageFound: (callback: (data: SniffedImage) => void) => () => void
  onSniffDownloadProgress: (callback: (data: DownloadProgress) => void) => () => void
  // 持久化存储
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  storeDelete: (key: string) => Promise<void>
  openPath: (targetPath: string) => Promise<void>
}

interface Window {
  electronAPI: ElectronAPI
}
