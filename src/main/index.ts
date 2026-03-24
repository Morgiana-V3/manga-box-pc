import { app, BrowserWindow, ipcMain, dialog, protocol, shell, session } from 'electron'
import { join, basename, extname, dirname } from 'path'
import {
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  cpSync,
  copyFileSync,
  renameSync,
  readFileSync,
  writeFileSync,
  rmdirSync
} from 'fs'
import { get as httpsGet } from 'https'
import { get as httpGet } from 'http'
import Store from 'electron-store'
import AdmZip from 'adm-zip'

interface Book {
  id: string
  title: string
  path: string
  type: 'folder' | 'archive'
  kind: 'single' | 'series'
  cover: string | null
  coverData?: string
  pageCount: number
  chapterCount?: number
  addedAt: number
}

interface Chapter {
  id: string
  title: string
  path: string
  cover: string | null
  pageCount: number
  index: number
}

const store = new Store()
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']
const ARCHIVE_EXTS = ['.zip', '.cbz', '.cbr']
let DEFAULT_LIBRARY_DIR = ''

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1a1a2e',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ★ 应用级别忽略 SSL 证书错误（很多漫画站证书有问题）
app.commandLine.appendSwitch('ignore-certificate-errors')

app.whenReady().then(() => {
  DEFAULT_LIBRARY_DIR = join(app.getPath('userData'), 'manga-library')
  mkdirSync(DEFAULT_LIBRARY_DIR, { recursive: true })

  protocol.registerFileProtocol('manga-file', (request, callback) => {
    const raw = request.url.replace('manga-file://', '')
    const noQuery = raw.split('?')[0].split('#')[0]
    const filePath = decodeURIComponent(noQuery)
    callback({ path: filePath })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ============ 工具函数 ============

function getExt(filename: string): string {
  const idx = filename.lastIndexOf('.')
  if (idx === -1) return ''
  return filename.slice(idx).toLowerCase()
}

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function imagePathToDataUrl(filePath: string): string | undefined {
  try {
    const ext = getExt(filePath)
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.bmp'
              ? 'image/bmp'
              : 'image/jpeg'
    const data = readFileSync(filePath).toString('base64')
    return `data:${mime};base64,${data}`
  } catch {
    return undefined
  }
}

/**
 * 读取系列目录的章节排序文件（.manga-order）
 * 返回 null 表示不存在，使用自然排序兜底
 */
function readChapterOrder(seriesPath: string): string[] | null {
  const orderFile = join(seriesPath, '.manga-order')
  if (!existsSync(orderFile)) return null
  try {
    return JSON.parse(readFileSync(orderFile, 'utf-8')) as string[]
  } catch {
    return null
  }
}

/**
 * 按 .manga-order 对章节目录名排序，没有排序文件则自然排序
 * order 文件中不存在的目录（新增章节）附加到末尾
 */
function sortChapterDirs(seriesPath: string, dirNames: string[]): string[] {
  const order = readChapterOrder(seriesPath)
  if (!order) return [...dirNames].sort(naturalSort)

  const dirSet = new Set(dirNames)
  const validOrder = order.filter((n) => dirSet.has(n))  // 只保留实际存在的
  const inOrder = new Set(validOrder)
  const unordered = dirNames.filter((n) => !inOrder.has(n)).sort(naturalSort) // 新增章节追加末尾
  return [...validOrder, ...unordered]
}

/** 判断文件夹是否为系列（包含子目录 或 存在 .manga-series 标记文件） */
function checkIsSeries(folderPath: string): boolean {
  try {
    if (existsSync(join(folderPath, '.manga-series'))) return true
    return readdirSync(folderPath, { withFileTypes: true }).some((e) => e.isDirectory())
  } catch {
    return false
  }
}

/**
 * 将文件夹内图片按自然排序重命名为 001.ext, 002.ext, ...
 * 如果有子目录（系列），递归处理每个子目录
 */
function autoRenameImages(folderPath: string): void {
  const entries = readdirSync(folderPath, { withFileTypes: true })
  const hasSubs = entries.some((e) => e.isDirectory())

  if (hasSubs) {
    // 系列：只递归处理子目录
    for (const entry of entries) {
      if (entry.isDirectory()) {
        autoRenameImages(join(folderPath, entry.name))
      }
    }
  } else {
    // 单本：重命名本目录的图片
    const images = entries
      .filter((e) => e.isFile() && IMAGE_EXTS.includes(getExt(e.name)))
      .map((e) => e.name)
      .sort(naturalSort)

    if (images.length === 0) return

    // 第一步：改为临时名，避免 001→002、002→001 这类冲突
    const tmpMaps: Array<{ tmp: string; ext: string }> = []
    for (let i = 0; i < images.length; i++) {
      const ext = getExt(images[i])
      const tmpName = `_tmp_${i}${ext}`
      renameSync(join(folderPath, images[i]), join(folderPath, tmpName))
      tmpMaps.push({ tmp: tmpName, ext })
    }
    // 第二步：改为最终顺序名
    for (let i = 0; i < tmpMaps.length; i++) {
      const finalName = `${String(i + 1).padStart(3, '0')}${tmpMaps[i].ext}`
      renameSync(join(folderPath, tmpMaps[i].tmp), join(folderPath, finalName))
    }
  }
}

// ============ IPC 处理 ============

ipcMain.on('window-minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
ipcMain.on('window-maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (win?.isMaximized()) win.unmaximize()
  else win?.maximize()
})
ipcMain.on('window-close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())

ipcMain.handle('dialog:openFolder', async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:openArchive', async (): Promise<string[]> => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'Comic Archives', extensions: ['zip', 'cbz', 'cbr'] }],
    properties: ['openFile', 'multiSelections']
  })
  if (result.canceled || !result.filePaths.length) return []
  return result.filePaths
})

/** 统一的文件/文件夹选择对话框，可同时选择文件夹和压缩包 */
ipcMain.handle('dialog:openFileOrFolder', async (): Promise<string[]> => {
  const result = await dialog.showOpenDialog({
    title: '选择漫画文件夹或压缩包',
    filters: [{ name: 'Comic Archives', extensions: ['zip', 'cbz', 'cbr'] }],
    properties: ['openFile', 'openDirectory', 'multiSelections']
  })
  if (result.canceled || !result.filePaths.length) return []
  return result.filePaths
})

ipcMain.handle('fs:getDefaultLibraryDir', () => DEFAULT_LIBRARY_DIR)

/** 导入漫画：文件夹直接复制，压缩包自动解压为文件夹，统一以目录方式存储 */
ipcMain.handle(
  'fs:importBook',
  async (_event, sourcePath: string, destDir: string): Promise<boolean> => {
    if (!existsSync(sourcePath)) return false

    mkdirSync(destDir, { recursive: true })

    const name = basename(sourcePath)
    const ext = extname(name).toLowerCase()
    const base = basename(name, extname(name))

    try {
      const stat = statSync(sourcePath)

      if (stat.isDirectory()) {
        // 文件夹：直接复制
        let destPath = join(destDir, name)
        if (existsSync(destPath)) {
          destPath = join(destDir, `${base}_${Date.now()}`)
        }
        cpSync(sourcePath, destPath, { recursive: true })
        autoRenameImages(destPath)
      } else if (ARCHIVE_EXTS.includes(ext)) {
        // 压缩包：解压为同名文件夹
        let destPath = join(destDir, base)
        if (existsSync(destPath)) {
          destPath = join(destDir, `${base}_${Date.now()}`)
        }
        mkdirSync(destPath, { recursive: true })

        const zip = new AdmZip(sourcePath)
        zip.extractAllTo(destPath, true)

        // 解压后可能有一层多余的根目录（如 zip 里只有一个目录），做扁平化处理
        const extracted = readdirSync(destPath, { withFileTypes: true })
        if (extracted.length === 1 && extracted[0].isDirectory()) {
          // 只有一个子目录，把内容提升一级
          const innerDir = join(destPath, extracted[0].name)
          const innerEntries = readdirSync(innerDir)
          for (const ie of innerEntries) {
            renameSync(join(innerDir, ie), join(destPath, ie))
          }
          // 删除空的内层目录
          try { rmdirSync(innerDir) } catch { /* ignore */ }
        }

        autoRenameImages(destPath)
      } else {
        // 其他文件：直接复制（兜底）
        let destPath = join(destDir, name)
        if (existsSync(destPath)) {
          destPath = join(destDir, `${base}_${Date.now()}${ext}`)
        }
        copyFileSync(sourcePath, destPath)
      }
      return true
    } catch (err) {
      console.error('importBook failed:', sourcePath, err)
      return false
    }
  }
)

/** 删除漫画（移入回收站） */
ipcMain.handle('fs:removeBook', async (_event, bookPath: string): Promise<boolean> => {
  try {
    if (!existsSync(bookPath)) return true
    await shell.trashItem(bookPath)
    return true
  } catch (err) {
    console.error('removeBook failed:', bookPath, err)
    return false
  }
})

/** 在书库中创建空系列目录（带 .manga-series 标记文件） */
ipcMain.handle(
  'fs:createSeries',
  async (_event, libraryDir: string, seriesName: string): Promise<boolean> => {
    try {
      const trimmed = seriesName.trim()
      if (!trimmed) return false

      let destPath = join(libraryDir, trimmed)
      if (existsSync(destPath)) {
        destPath = join(libraryDir, `${trimmed}_${Date.now()}`)
      }

      mkdirSync(destPath, { recursive: true })
      writeFileSync(join(destPath, '.manga-series'), '', 'utf-8')
      return true
    } catch (err) {
      console.error('createSeries failed:', err)
      return false
    }
  }
)

/** 扫描书库，自动识别单本 vs 系列 */
ipcMain.handle('fs:scanLibrary', async (_event, folderPath: string): Promise<Book[]> => {
  if (!existsSync(folderPath)) return []
  const entries = readdirSync(folderPath, { withFileTypes: true })
  const books: Book[] = []

  for (const entry of entries) {
    const fullPath = join(folderPath, entry.name)

    if (entry.isDirectory()) {
      const subEntries = readdirSync(fullPath, { withFileTypes: true })
      const hasSubs = subEntries.some((e) => e.isDirectory())
      const hasSeriesMarker = existsSync(join(fullPath, '.manga-series'))

      if (hasSubs || hasSeriesMarker) {
        // ── 系列：子目录 = 话数，按 .manga-order 文件排序（如有），否则自然排序 ──
        const chapterDirNames = subEntries
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
        const sortedChapterNames = sortChapterDirs(fullPath, chapterDirNames)

        let totalPages = 0
        let cover: string | null = null

        for (const chName of sortedChapterNames) {
          const chPath = join(fullPath, chName)
          const imgs = readdirSync(chPath)
            .filter((f) => IMAGE_EXTS.includes(getExt(f)))
            .sort(naturalSort)
          totalPages += imgs.length
          if (!cover && imgs.length > 0) cover = join(chPath, imgs[0])
        }

        books.push({
          id: btoa(encodeURIComponent(fullPath)),
          title: entry.name,
          path: fullPath,
          type: 'folder',
          kind: 'series',
          cover,
          coverData: cover ? imagePathToDataUrl(cover) : undefined,
          pageCount: totalPages,
          chapterCount: sortedChapterNames.length,
          addedAt: statSync(fullPath).mtimeMs
        })
      } else {
        // ── 单本：直接含图片 ──
        const images = subEntries
          .filter((e) => e.isFile() && IMAGE_EXTS.includes(getExt(e.name)))
          .map((e) => e.name)
          .sort(naturalSort)

        if (images.length > 0) {
          books.push({
            id: btoa(encodeURIComponent(fullPath)),
            title: entry.name,
            path: fullPath,
            type: 'folder',
            kind: 'single',
            cover: join(fullPath, images[0]),
            coverData: imagePathToDataUrl(join(fullPath, images[0])),
            pageCount: images.length,
            addedAt: statSync(fullPath).mtimeMs
          })
        }
      }
    } else if (ARCHIVE_EXTS.includes(getExt(entry.name))) {
      try {
        const zip = new AdmZip(fullPath)
        const pages = zip
          .getEntries()
          .filter((e) => IMAGE_EXTS.includes(getExt(e.entryName)) && !e.isDirectory)
          .sort((a, b) => naturalSort(a.entryName, b.entryName))
        if (pages.length > 0) {
          books.push({
            id: btoa(encodeURIComponent(fullPath)),
            title: entry.name.replace(/\.[^.]+$/, ''),
            path: fullPath,
            type: 'archive',
            kind: 'single',
            cover: null,
            coverData: `data:image/jpeg;base64,${pages[0].getData().toString('base64')}`,
            pageCount: pages.length,
            addedAt: statSync(fullPath).mtimeMs
          })
        }
      } catch (err) {
        console.error('Failed to read archive:', fullPath, err)
      }
    }
  }

  return books.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
})

ipcMain.handle(
  'fs:getPages',
  async (_event, bookPath: string, bookType: 'folder' | 'archive'): Promise<string[]> => {
    if (bookType === 'folder') {
      const files = readdirSync(bookPath)
        .filter((f) => IMAGE_EXTS.includes(getExt(f)))
        .sort(naturalSort)
      return files.map((f) => {
        const abs = join(bookPath, f)
        const st = statSync(abs)
        const ver = `${Math.trunc(st.mtimeMs)}-${Math.trunc(st.ctimeMs)}`
        return `manga-file://${encodeURIComponent(abs)}?v=${ver}`
      })
    } else {
      const zip = new AdmZip(bookPath)
      const pages = zip
        .getEntries()
        .filter((e) => IMAGE_EXTS.includes(getExt(e.entryName)) && !e.isDirectory)
        .sort((a, b) => naturalSort(a.entryName, b.entryName))
      return pages.map((e) => {
        const data = e.getData().toString('base64')
        const mime = getExt(e.entryName) === '.png' ? 'image/png' : 'image/jpeg'
        return `data:${mime};base64,${data}`
      })
    }
  }
)

/** 获取系列的所有章节，按 .manga-order 排序（如有），否则自然排序 */
ipcMain.handle('fs:getChapters', async (_event, seriesPath: string): Promise<Chapter[]> => {
  if (!existsSync(seriesPath)) return []
  const dirNames = readdirSync(seriesPath, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  const sortedNames = sortChapterDirs(seriesPath, dirNames)

  const chapters: Chapter[] = []
  for (let i = 0; i < sortedNames.length; i++) {
    const chPath = join(seriesPath, sortedNames[i])
    const imgs = readdirSync(chPath)
      .filter((f) => IMAGE_EXTS.includes(getExt(f)))
      .sort(naturalSort)
    if (imgs.length > 0) {
      chapters.push({
        id: btoa(encodeURIComponent(chPath)),
        title: sortedNames[i],
        path: chPath,
        cover: join(chPath, imgs[0]),
        pageCount: imgs.length,
        index: i
      })
    }
  }
  return chapters
})

/**
 * 保存系列章节顺序：将新顺序写入 .manga-order 文件
 * chapterNames: 子目录名称，按用户期望的新顺序排列
 * 不重命名任何目录，顺序完全由文件决定，下次读取自动还原
 */
ipcMain.handle(
  'fs:reorderChapters',
  async (_event, seriesPath: string, chapterNames: string[]): Promise<boolean> => {
    try {
      const orderFile = join(seriesPath, '.manga-order')
      writeFileSync(orderFile, JSON.stringify(chapterNames, null, 2), 'utf-8')
      return true
    } catch (err) {
      console.error('reorderChapters failed:', err)
      return false
    }
  }
)

/**
 * 删除单话中的指定页面文件（移入回收站）
 * pageKeys: 要删除的文件名数组
 */
ipcMain.handle(
  'fs:deletePages',
  async (_event, bookPath: string, pageKeys: string[]): Promise<boolean> => {
    try {
      for (const key of pageKeys) {
        const filePath = join(bookPath, key)
        if (existsSync(filePath)) {
          await shell.trashItem(filePath)
        }
      }
      return true
    } catch (err) {
      console.error('deletePages failed:', err)
      return false
    }
  }
)

/**
 * 按新顺序重命名图片文件（用于单本编辑）
 * filenames: 当前图片文件名，按新的期望顺序传入
 */
ipcMain.handle(
  'fs:renamePages',
  async (_event, bookPath: string, filenames: string[]): Promise<boolean> => {
    try {
      const diskImages = readdirSync(bookPath)
        .filter((f) => IMAGE_EXTS.includes(getExt(f)))
      const lowerMap = new Map(diskImages.map((n) => [n.toLowerCase(), n]))

      const normalize = (val: string): string => {
        const noQuery = val.split('?')[0].split('#')[0]
        const noProto = noQuery.startsWith('manga-file://') ? noQuery.replace('manga-file://', '') : noQuery
        const decoded = decodeURIComponent(noProto)
        const name = basename(decoded.replace(/\\/g, '/'))
        return name
      }

      const orderedNames: string[] = []
      for (const raw of filenames) {
        const wanted = normalize(raw)
        if (diskImages.includes(wanted)) {
          orderedNames.push(wanted)
          continue
        }
        const matched = lowerMap.get(wanted.toLowerCase())
        if (!matched) {
          console.error('renamePages failed: source file not found', { bookPath, raw, wanted })
          return false
        }
        orderedNames.push(matched)
      }

      if (orderedNames.length !== diskImages.length) {
        console.error('renamePages failed: page count mismatch', {
          bookPath,
          ordered: orderedNames.length,
          disk: diskImages.length
        })
        return false
      }

      const tmpMaps: Array<{ tmp: string; ext: string }> = []
      for (let i = 0; i < orderedNames.length; i++) {
        const ext = getExt(orderedNames[i])
        const tmpName = `_rename_tmp_${i}${ext}`
        renameSync(join(bookPath, orderedNames[i]), join(bookPath, tmpName))
        tmpMaps.push({ tmp: tmpName, ext })
      }
      for (let i = 0; i < tmpMaps.length; i++) {
        const finalName = `${String(i + 1).padStart(3, '0')}${tmpMaps[i].ext}`
        renameSync(join(bookPath, tmpMaps[i].tmp), join(bookPath, finalName))
      }
      // 文件名会重新变成 001/002...，URL 不变，清理会话缓存避免旧缩略图残留
      await Promise.all(
        BrowserWindow.getAllWindows().map((w) => w.webContents.session.clearCache())
      )
      return true
    } catch (err) {
      console.error('renamePages failed:', err)
      return false
    }
  }
)

/** 重命名书/章节目录，如父目录有 .manga-order 文件则同步更新 */
ipcMain.handle(
  'fs:renameBook',
  async (_event, bookPath: string, newTitle: string): Promise<string | null> => {
    try {
      const parent = dirname(bookPath)
      const oldName = basename(bookPath)
      const newPath = join(parent, newTitle)
      if (existsSync(newPath) && newPath !== bookPath) return null
      if (newPath !== bookPath) {
        renameSync(bookPath, newPath)
        // 如果父目录有章节顺序文件，把旧目录名替换为新名
        const orderFile = join(parent, '.manga-order')
        if (existsSync(orderFile)) {
          try {
            const order = JSON.parse(readFileSync(orderFile, 'utf-8')) as string[]
            const updated = order.map((n) => (n === oldName ? newTitle : n))
            writeFileSync(orderFile, JSON.stringify(updated, null, 2), 'utf-8')
          } catch {
            // 顺序文件损坏则忽略，不影响主流程
          }
        }
      }
      return newPath
    } catch (err) {
      console.error('renameBook failed:', err)
      return null
    }
  }
)

ipcMain.handle('store:get', (_event, key: string) => store.get(key))
ipcMain.handle('store:set', (_event, key: string, value: unknown) => store.set(key, value))
ipcMain.handle('store:delete', (_event, key: string) => store.delete(key))

ipcMain.handle('shell:openPath', async (_event, targetPath: string): Promise<void> => {
  await shell.openPath(targetPath)
})

// ============ 在线抓取 / 图片嗅探（CDP 方案） ============

/** 嗅探窗口状态 */
let sniffWin: BrowserWindow | null = null
/** 嗅探窗口是否可见（预览模式） */
let sniffWinVisible = true
const sniffedImages: Map<string, { url: string; size: number; contentType: string }> = new Map()
/** 每个请求的原始请求头（用于下载时透传 Cookie/Referer） */
const sniffedRequestHeaders: Map<string, Record<string, string>> = new Map()
let sniffSession: Electron.Session | null = null
/** CDP debugger 是否已附加 */
let cdpAttached = false
/** 当前进行中的网络请求数（用于网络空闲检测） */
let pendingRequests = 0
/** 最后一次网络活动时间 */
let lastNetworkActivityTime = 0

/** 图片 MIME 类型 */
const IMAGE_MIMES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp',
  'image/avif', 'image/svg+xml'
]

/** 图片后缀 */
const IMG_URL_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']

/** 可能是图片的二进制 MIME 类型 */
const BINARY_MIMES = ['application/octet-stream', 'binary/octet-stream']

/** 判断 URL 或 Content-Type 是否为图片 */
function isImageResource(url: string, contentType?: string): boolean {
  if (contentType) {
    const lower = contentType.toLowerCase()
    if (IMAGE_MIMES.some((m) => lower.includes(m))) return true
    if (BINARY_MIMES.some((m) => lower.includes(m))) {
      return hasImageExt(url)
    }
  }
  return hasImageExt(url)
}

function hasImageExt(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    return IMG_URL_EXTS.some((ext) => pathname.endsWith(ext) || pathname.includes(ext + '?'))
  } catch {
    return false
  }
}

/** 获取渲染进程主窗口（排除嗅探预览窗口） */
function getMainWin(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => w !== sniffWin) ?? null
}

/** 等待网络空闲：连续 quietMs 毫秒内无新请求且无进行中请求 */
function waitForNetworkIdle(quietMs = 2000, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve) => {
    const startTime = Date.now()

    const check = (): void => {
      const now = Date.now()
      // 超时强制返回
      if (now - startTime > timeoutMs) {
        resolve()
        return
      }
      // 无进行中请求 且 距上次网络活动已过 quietMs
      if (pendingRequests <= 0 && (now - lastNetworkActivityTime) >= quietMs) {
        resolve()
        return
      }
      setTimeout(check, 300)
    }
    // 给一个最小的初始等待
    setTimeout(check, Math.min(quietMs, 500))
  })
}

/** 附加 CDP debugger 到嗅探窗口，开始监听网络 */
function attachCDP(): void {
  if (!sniffWin || sniffWin.isDestroyed() || cdpAttached) return

  const dbg = sniffWin.webContents.debugger
  try {
    dbg.attach('1.3')
    cdpAttached = true
  } catch (err) {
    console.error('CDP attach failed:', err)
    return
  }

  // 启用 Network 域
  dbg.sendCommand('Network.enable', {
    maxPostDataSize: 0, // 不需要 POST body
    maxTotalBufferSize: 0
  }).catch(() => {})

  // ★ 禁用浏览器缓存：确保所有请求走网络，CDP 才能捕获完整的响应信息
  // 这对于手动滚动/翻页后新出现的图片至关重要
  dbg.sendCommand('Network.setCacheDisabled', {
    cacheDisabled: true
  }).catch(() => {})

  // ★ 注入反自动化检测脚本（在所有页面 JS 执行之前运行）
  // Page.addScriptToEvaluateOnNewDocument 在页面初始化时、任何脚本执行前注入
  // 这比 dom-ready 或 did-finish-load 早得多，Cloudflare 的 JS 检测看到的是修改后的值
  dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      // 1. 删除 navigator.webdriver（Electron/自动化工具标志）
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // 2. 伪造 navigator.plugins（真实 Chrome 至少有 PDF 插件）
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const p = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 0 }
          ];
          p.refresh = () => {};
          Object.setPrototypeOf(p, PluginArray.prototype);
          return p;
        }
      });

      // 3. 确保 navigator.languages 正常
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });

      // 4. 完整的 window.chrome 对象（Cloudflare 重点检测项）
      if (!window.chrome) window.chrome = {};
      if (!window.chrome.runtime) {
        window.chrome.runtime = {
          connect: function(){}, sendMessage: function(){},
          onMessage: { addListener: function(){}, removeListener: function(){} }
        };
      }
      if (!window.chrome.app) {
        window.chrome.app = { isInstalled: false,
          InstallState: { DISABLED:'disabled', INSTALLED:'installed', NOT_INSTALLED:'not_installed' },
          RunningState: { CANNOT_RUN:'cannot_run', READY_TO_RUN:'ready_to_run', RUNNING:'running' }
        };
      }
      if (!window.chrome.csi) window.chrome.csi = function(){ return {}; };
      if (!window.chrome.loadTimes) window.chrome.loadTimes = function(){ return {}; };

      // 5. 修复 Permissions API（Electron 中异常）
      try {
        const origQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
        window.navigator.permissions.query = (p) =>
          p.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : origQuery(p);
      } catch(e) {}

      // 6. 伪造 connection.rtt
      try {
        if (navigator.connection) {
          Object.defineProperty(navigator.connection, 'rtt', { get: () => 100 });
        }
      } catch(e) {}
    `
  }).catch(() => {})

  // 监听 CDP 事件
  dbg.on('message', (_event, method, params) => {
    if (method === 'Network.requestWillBeSent') {
      // ── 请求即将发送（第一阶段：比 responseReceived 早得多） ──
      pendingRequests++
      lastNetworkActivityTime = Date.now()

      const reqUrl: string = params.request?.url ?? ''
      const headers: Record<string, string> = params.request?.headers ?? {}

      // 保存请求头（后续下载时透传 Cookie/Referer）
      if (reqUrl && !sniffedRequestHeaders.has(reqUrl)) {
        sniffedRequestHeaders.set(reqUrl, headers)
      }

      // ★ 在请求发送阶段就预录入：通过 URL 后缀判断的图片即使被缓存也能捕获
      // 因为缓存命中时 responseReceived 可能不触发或参数不同
      if (reqUrl && hasImageExt(reqUrl) && !sniffedImages.has(reqUrl)) {
        sniffedImages.set(reqUrl, {
          url: reqUrl,
          size: 0,  // 此阶段还不知道大小
          contentType: ''
        })
        const mainWin = getMainWin()
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('sniff:image-found', {
            url: reqUrl,
            size: 0,
            contentType: ''
          })
        }
      }
    } else if (method === 'Network.responseReceived') {
      // ── 收到响应头（第二阶段：精确的 Content-Type 和大小） ──
      lastNetworkActivityTime = Date.now()

      const response = params.response ?? {}
      const reqUrl: string = response.url ?? ''
      const mimeType: string = response.mimeType ?? ''
      const contentLength: number = response.headers?.['content-length']
        ? parseInt(response.headers['content-length'], 10)
        : (response.headers?.['Content-Length'] ? parseInt(response.headers['Content-Length'], 10) : 0)

      if (reqUrl && isImageResource(reqUrl, mimeType)) {
        // 过滤太小的图片（图标、占位符等），阈值 5KB
        if (contentLength > 0 && contentLength < 5120) return

        if (!sniffedImages.has(reqUrl)) {
          // 全新图片：录入并推送
          sniffedImages.set(reqUrl, {
            url: reqUrl,
            size: contentLength,
            contentType: mimeType
          })
          const mainWin = getMainWin()
          if (mainWin && !mainWin.isDestroyed()) {
            mainWin.webContents.send('sniff:image-found', {
              url: reqUrl,
              size: contentLength,
              contentType: mimeType
            })
          }
        } else {
          // 已在 requestWillBeSent 阶段预录入，但现在有了精确信息，更新之
          const existing = sniffedImages.get(reqUrl)!
          if (existing.size === 0 || !existing.contentType) {
            existing.size = contentLength
            existing.contentType = mimeType
            sniffedImages.set(reqUrl, existing)
            // 推送更新（前端可用于刷新大小显示等）
            const mainWin = getMainWin()
            if (mainWin && !mainWin.isDestroyed()) {
              mainWin.webContents.send('sniff:image-updated', {
                url: reqUrl,
                size: contentLength,
                contentType: mimeType
              })
            }
          }
        }
      }
    } else if (method === 'Network.requestServedFromCache') {
      // ★ 缓存命中时单独触发（responseReceived 可能不触发）
      lastNetworkActivityTime = Date.now()
      const requestId: string = params.requestId ?? ''
      // requestServedFromCache 只有 requestId，没有 URL
      // 但 requestWillBeSent 已经用 URL 预录入了，所以这里主要用于更新网络状态
      if (requestId) {
        pendingRequests = Math.max(0, pendingRequests - 1)
      }
    } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      // ── 请求完成或失败 ──
      pendingRequests = Math.max(0, pendingRequests - 1)
      lastNetworkActivityTime = Date.now()
    }
  })
}

/** 安全分离 CDP debugger */
function detachCDP(): void {
  if (!cdpAttached) return
  try {
    if (sniffWin && !sniffWin.isDestroyed()) {
      sniffWin.webContents.debugger.detach()
    }
  } catch { /* ignore */ }
  cdpAttached = false
  pendingRequests = 0
}

/** 触发懒加载的 JS 脚本（注入到页面） */
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
`

/** 滚动 + Canvas 捕获脚本（统一的智能滚动逻辑，同时捕获 Canvas 和触发懒加载） */
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
`

/**
 * 分页式翻页预检脚本（注入到嗅探窗口）
 *
 * 策略：收集所有可能的翻页候选热区，逐个试探点击，通过多信号综合判断
 * 找到真正能触发"翻到下一页"的交互元素。
 *
 * 返回值：
 *   { success: true, method: string, selector: string } — 找到有效翻页交互
 *   { success: false, reason: string }                  — 未找到
 */
const PAGINATE_PRECHECK_SCRIPT = `
  new Promise(async (resolve) => {
    // ── 工具函数 ──
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    /** 获取页面状态快照（用于对比变化） */
    function getSnapshot() {
      const mainImgs = Array.from(document.querySelectorAll('img'))
        .filter(i => i.naturalWidth > 200 || i.width > 200)
        .map(i => i.src)
        .slice(0, 10);

      // Canvas 内容指纹（采样几个像素点的颜色哈希）
      let canvasHash = '';
      const cvs = document.querySelector('canvas');
      if (cvs && cvs.width > 100 && cvs.height > 100) {
        try {
          const ctx = cvs.getContext('2d');
          if (ctx) {
            const pts = [[cvs.width/2, cvs.height/2], [cvs.width/4, cvs.height/4], [cvs.width*3/4, cvs.height*3/4]];
            canvasHash = pts.map(([x,y]) => {
              const d = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
              return d[0] + ',' + d[1] + ',' + d[2];
            }).join('|');
          }
        } catch {}
      }

      return {
        url: location.href,
        title: document.title,
        scrollTop: window.scrollY || document.documentElement.scrollTop,
        mainImgSrcs: mainImgs,
        canvasHash
      };
    }

    /** 对比两个快照，计算变化信号得分 */
    function diffScore(before, after) {
      let score = 0;
      let signals = [];

      // URL 变化（最强信号）
      if (after.url !== before.url) {
        score += 40;
        signals.push('url');
      }

      // 主图 src 变化
      if (before.mainImgSrcs.length > 0 || after.mainImgSrcs.length > 0) {
        const beforeSet = new Set(before.mainImgSrcs);
        const afterSet = new Set(after.mainImgSrcs);
        const changed = after.mainImgSrcs.filter(s => !beforeSet.has(s)).length;
        if (changed > 0) {
          score += 30;
          signals.push('img(' + changed + ')');
        }
      }

      // Canvas 内容变化
      if (before.canvasHash && after.canvasHash && before.canvasHash !== after.canvasHash) {
        score += 30;
        signals.push('canvas');
      }

      // 标题变化
      if (after.title !== before.title) {
        score += 10;
        signals.push('title');
      }

      // 滚动位置重置到顶部
      if (before.scrollTop > 100 && after.scrollTop < 50) {
        score += 15;
        signals.push('scrollReset');
      }

      return { score, signals };
    }

    /** 生成候选翻页元素列表（按优先级排序） */
    function findCandidates() {
      const candidates = [];

      // ── 策略1：查找"下一页/next"相关的按钮和链接 ──
      const nextKeywords = [
        '下一页', '下一话', '下一章', '下页', '后页', '下一回',
        'next', 'next page', 'next chapter', '▶', '›', '»', '→'
      ];
      const allClickable = document.querySelectorAll('a, button, [role="button"], [onclick], .next, .btn-next, [class*="next"]');
      for (const el of allClickable) {
        const text = (el.textContent || '').trim().toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const title = (el.getAttribute('title') || '').toLowerCase();
        const className = (el.className || '').toLowerCase();

        for (const kw of nextKeywords) {
          if (text.includes(kw.toLowerCase()) || ariaLabel.includes(kw.toLowerCase()) ||
              title.includes(kw.toLowerCase()) || className.includes(kw.toLowerCase())) {
            // 排除明显的 "上一页/prev" 元素
            const fullText = text + ariaLabel + title + className;
            if (fullText.includes('上一') || fullText.includes('prev') || fullText.includes('前')) continue;

            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              candidates.push({
                el,
                method: 'nextButton',
                priority: 100,
                selector: describeElement(el),
                desc: 'Next button: ' + text.slice(0, 30)
              });
            }
            break;
          }
        }
      }

      // ── 策略2：查找漫画图片主体区域（点击右半部分翻页） ──
      const mainImages = Array.from(document.querySelectorAll('img'))
        .filter(i => {
          const rect = i.getBoundingClientRect();
          return rect.width > 300 && rect.height > 300;
        })
        .sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return (rb.width * rb.height) - (ra.width * ra.height);
        });

      if (mainImages.length > 0) {
        candidates.push({
          el: mainImages[0],
          method: 'clickImage',
          priority: 60,
          selector: describeElement(mainImages[0]),
          desc: 'Main comic image'
        });
      }

      // ── 策略3：查找大面积的可点击覆盖层 / 阅读器容器 ──
      const readerSelectors = [
        '.reader-container', '.comic-container', '.manga-container',
        '#reader', '#viewer', '#comic-container',
        '[class*="reader"]', '[class*="viewer"]', '[class*="comic-page"]'
      ];
      for (const sel of readerSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 300 && rect.height > 300) {
              candidates.push({
                el,
                method: 'clickReader',
                priority: 50,
                selector: sel,
                desc: 'Reader container: ' + sel
              });
            }
          }
        } catch {}
      }

      // ── 策略4：键盘右方向键 ──
      candidates.push({
        el: null,
        method: 'keyRight',
        priority: 30,
        selector: 'keyboard:ArrowRight',
        desc: 'Keyboard ArrowRight'
      });

      // 按优先级排序
      candidates.sort((a, b) => b.priority - a.priority);
      return candidates;
    }

    /** 生成元素的 CSS selector 描述 */
    function describeElement(el) {
      if (el.id) return '#' + el.id;
      let desc = el.tagName.toLowerCase();
      if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\\s+/).slice(0, 3).join('.');
        if (cls) desc += '.' + cls;
      }
      return desc;
    }

    /** 执行一次点击/按键操作 */
    function performAction(candidate) {
      if (candidate.method === 'keyRight') {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
        return;
      }

      const el = candidate.el;
      if (!el) return;

      if (candidate.method === 'clickImage') {
        // 点击图片右侧 60% 的位置（大多数漫画平台右侧是翻下一页）
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width * 0.75;
        const y = rect.top + rect.height * 0.5;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      } else {
        el.click();
      }
    }

    // ── 开始预检 ──
    const allCandidates = findCandidates();
    if (allCandidates.length === 0) {
      resolve({ success: false, reason: 'No candidates found' });
      return;
    }

    // 逐个试探候选元素
    for (const candidate of allCandidates) {
      const before = getSnapshot();

      performAction(candidate);

      // 等待页面响应（URL 跳转/DOM 更新/网络请求等）
      await sleep(2000);

      const after = getSnapshot();
      const diff = diffScore(before, after);

      if (diff.score >= 30) {
        // ★ 找到有效翻页！但需要回退到原始状态
        // 尝试用 history.back() 回到之前的页面
        if (after.url !== before.url) {
          history.back();
          await sleep(1500);
        }

        resolve({
          success: true,
          method: candidate.method,
          selector: candidate.selector,
          desc: candidate.desc,
          score: diff.score,
          signals: diff.signals
        });
        return;
      }
    }

    resolve({ success: false, reason: 'No effective pagination interaction found' });
  })
`

/**
 * 单步翻页脚本（注入到嗅探窗口，每次只执行一步翻页动作）
 *
 * ★ 关键设计：
 * 1. 不使用长 Promise！因为翻页可能导致 URL 跳转，JS 上下文被销毁
 * 2. 如果翻页元素是 <a> 链接，返回 href URL 让主进程用 loadURL 导航
 *    而不是在 renderer 中 el.click() 触发导航（会被 executeJavaScript 中断）
 * 3. 非链接式翻页（键盘、点击图片、JS 事件）仍在 renderer 中执行
 *
 * 返回值：
 *   { action: 'navigate', url: '...' }  — 需要主进程导航到新 URL
 *   { action: 'clicked' }               — 已在页面内执行点击/按键
 *   { action: 'none' }                  — 未找到翻页元素
 */
function buildSinglePageTurnScript(method: string, selector: string): string {
  return `
    (function() {
      const method = ${JSON.stringify(method)};
      const selector = ${JSON.stringify(selector)};

      if (method === 'keyRight') {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
        return { action: 'clicked' };
      }

      let el = null;
      if (method === 'nextButton') {
        const nextKeywords = ['下一页','下一话','下一章','下页','后页','下一回','next','next page','next chapter','▶','›','»','→'];
        const allClickable = document.querySelectorAll('a, button, [role="button"], [onclick], .next, .btn-next, [class*="next"]');
        for (const candidate of allClickable) {
          const text = (candidate.textContent || '').trim().toLowerCase();
          const ariaLabel = (candidate.getAttribute('aria-label') || '').toLowerCase();
          const title = (candidate.getAttribute('title') || '').toLowerCase();
          const className = (candidate.className || '').toLowerCase();
          const fullText = text + ariaLabel + title + className;
          if (fullText.includes('上一') || fullText.includes('prev') || fullText.includes('前')) continue;

          for (const kw of nextKeywords) {
            if (text.includes(kw.toLowerCase()) || ariaLabel.includes(kw.toLowerCase()) ||
                title.includes(kw.toLowerCase()) || className.includes(kw.toLowerCase())) {
              const rect = candidate.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) { el = candidate; break; }
            }
          }
          if (el) break;
        }
      } else if (method === 'clickImage') {
        const imgs = Array.from(document.querySelectorAll('img'))
          .filter(i => { const r = i.getBoundingClientRect(); return r.width > 300 && r.height > 300; })
          .sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (rb.width * rb.height) - (ra.width * ra.height);
          });
        if (imgs.length > 0) el = imgs[0];
      } else if (method === 'clickReader') {
        try { el = document.querySelector(selector); } catch {}
      }

      if (!el) return { action: 'none' };

      // ★ 关键：如果是 <a> 标签且有 href，返回 URL 让主进程导航
      // 而不是在这里 click()（click 会触发导航，但 executeJavaScript 会被中断）
      if (el.tagName === 'A' && el.href && el.href !== '#' && !el.href.startsWith('javascript:')) {
        return { action: 'navigate', url: el.href };
      }

      // 检查父元素是否是 <a> 标签
      const parentA = el.closest('a');
      if (parentA && parentA.href && parentA.href !== '#' && !parentA.href.startsWith('javascript:')) {
        return { action: 'navigate', url: parentA.href };
      }

      // 非链接式翻页：直接在页面内执行
      if (method === 'clickImage') {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width * 0.75;
        const y = rect.top + rect.height * 0.5;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      } else {
        el.click();
      }
      return { action: 'clicked' };
    })()
  `
}

/** 获取页面快照脚本（用于翻页前后对比） */
const PAGE_SNAPSHOT_SCRIPT = `
  (function() {
    const mainImgs = Array.from(document.querySelectorAll('img'))
      .filter(i => i.naturalWidth > 200 || i.width > 200)
      .map(i => i.src)
      .slice(0, 10);

    let canvasHash = '';
    const cvs = document.querySelector('canvas');
    if (cvs && cvs.width > 100 && cvs.height > 100) {
      try {
        const ctx = cvs.getContext('2d');
        if (ctx) {
          const pts = [[cvs.width/2, cvs.height/2], [cvs.width/4, cvs.height/4], [cvs.width*3/4, cvs.height*3/4]];
          canvasHash = pts.map(([x,y]) => {
            const d = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
            return d[0] + ',' + d[1] + ',' + d[2];
          }).join('|');
        }
      } catch {}
    }

    return {
      url: location.href,
      mainImgSrcs: mainImgs,
      canvasHash
    };
  })()
`

/** 对比两个页面快照是否有实质性变化 */
function snapshotsChanged(
  before: { url: string; mainImgSrcs: string[]; canvasHash: string },
  after: { url: string; mainImgSrcs: string[]; canvasHash: string }
): boolean {
  if (after.url !== before.url) return true
  if (before.canvasHash && after.canvasHash && before.canvasHash !== after.canvasHash) return true
  const beforeSet = new Set(before.mainImgSrcs)
  const changed = after.mainImgSrcs.filter(s => !beforeSet.has(s)).length
  if (changed > 0) return true
  return false
}

/** 自动翻页停止标志 */
let paginateStopFlag = false
/** 自动翻页当前状态 */
let paginateStatus = { page: 0, running: false }

/** 启动嗅探：创建预览窗口，通过 CDP 持续监听所有网络请求 */
ipcMain.handle('sniff:start', async (_event, url: string): Promise<boolean> => {
  try {
    // 如果已有嗅探窗口，先清理
    if (sniffWin && !sniffWin.isDestroyed()) {
      detachCDP()
      sniffWin.close()
    }
    sniffedImages.clear()
    sniffedRequestHeaders.clear()
    pendingRequests = 0
    lastNetworkActivityTime = Date.now()

    // 创建独立 session
    sniffSession = session.fromPartition('persist:sniffer')

    // ★ 忽略 SSL 证书错误（很多漫画站证书有问题或使用自签名证书）
    sniffSession.setCertificateVerifyProc((_request, callback) => {
      callback(0) // 0 = 信任所有证书
    })

    // ★ 计算与当前 Electron 内置 Chromium 匹配的真实 Chrome UA
    // process.versions.chrome 返回实际 Chromium 版本号（如 "120.0.6099.291"）
    const chromiumVer = process.versions.chrome || '120.0.0.0'
    const chromiumMajor = chromiumVer.split('.')[0] || '120'
    const chromeUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromiumVer} Safari/537.36`
    const secChUa = `"Not_A Brand";v="8", "Chromium";v="${chromiumMajor}", "Google Chrome";v="${chromiumMajor}"`

    // ★ 设置 session 级 User-Agent（影响所有从该 session 发出的请求）
    sniffSession.setUserAgent(chromeUA)

    // ★ 通过 webRequest 拦截并修正所有请求头（模拟真实 Chrome）
    // 这在 Chromium 网络栈层面执行，比 JS 注入更早，也更可靠
    sniffSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders }
      // 强制覆盖 User-Agent（去掉 Electron 标识）
      headers['User-Agent'] = chromeUA
      // 注入/覆盖 sec-ch-ua Client Hints（Cloudflare 重点检查项）
      headers['sec-ch-ua'] = secChUa
      headers['sec-ch-ua-mobile'] = '?0'
      headers['sec-ch-ua-platform'] = '"Windows"'
      headers['sec-ch-ua-full-version-list'] = secChUa
      // 补全 Accept-Language（很多 WAF 检查此头是否存在且格式正确）
      if (!headers['Accept-Language']) {
        headers['Accept-Language'] = 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6'
      }
      // 主文档请求需要 Upgrade-Insecure-Requests
      if (details.resourceType === 'mainFrame') {
        headers['Upgrade-Insecure-Requests'] = '1'
        if (!headers['Accept'] || headers['Accept'] === '*/*') {
          headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
        }
        // 主文档的 sec-fetch 头
        headers['sec-fetch-dest'] = 'document'
        headers['sec-fetch-mode'] = 'navigate'
        headers['sec-fetch-site'] = 'none'
        headers['sec-fetch-user'] = '?1'
      }
      callback({ requestHeaders: headers })
    })

    // 创建可见的嗅探窗口（预览模式：用户可以实时看到页面加载过程）
    sniffWin = new BrowserWindow({
      width: 1100,
      height: 750,
      show: sniffWinVisible,
      title: '嗅探预览 - MangaBox',
      autoHideMenuBar: true,
      webPreferences: {
        session: sniffSession,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false
      }
    })

    // 同步页面标题到窗口标题
    sniffWin.webContents.on('page-title-updated', (_e, title) => {
      if (sniffWin && !sniffWin.isDestroyed()) {
        sniffWin.setTitle(`${title} - MangaBox 嗅探预览`)
      }
    })

    // 通知前端嗅探窗口 URL 变化（用户在预览中手动导航时）
    sniffWin.webContents.on('did-navigate', (_e, navUrl) => {
      const mainWin = getMainWin()
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('sniff:url-changed', navUrl)
      }
    })
    sniffWin.webContents.on('did-navigate-in-page', (_e, navUrl) => {
      const mainWin = getMainWin()
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('sniff:url-changed', navUrl)
      }
    })

    sniffWin.on('closed', () => {
      detachCDP()
      sniffWin = null
      // 通知渲染进程嗅探窗口已被用户手动关闭
      const mainWin = getMainWin()
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('sniff:window-closed')
      }
    })

    // ★ 关键：在页面开始加载前就附加 CDP，这样不会遗漏任何请求
    // CDP 会持续监听，即使 sniff:start 返回后，用户手动操作（滚动、翻页、点击）
    // 触发的新图片请求也会被 CDP 捕获并推送到前端
    attachCDP()

    // 加载页面（容错：某些站点部分资源加载失败但主页面可用）
    let loadOk = true
    try {
      await sniffWin.loadURL(url)
    } catch (loadErr: unknown) {
      const errStr = String(loadErr)
      console.warn('sniff:start loadURL warning:', errStr)
      // 如果窗口已经有内容（部分加载成功），不中断流程
      if (sniffWin && !sniffWin.isDestroyed()) {
        const currentUrl = sniffWin.webContents.getURL()
        // about:blank 说明完全没加载到任何内容，才算失败
        if (currentUrl === 'about:blank' || currentUrl === '') {
          loadOk = false
        }
      } else {
        loadOk = false
      }
    }

    if (!loadOk) {
      console.error('sniff:start failed: page completely failed to load')
      return false
    }

    // 使用网络空闲检测代替固定等待——等到连续 2 秒无新请求
    await waitForNetworkIdle(2000, 15000)

    // 触发懒加载
    try {
      if (sniffWin && !sniffWin.isDestroyed()) {
        await sniffWin.webContents.executeJavaScript(TRIGGER_LAZY_LOAD_SCRIPT)
      }
    } catch { /* 非致命 */ }

    // 再等待网络空闲（懒加载触发的新请求）
    await waitForNetworkIdle(2000, 10000)

    // ★ 注意：此处 return 后，CDP 仍然持续工作！
    // 用户在预览窗口中的任何操作（手动滚动、点击翻页、导航）
    // 触发的新图片请求都会继续被 CDP 捕获并实时推送给前端
    return true
  } catch (err) {
    console.error('sniff:start failed:', err)
    return false
  }
})

/** 停止嗅探：分离 CDP 并关闭窗口 */
ipcMain.handle('sniff:stop', async (): Promise<void> => {
  detachCDP()
  if (sniffWin && !sniffWin.isDestroyed()) {
    sniffWin.close()
  }
  sniffWin = null
  sniffedImages.clear()
  sniffedRequestHeaders.clear()
})

/**
 * 在嗅探窗口中手动触发懒加载 + 重新扫描
 * 用于用户手动操作后，确保所有图片都被抓取
 */
ipcMain.handle('sniff:triggerLazy', async (): Promise<number> => {
  if (!sniffWin || sniffWin.isDestroyed()) return 0
  try {
    const countBefore = sniffedImages.size
    await sniffWin.webContents.executeJavaScript(TRIGGER_LAZY_LOAD_SCRIPT)
    // 等待新请求完成
    await waitForNetworkIdle(1500, 8000)
    return sniffedImages.size - countBefore
  } catch {
    return 0
  }
})

/**
 * 切换嗅探窗口可见性（显示/隐藏预览）
 * 如果窗口不存在，只更新 sniffWinVisible 标志供下次创建时使用
 */
ipcMain.handle('sniff:togglePreview', async (_event, visible: boolean): Promise<boolean> => {
  sniffWinVisible = visible
  if (sniffWin && !sniffWin.isDestroyed()) {
    if (visible) {
      sniffWin.show()
      sniffWin.focus()
    } else {
      sniffWin.hide()
    }
  }
  return sniffWinVisible
})

/** 获取嗅探预览窗口当前是否可见 */
ipcMain.handle('sniff:isPreviewVisible', async (): Promise<boolean> => {
  if (sniffWin && !sniffWin.isDestroyed()) {
    return sniffWin.isVisible()
  }
  return false
})

/** 聚焦嗅探预览窗口 */
ipcMain.handle('sniff:focusPreview', async (): Promise<void> => {
  if (sniffWin && !sniffWin.isDestroyed()) {
    sniffWin.show()
    sniffWin.focus()
  }
})

/** 检查当前嗅探 session 是否有指定 URL 的 Cookie（用于判断登录状态） */
ipcMain.handle('sniff:checkLogin', async (_event, url: string): Promise<{ hasCookies: boolean; cookieCount: number }> => {
  try {
    if (!sniffSession) {
      sniffSession = session.fromPartition('persist:sniffer')
    }
    const cookies = await sniffSession.cookies.get({ url })
    return {
      hasCookies: cookies.length > 0,
      cookieCount: cookies.length
    }
  } catch {
    return { hasCookies: false, cookieCount: 0 }
  }
})

/** 清除嗅探 session 的所有 Cookie（用于「退出登录」） */
ipcMain.handle('sniff:clearCookies', async (_event, url?: string): Promise<boolean> => {
  try {
    if (!sniffSession) return true
    if (url) {
      // 只清除指定 URL 的 Cookie
      const cookies = await sniffSession.cookies.get({ url })
      for (const cookie of cookies) {
        const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${cookie.domain?.replace(/^\./, '')}${cookie.path || '/'}`
        await sniffSession.cookies.remove(cookieUrl, cookie.name)
      }
    } else {
      // 清除所有 Cookie
      await sniffSession.clearStorageData({ storages: ['cookies'] })
    }
    return true
  } catch (err) {
    console.error('sniff:clearCookies failed:', err)
    return false
  }
})

/** 获取当前已嗅探到的所有图片列表 */
ipcMain.handle('sniff:getImages', async (): Promise<Array<{ url: string; size: number; contentType: string }>> => {
  return Array.from(sniffedImages.values())
})

/** 在嗅探窗口中执行 JS */
ipcMain.handle('sniff:executeJS', async (_event, code: string): Promise<unknown> => {
  if (!sniffWin || sniffWin.isDestroyed()) return null
  try {
    return await sniffWin.webContents.executeJavaScript(code)
  } catch (err) {
    console.error('sniff:executeJS failed:', err)
    return null
  }
})

/** 获取嗅探窗口的当前 URL */
ipcMain.handle('sniff:getCurrentURL', async (): Promise<string> => {
  if (!sniffWin || sniffWin.isDestroyed()) return ''
  return sniffWin.webContents.getURL()
})

/** 嗅探窗口导航到新 URL（保持 CDP 持续监听） */
ipcMain.handle('sniff:navigate', async (_event, url: string): Promise<boolean> => {
  if (!sniffWin || sniffWin.isDestroyed()) return false
  try {
    // CDP 保持附加状态，导航产生的新请求会继续被捕获
    await sniffWin.loadURL(url)
    // 等待初始加载
    await waitForNetworkIdle(2000, 10000)
    // 触发懒加载
    try {
      await sniffWin.webContents.executeJavaScript(TRIGGER_LAZY_LOAD_SCRIPT)
    } catch { /* 非致命 */ }
    await waitForNetworkIdle(1500, 8000)
    return true
  } catch {
    return false
  }
})

/** 清空已嗅探的图片列表 */
ipcMain.handle('sniff:clearImages', async (): Promise<void> => {
  sniffedImages.clear()
  sniffedRequestHeaders.clear()
})

/** 自动滚动嗅探页面（触发懒加载 + Canvas 捕获） */
ipcMain.handle('sniff:autoScroll', async (): Promise<{ newNetworkImages: number; canvasDataUrls: string[] }> => {
  if (!sniffWin || sniffWin.isDestroyed()) return { newNetworkImages: 0, canvasDataUrls: [] }
  try {
    const countBefore = sniffedImages.size

    // ★ 使用带 Canvas 捕获的滚动脚本（统一逻辑）
    // 这样对 Canvas 渲染的漫画网站（如 CCC 漫画）也能在自动滚动时同步捕获
    const canvasDataUrls: string[] = await sniffWin.webContents.executeJavaScript(SCROLL_AND_CAPTURE_SCRIPT, true) || []

    // 滚动完成后，用网络空闲检测等待最后一批请求完成
    await waitForNetworkIdle(2500, 15000)

    return {
      newNetworkImages: sniffedImages.size - countBefore,
      canvasDataUrls
    }
  } catch (err) {
    console.error('sniff:autoScroll failed:', err)
    return { newNetworkImages: 0, canvasDataUrls: [] }
  }
})

/** 分页式翻页预检：检测页面中有效的翻页交互方式 */
ipcMain.handle('sniff:paginatePrecheck', async (): Promise<{
  success: boolean
  method?: string
  selector?: string
  desc?: string
  score?: number
  signals?: string[]
  reason?: string
}> => {
  if (!sniffWin || sniffWin.isDestroyed()) return { success: false, reason: 'No sniff window' }
  try {
    const result = await sniffWin.webContents.executeJavaScript(PAGINATE_PRECHECK_SCRIPT, true)
    return result || { success: false, reason: 'Script returned null' }
  } catch (err) {
    console.error('sniff:paginatePrecheck failed:', err)
    return { success: false, reason: String(err) }
  }
})

/** 等待嗅探窗口页面加载完成（did-finish-load 或 did-fail-load） */
function waitForPageLoad(timeoutMs = 30000): Promise<boolean> {
  return new Promise((resolve) => {
    if (!sniffWin || sniffWin.isDestroyed()) { resolve(false); return }

    let resolved = false
    const done = (ok: boolean): void => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      sniffWin?.webContents?.removeListener('did-finish-load', onFinish)
      sniffWin?.webContents?.removeListener('did-fail-load', onFail)
      resolve(ok)
    }

    const onFinish = (): void => done(true)
    const onFail = (): void => done(true) // 即使加载失败（部分资源），页面可能已经有内容了

    sniffWin.webContents.on('did-finish-load', onFinish)
    sniffWin.webContents.on('did-fail-load', onFail)

    const timer = setTimeout(() => done(true), timeoutMs) // 超时也算完成
  })
}

/** 分页式自动翻页：主进程循环驱动，每步独立执行，不依赖长 Promise */
ipcMain.handle('sniff:autoPaginate', async (_event, method: string, selector: string): Promise<{ totalPages: number }> => {
  if (!sniffWin || sniffWin.isDestroyed()) return { totalPages: 0 }

  paginateStopFlag = false
  paginateStatus = { page: 0, running: true }

  const MAX_PAGES = 200
  const MAX_NO_CHANGE = 3
  let noChangeCount = 0
  let pageCount = 0
  const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
  const pageTurnScript = buildSinglePageTurnScript(method, selector)

  const mainWin = getMainWin()

  try {
    for (let i = 0; i < MAX_PAGES; i++) {
      if (paginateStopFlag) break
      if (!sniffWin || sniffWin.isDestroyed()) break

      // 1. 获取翻页前的快照
      let before: { url: string; mainImgSrcs: string[]; canvasHash: string }
      try {
        before = await sniffWin.webContents.executeJavaScript(PAGE_SNAPSHOT_SCRIPT, true)
      } catch {
        // 页面可能正在导航中，等一下再试
        await sleep(2000)
        if (!sniffWin || sniffWin.isDestroyed()) break
        try {
          before = await sniffWin.webContents.executeJavaScript(PAGE_SNAPSHOT_SCRIPT, true)
        } catch { break }
      }

      // 2. 执行翻页动作
      let turnResult: { action: string; url?: string } = { action: 'none' }
      try {
        turnResult = await sniffWin.webContents.executeJavaScript(pageTurnScript, true) || { action: 'none' }
      } catch {
        // 翻页脚本执行失败（可能页面已在导航中），忽略
      }

      console.log(`autoPaginate[${i}]: turnResult =`, JSON.stringify(turnResult))

      if (turnResult.action === 'none') {
        // 没找到翻页元素，无法继续
        noChangeCount++
        if (noChangeCount >= MAX_NO_CHANGE) break
        await sleep(1000)
        continue
      }

      if (turnResult.action === 'navigate' && turnResult.url) {
        // ★ 链接式翻页：用 loadURL 导航到新 URL
        // 这样预览窗口会实际显示新页面！（之前用 el.click() 可能被 executeJS 中断）
        console.log(`autoPaginate[${i}]: navigating to`, turnResult.url)
        try {
          // 先开始等待页面加载完成
          const loadPromise = waitForPageLoad(20000)
          // 然后发起导航
          sniffWin.webContents.loadURL(turnResult.url)
          // 等待页面加载完成
          await loadPromise
        } catch (navErr) {
          console.warn('autoPaginate navigation warning:', navErr)
        }
      } else {
        // 非链接式翻页（键盘、JS 点击等），等待页面内容变化
        await sleep(3000)
      }

      if (!sniffWin || sniffWin.isDestroyed()) break

      // 3. 等待网络空闲
      await waitForNetworkIdle(2000, 10000)
      if (!sniffWin || sniffWin.isDestroyed()) break

      // 4. 触发懒加载
      try {
        await sniffWin.webContents.executeJavaScript(TRIGGER_LAZY_LOAD_SCRIPT)
        await sleep(500)
      } catch { /* 非致命 */ }

      // 5. 获取翻页后的快照
      let after: { url: string; mainImgSrcs: string[]; canvasHash: string }
      try {
        after = await sniffWin.webContents.executeJavaScript(PAGE_SNAPSHOT_SCRIPT, true)
      } catch {
        await sleep(1000)
        if (!sniffWin || sniffWin.isDestroyed()) break
        try {
          after = await sniffWin.webContents.executeJavaScript(PAGE_SNAPSHOT_SCRIPT, true)
        } catch { break }
      }

      // 6. 对比快照判断是否成功翻页
      if (snapshotsChanged(before, after)) {
        noChangeCount = 0
        pageCount++
        paginateStatus = { page: pageCount, running: true }
        console.log(`autoPaginate: page ${pageCount} turned successfully (${before.url} → ${after.url})`)
        // 通知前端当前页码
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('sniff:paginate-progress', { page: pageCount, running: true })
        }
      } else {
        noChangeCount++
        console.log(`autoPaginate: no change detected (noChangeCount=${noChangeCount})`)
        if (noChangeCount >= MAX_NO_CHANGE) {
          // 连续无变化，认为已到最后一页
          break
        }
        await sleep(1000)
      }
    }
  } catch (err) {
    console.error('sniff:autoPaginate loop error:', err)
  }

  // 最后等待网络请求完成
  if (sniffWin && !sniffWin.isDestroyed()) {
    await waitForNetworkIdle(2500, 15000)
  }

  paginateStatus = { page: pageCount, running: false }
  console.log(`autoPaginate: turned ${pageCount} pages, total images: ${sniffedImages.size}`)

  return { totalPages: pageCount }
})

/** 停止自动翻页 */
ipcMain.handle('sniff:paginateStop', async (): Promise<void> => {
  paginateStopFlag = true
})

/** 获取自动翻页状态 */
ipcMain.handle('sniff:paginateStatus', async (): Promise<{ page: number; running: boolean }> => {
  return paginateStatus
})

/** 从页面中的 Canvas 元素提取图片 */
ipcMain.handle('sniff:captureCanvas', async (): Promise<string[]> => {
  if (!sniffWin || sniffWin.isDestroyed()) return []
  try {
    const dataUrls: string[] = await sniffWin.webContents.executeJavaScript(`
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
    `)
    return dataUrls || []
  } catch (err) {
    console.error('sniff:captureCanvas failed:', err)
    return []
  }
})

/** 自动滚动 + Canvas 连续捕获 */
ipcMain.handle('sniff:scrollAndCapture', async (): Promise<string[]> => {
  if (!sniffWin || sniffWin.isDestroyed()) return []
  try {
    const mainWin = getMainWin()

    const allDataUrls: string[] = await sniffWin.webContents.executeJavaScript(SCROLL_AND_CAPTURE_SCRIPT, true)

    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('sniff:download-progress', {
        current: allDataUrls?.length || 0,
        total: allDataUrls?.length || 0,
        downloaded: allDataUrls?.length || 0
      })
    }

    return allDataUrls || []
  } catch (err) {
    console.error('sniff:scrollAndCapture failed:', err)
    return []
  }
})

/** 将 base64 data URL 保存为图片文件 */
ipcMain.handle(
  'sniff:saveDataUrlsToLibrary',
  async (_event, dataUrls: string[], mangaTitle: string, libraryDir: string): Promise<boolean> => {
    try {
      const trimmed = mangaTitle.trim() || `抓取_${Date.now()}`
      let destPath = join(libraryDir, trimmed)
      if (existsSync(destPath)) {
        destPath = join(libraryDir, `${trimmed}_${Date.now()}`)
      }
      mkdirSync(destPath, { recursive: true })

      const mainWin = getMainWin()
      let saved = 0

      for (let i = 0; i < dataUrls.length; i++) {
        try {
          const dataUrl = dataUrls[i]
          // 解析 data URL: data:image/png;base64,xxxx
          const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
          if (!match) continue

          const ext = match[1] === 'jpeg' ? '.jpg' : `.${match[1]}`
          const buffer = Buffer.from(match[2], 'base64')

          // 过滤太小的图片（< 10KB 可能是空白 canvas）
          if (buffer.length < 10240) continue

          const filename = `${String(saved + 1).padStart(3, '0')}${ext}`
          writeFileSync(join(destPath, filename), buffer)
          saved++
        } catch { /* skip bad data URL */ }

        // 推送进度
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('sniff:download-progress', {
            current: i + 1,
            total: dataUrls.length,
            downloaded: saved
          })
        }
      }

      // 如果一张都没保存成功，清理空目录
      if (saved === 0) {
        try { rmdirSync(destPath) } catch { /* ignore */ }
        return false
      }

      return true
    } catch (err) {
      console.error('sniff:saveDataUrlsToLibrary failed:', err)
      return false
    }
  }
)

/**
 * 统一保存抓取图片到书库（合并 Canvas + 网络图片，支持单话/系列模式）
 * mode: 'single' = 直接保存为单话, 'series' = 保存到系列下的一话
 * seriesPath: 当 mode='series' 时，指定已有系列目录的路径（为空则新建系列）
 * seriesName: 当 mode='series' 且 seriesPath 为空时，用于创建新系列的名称
 * chapterName: 话/章节名称（单话模式就是漫画名，系列模式就是章节名）
 * canvasDataUrls: Canvas 捕获的 data URL 数组
 * networkUrls: 网络嗅探的图片 URL 数组
 */
ipcMain.handle(
  'sniff:saveGrab',
  async (
    _event,
    opts: {
      mode: 'single' | 'series'
      seriesPath: string
      seriesName: string
      chapterName: string
      canvasDataUrls: string[]
      networkUrls: string[]
      libraryDir: string
    }
  ): Promise<{ ok: boolean; savedCount: number }> => {
    try {
      const mainWin = getMainWin()
      const { mode, canvasDataUrls, networkUrls, libraryDir } = opts
      const chapterName = opts.chapterName.trim() || `抓取_${Date.now()}`
      const totalItems = canvasDataUrls.length + networkUrls.length

      let destPath: string

      if (mode === 'series') {
        // ── 系列模式：保存到系列目录下的子目录 ──
        let seriesDir: string

        if (opts.seriesPath && existsSync(opts.seriesPath)) {
          // 使用已有系列
          seriesDir = opts.seriesPath
        } else {
          // 创建新系列
          const seriesName = (opts.seriesName || chapterName).trim()
          seriesDir = join(libraryDir, seriesName)
          if (!existsSync(seriesDir)) {
            mkdirSync(seriesDir, { recursive: true })
            writeFileSync(join(seriesDir, '.manga-series'), '', 'utf-8')
          }
        }

        // 在系列下创建章节子目录
        destPath = join(seriesDir, chapterName)
        if (existsSync(destPath)) {
          destPath = join(seriesDir, `${chapterName}_${Date.now()}`)
        }
        mkdirSync(destPath, { recursive: true })
      } else {
        // ── 单话模式：直接在书库根目录创建 ──
        destPath = join(libraryDir, chapterName)
        if (existsSync(destPath)) {
          destPath = join(libraryDir, `${chapterName}_${Date.now()}`)
        }
        mkdirSync(destPath, { recursive: true })
      }

      let saved = 0
      let progress = 0

      // 1. 先保存 Canvas 图片（通常是漫画主体内容）
      for (let i = 0; i < canvasDataUrls.length; i++) {
        progress++
        try {
          const dataUrl = canvasDataUrls[i]
          const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
          if (!match) continue

          const ext = match[1] === 'jpeg' ? '.jpg' : `.${match[1]}`
          const buffer = Buffer.from(match[2], 'base64')
          if (buffer.length < 10240) continue  // 过滤太小

          const filename = `${String(saved + 1).padStart(3, '0')}${ext}`
          writeFileSync(join(destPath, filename), buffer)
          saved++
        } catch { /* skip */ }

        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('sniff:download-progress', {
            current: progress,
            total: totalItems,
            downloaded: saved
          })
        }
      }

      // 2. 再保存网络图片
      for (let i = 0; i < networkUrls.length; i++) {
        progress++
        const url = networkUrls[i]
        let ext = '.jpg'
        try {
          const pathname = new URL(url).pathname.toLowerCase()
          const m = pathname.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?|$)/i)
          if (m) ext = `.${m[1]}`
        } catch { /* fallback */ }

        const filename = `${String(saved + 1).padStart(3, '0')}${ext}`
        const ok = await downloadImage(url, join(destPath, filename))
        if (ok) saved++

        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('sniff:download-progress', {
            current: progress,
            total: totalItems,
            downloaded: saved
          })
        }
      }

      // 如果一张都没保存成功，清理空目录
      if (saved === 0) {
        try { rmdirSync(destPath) } catch { /* ignore */ }
        return { ok: false, savedCount: 0 }
      }

      return { ok: true, savedCount: saved }
    } catch (err) {
      console.error('sniff:saveGrab failed:', err)
      return { ok: false, savedCount: 0 }
    }
  }
)

/** 获取书库中所有系列目录信息 */
ipcMain.handle(
  'sniff:getSeriesList',
  async (_event, libraryDir: string): Promise<Array<{ name: string; path: string; chapterCount: number }>> => {
    try {
      if (!existsSync(libraryDir)) return []
      const entries = readdirSync(libraryDir, { withFileTypes: true })
      const seriesList: Array<{ name: string; path: string; chapterCount: number }> = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = join(libraryDir, entry.name)
        if (checkIsSeries(fullPath)) {
          const chapters = readdirSync(fullPath, { withFileTypes: true })
            .filter((e) => e.isDirectory())
          seriesList.push({
            name: entry.name,
            path: fullPath,
            chapterCount: chapters.length
          })
        }
      }

      return seriesList.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    } catch (err) {
      console.error('sniff:getSeriesList failed:', err)
      return []
    }
  }
)

/**
 * 从嗅探 session 中获取指定 URL 的 Cookie 字符串
 */
async function getSessionCookies(url: string): Promise<string> {
  try {
    if (!sniffSession) return ''
    const cookies = await sniffSession.cookies.get({ url })
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  } catch {
    return ''
  }
}

/**
 * ★ 构建反防盗链请求头（Node.js 原生 HTTP 使用）
 * 合并 CDP 捕获的原始请求头 + sniffSession Cookie + 浏览器指纹头
 */
async function buildAntiHotlinkHeaders(imageUrl: string): Promise<Record<string, string>> {
  const originalHeaders = sniffedRequestHeaders.get(imageUrl)
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'image',
    'sec-fetch-mode': 'no-cors',
    'sec-fetch-site': 'cross-site'
  }

  // ★ Referer 最关键：必须是原始页面 URL
  if (originalHeaders?.['Referer'] || originalHeaders?.['referer']) {
    headers['Referer'] = originalHeaders['Referer'] || originalHeaders['referer']
  } else {
    try {
      if (sniffWin && !sniffWin.isDestroyed()) {
        headers['Referer'] = sniffWin.webContents.getURL()
      }
    } catch { /* ignore */ }
  }

  // Cookie：优先用 CDP 捕获的原始 Cookie，其次从 sniffSession 获取
  if (originalHeaders?.['Cookie'] || originalHeaders?.['cookie']) {
    headers['Cookie'] = originalHeaders['Cookie'] || originalHeaders['cookie']
  } else {
    const sessionCookie = await getSessionCookies(imageUrl)
    if (sessionCookie) headers['Cookie'] = sessionCookie
  }

  // 透传 Origin
  if (originalHeaders?.['Origin'] || originalHeaders?.['origin']) {
    headers['Origin'] = originalHeaders['Origin'] || originalHeaders['origin']
  }

  return headers
}

/**
 * 使用 Node.js 原生 http/https 获取 URL 内容为 Buffer
 * 自动跟随最多 5 次重定向
 */
function fetchBufferViaNode(url: string, headers: Record<string, string>, maxRedirects = 5): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const urlObj = new URL(url)
    const getter = urlObj.protocol === 'https:' ? httpsGet : httpGet

    const req = getter(url, {
      headers,
      rejectUnauthorized: false  // 忽略 SSL 证书错误
    }, (res) => {
      // 跟随重定向
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        if (maxRedirects <= 0) { resolve(null); return }
        const redirectUrl = new URL(res.headers.location, url).href
        fetchBufferViaNode(redirectUrl, headers, maxRedirects - 1).then(resolve)
        return
      }

      if (!res.statusCode || res.statusCode >= 400) {
        res.resume()
        resolve(null)
        return
      }

      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', () => resolve(null))
    })

    req.on('error', () => resolve(null))
    req.setTimeout(30000, () => {
      req.destroy()
      resolve(null)
    })
  })
}

/**
 * ★ 使用 Node.js 原生 http/https 下载图片（绕过 Chromium referrer policy 限制）
 *
 * 为什么不用 session.fetch()？
 * Chromium 的 network_service_network_delegate 会检查 Referrer 合法性，
 * 跨域 Referrer（如 dm5.com → cdndm5.com）会被判定为 "invalid referrer"
 * 并直接取消请求（ERR_BLOCKED_BY_CLIENT），这是 Chromium 内部安全机制。
 *
 * Node.js 的 http/https 模块不走 Chromium 网络栈，可以自由设置任意请求头。
 */
async function downloadImage(imageUrl: string, destPath: string, retries = 3): Promise<boolean> {
  const headers = await buildAntiHotlinkHeaders(imageUrl)

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const buffer = await fetchBufferViaNode(imageUrl, headers)

      if (buffer && buffer.length >= 1024) {
        writeFileSync(destPath, buffer)
        return true
      }

      console.warn(`downloadImage attempt ${attempt}/${retries}: ${buffer ? `too small (${buffer.length} bytes)` : 'null response'} for ${imageUrl}`)
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * attempt))
      }
    } catch (err) {
      console.warn(`downloadImage attempt ${attempt}/${retries} error:`, err)
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * attempt))
      }
    }
  }
  return false
}

/**
 * ★ 图片代理：前端通过主进程获取图片数据（绕过防盗链）
 *
 * 使用 Node.js 原生 http/https 模块发请求（不走 Chromium 网络栈），
 * 可以自由设置 Referer 头，不受 Chromium referrer policy 检查的限制。
 */
ipcMain.handle('sniff:proxyImage', async (_event, imageUrl: string): Promise<string | null> => {
  try {
    const headers = await buildAntiHotlinkHeaders(imageUrl)
    const buffer = await fetchBufferViaNode(imageUrl, headers)

    if (!buffer || buffer.length < 1024) return null

    // 根据 URL 推断 MIME 类型
    let mime = 'image/jpeg'
    try {
      const pathname = new URL(imageUrl).pathname.toLowerCase()
      if (pathname.endsWith('.png')) mime = 'image/png'
      else if (pathname.endsWith('.webp')) mime = 'image/webp'
      else if (pathname.endsWith('.gif')) mime = 'image/gif'
      else if (pathname.endsWith('.avif')) mime = 'image/avif'
      else if (pathname.endsWith('.bmp')) mime = 'image/bmp'
    } catch { /* fallback to jpeg */ }

    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch (err) {
    console.error('sniff:proxyImage failed:', imageUrl, err)
    return null
  }
})

/** 将选中的图片 URL 列表下载到书库中作为一本漫画 */
ipcMain.handle(
  'sniff:saveToLibrary',
  async (_event, imageUrls: string[], mangaTitle: string, libraryDir: string): Promise<boolean> => {
    try {
      const trimmed = mangaTitle.trim() || `抓取_${Date.now()}`
      let destPath = join(libraryDir, trimmed)
      if (existsSync(destPath)) {
        destPath = join(libraryDir, `${trimmed}_${Date.now()}`)
      }
      mkdirSync(destPath, { recursive: true })

      // 通知进度
      const mainWin = getMainWin()
      let downloaded = 0

      for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i]
        // 从 URL 推断后缀
        let ext = '.jpg'
        try {
          const pathname = new URL(url).pathname.toLowerCase()
          const match = pathname.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?|$)/i)
          if (match) ext = `.${match[1]}`
        } catch { /* fallback to .jpg */ }

        const filename = `${String(i + 1).padStart(3, '0')}${ext}`
        const ok = await downloadImage(url, join(destPath, filename))
        if (ok) downloaded++

        // 推送进度
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('sniff:download-progress', {
            current: i + 1,
            total: imageUrls.length,
            downloaded
          })
        }
      }

      return downloaded > 0
    } catch (err) {
      console.error('sniff:saveToLibrary failed:', err)
      return false
    }
  }
)
