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
  rmdirSync,
  createWriteStream
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

// ============ 在线抓取 / 图片嗅探 ============

/** 嗅探窗口状态 */
let sniffWin: BrowserWindow | null = null
const sniffedImages: Map<string, { url: string; size: number; contentType: string }> = new Map()
let sniffSession: Electron.Session | null = null

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
    // 如果是 octet-stream，按 URL 后缀判断
    if (BINARY_MIMES.some((m) => lower.includes(m))) {
      return hasImageExt(url)
    }
  }
  // 按 URL 后缀兜底
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

/** 获取渲染进程主窗口 */
function getMainWin(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => w !== sniffWin) ?? null
}

/** 启动嗅探：创建隐藏窗口加载 URL，拦截所有图片请求 */
ipcMain.handle('sniff:start', async (_event, url: string): Promise<boolean> => {
  try {
    // 如果已有嗅探窗口，先关闭
    if (sniffWin && !sniffWin.isDestroyed()) {
      sniffWin.close()
    }
    sniffedImages.clear()

    // 创建独立 session（隔离主窗口 cookie）
    sniffSession = session.fromPartition('persist:sniffer')

    // 设置请求拦截：监听所有完成的网络请求
    sniffSession.webRequest.onCompleted(
      { urls: ['*://*/*'] },
      (details) => {
        const { url: reqUrl, statusCode, responseHeaders } = details
        if (statusCode < 200 || statusCode >= 400) return

        const contentType = responseHeaders?.['content-type']?.[0]
          ?? responseHeaders?.['Content-Type']?.[0]
          ?? ''
        const contentLength = parseInt(
          responseHeaders?.['content-length']?.[0]
            ?? responseHeaders?.['Content-Length']?.[0]
            ?? '0',
          10
        )

        if (isImageResource(reqUrl, contentType) && !sniffedImages.has(reqUrl)) {
          // 过滤太小的图片（图标、占位符等），阈值 5KB
          if (contentLength > 0 && contentLength < 5120) return

          sniffedImages.set(reqUrl, {
            url: reqUrl,
            size: contentLength,
            contentType
          })

          // 推送给渲染进程
          const mainWin = getMainWin()
          if (mainWin && !mainWin.isDestroyed()) {
            mainWin.webContents.send('sniff:image-found', {
              url: reqUrl,
              size: contentLength,
              contentType
            })
          }
        }
      }
    )

    // 创建隐藏的嗅探窗口
    sniffWin = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        session: sniffSession,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false
      }
    })

    sniffWin.on('closed', () => {
      sniffWin = null
    })

    await sniffWin.loadURL(url)

    // ── 页面加载完成后，等待一段时间让懒加载/异步图片完成 ──
    // 很多网站 DOMContentLoaded 之后还有大量异步图片加载
    await new Promise((r) => setTimeout(r, 2000))

    // 尝试触发所有懒加载图片：将所有 img 的 data-src/data-original 等属性赋值给 src
    try {
      await sniffWin.webContents.executeJavaScript(`
        (function() {
          // 常见的懒加载属性
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
          // 触发 IntersectionObserver —— 把所有图片滚入视口一次
          const allImgs = document.querySelectorAll('img[loading="lazy"], img[data-src]');
          for (const img of allImgs) {
            img.loading = 'eager';
          }
          return triggered;
        })()
      `)
    } catch { /* 非致命，忽略 */ }

    // 再等一段时间让触发的懒加载完成网络请求
    await new Promise((r) => setTimeout(r, 1500))

    return true
  } catch (err) {
    console.error('sniff:start failed:', err)
    return false
  }
})

/** 停止嗅探 */
ipcMain.handle('sniff:stop', async (): Promise<void> => {
  if (sniffWin && !sniffWin.isDestroyed()) {
    sniffWin.close()
  }
  sniffWin = null
  sniffedImages.clear()
})

/** 获取当前已嗅探到的所有图片列表 */
ipcMain.handle('sniff:getImages', async (): Promise<Array<{ url: string; size: number; contentType: string }>> => {
  return Array.from(sniffedImages.values())
})

/** 在嗅探窗口中执行 JS（用于翻页、滚动等） */
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

/** 嗅探窗口导航到新 URL */
ipcMain.handle('sniff:navigate', async (_event, url: string): Promise<boolean> => {
  if (!sniffWin || sniffWin.isDestroyed()) return false
  try {
    await sniffWin.loadURL(url)
    return true
  } catch {
    return false
  }
})

/** 清空已嗅探的图片列表 */
ipcMain.handle('sniff:clearImages', async (): Promise<void> => {
  sniffedImages.clear()
})

/** 自动滚动嗅探页面（触发懒加载） */
ipcMain.handle('sniff:autoScroll', async (): Promise<number> => {
  if (!sniffWin || sniffWin.isDestroyed()) return 0
  try {
    const countBefore = sniffedImages.size

    // 注入智能滚动脚本：
    // 1. 动态检测页面的实际滚动容器（滚动过程中会周期性重新检测）
    // 2. 分步缓慢滚动，每步等待足够时间让图片加载
    // 3. 同时触发懒加载属性
    await sniffWin.webContents.executeJavaScript(`
      new Promise(async (resolve) => {
        // ── 检测滚动容器 ──
        function findScrollContainer() {
          // 优先检查常见的漫画阅读器容器选择器
          const commonSelectors = [
            '.reader-container', '.comic-container', '.manga-container',
            '.chapter-content', '.reading-content', '.comic-content',
            '#comic-container', '#reader', '#viewer', '#content',
            '.viewer', '.reader', '[class*="reader"]', '[class*="viewer"]',
            '[class*="comic"]', '[class*="manga"]'
          ];
          for (const sel of commonSelectors) {
            try {
              const el = document.querySelector(sel);
              if (el && el.scrollHeight > el.clientHeight + 100) return el;
            } catch {}
          }

          // 检查 body 和 documentElement
          const docEl = document.documentElement;
          const body = document.body;
          if (docEl.scrollHeight > docEl.clientHeight + 100) return docEl;
          if (body.scrollHeight > body.clientHeight + 100) return body;

          // 查找页面中最大的可滚动元素
          let best = null;
          let bestH = 0;
          const allEls = document.querySelectorAll('div, main, section, article');
          for (const el of allEls) {
            const style = getComputedStyle(el);
            const overflowY = style.overflowY;
            if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
              if (el.scrollHeight > el.clientHeight + 100 && el.scrollHeight > bestH) {
                bestH = el.scrollHeight;
                best = el;
              }
            }
          }
          return best || docEl;
        }

        // ── 封装滚动状态，支持动态切换容器 ──
        let container = findScrollContainer();
        let isDocScroll = container === document.documentElement || container === document.body;
        let redetectCounter = 0;
        const REDETECT_INTERVAL = 10; // 每滚动 10 步重新检测一次容器

        function getViewHeight() {
          return isDocScroll ? window.innerHeight : container.clientHeight;
        }
        function getStep() {
          return Math.floor(getViewHeight() * 0.7);
        }
        function getScrollTop() {
          return isDocScroll ? (window.scrollY || window.pageYOffset || document.documentElement.scrollTop) : container.scrollTop;
        }
        function getScrollMax() {
          return isDocScroll
            ? document.documentElement.scrollHeight - window.innerHeight
            : container.scrollHeight - container.clientHeight;
        }
        function doScroll(amount) {
          if (isDocScroll) window.scrollBy(0, amount);
          else container.scrollTop += amount;
        }

        // 重新检测容器：如果发现更大/更合适的容器就切换
        function redetectContainer() {
          const newContainer = findScrollContainer();
          const newIsDoc = newContainer === document.documentElement || newContainer === document.body;
          // 计算新容器的可滚动高度
          const newScrollable = newIsDoc
            ? document.documentElement.scrollHeight - window.innerHeight
            : newContainer.scrollHeight - newContainer.clientHeight;
          const oldScrollable = getScrollMax();

          // 如果新容器可滚动范围明显更大，或者旧容器已经不可滚动了，则切换
          if (newContainer !== container && (newScrollable > oldScrollable * 1.5 || oldScrollable <= 10)) {
            container = newContainer;
            isDocScroll = newIsDoc;
          }
        }

        // 触发懒加载的辅助函数
        function triggerLazyLoad() {
          const lazySrcAttrs = ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc',
            'data-lazy', 'data-url', 'data-echo'];
          const imgs = document.querySelectorAll('img');
          for (const img of imgs) {
            if (img.src && !img.src.startsWith('data:') && img.complete && img.naturalWidth > 0) continue;
            for (const attr of lazySrcAttrs) {
              const val = img.getAttribute(attr);
              if (val && val.startsWith('http')) { img.src = val; break; }
            }
          }
        }

        // 滚到顶部
        if (isDocScroll) window.scrollTo(0, 0);
        else container.scrollTop = 0;
        await new Promise(r => setTimeout(r, 500));

        // 初始等待后重新检测一次（页面可能在这 500ms 内加载了图片导致布局变化）
        redetectContainer();

        let lastScrollMax = 0;
        let sameCount = 0;
        let iterations = 0;
        const maxIterations = 200; // 安全上限

        while (iterations < maxIterations) {
          iterations++;
          redetectCounter++;

          // 周期性重新检测滚动容器
          if (redetectCounter >= REDETECT_INTERVAL) {
            redetectCounter = 0;
            redetectContainer();
          }

          triggerLazyLoad();
          doScroll(getStep()); // 每次动态计算步长
          // 每步等待 500ms 让图片请求发出并被拦截
          await new Promise(r => setTimeout(r, 500));

          const scrollTop = getScrollTop();
          const scrollMax = getScrollMax();

          // 检查是否到底
          if (scrollTop >= scrollMax - 10) {
            // 到底了，等一会让图片加载（可能加载后高度会变）
            await new Promise(r => setTimeout(r, 1500));
            triggerLazyLoad();
            // 重新检测容器和高度——图片加载后布局可能完全不同
            redetectContainer();
            const newScrollMax = getScrollMax();
            if (newScrollMax > scrollMax + 50) {
              // 高度增长了，说明有新图片加载进来，继续滚动
              sameCount = 0;
              lastScrollMax = newScrollMax;
              continue;
            }
            break;
          }

          // 检查页面高度是否还在增长（动态加载）
          if (scrollMax === lastScrollMax) {
            sameCount++;
            if (sameCount >= 8) {
              // 高度 8 次不变，但先重新检测容器确认一下
              redetectContainer();
              const finalMax = getScrollMax();
              if (finalMax > scrollMax + 50) {
                // 切换了容器或高度变了，重置计数继续
                sameCount = 0;
                lastScrollMax = finalMax;
                continue;
              }
              break;
            }
          } else {
            sameCount = 0;
            lastScrollMax = scrollMax;
          }
        }

        // 最后一次触发懒加载
        triggerLazyLoad();
        resolve(iterations);
      })
    `)

    // 等待最后一批网络请求完成
    await new Promise((r) => setTimeout(r, 2000))
    return sniffedImages.size - countBefore
  } catch (err) {
    console.error('sniff:autoScroll failed:', err)
    return 0
  }
})

/** 从页面中的 Canvas 元素提取图片（用于 Canvas 渲染的漫画网站） */
ipcMain.handle('sniff:captureCanvas', async (): Promise<string[]> => {
  if (!sniffWin || sniffWin.isDestroyed()) return []
  try {
    // 注入脚本：找到所有有实际内容的 canvas，导出为 data URL
    const dataUrls: string[] = await sniffWin.webContents.executeJavaScript(`
      (function() {
        const results = [];
        const allCanvas = document.querySelectorAll('canvas');
        for (const cvs of allCanvas) {
          // 过滤太小的 canvas（广告、按钮等），至少 100x100
          if (cvs.width < 100 || cvs.height < 100) continue;
          try {
            // 尝试 2d context
            let ctx = cvs.getContext('2d');
            if (ctx) {
              // 多点采样检测是否有实际内容
              let hasContent = false;
              const samplePoints = [
                [cvs.width/2, cvs.height/2],
                [cvs.width/4, cvs.height/4],
                [cvs.width*3/4, cvs.height/4],
                [cvs.width/4, cvs.height*3/4],
                [cvs.width*3/4, cvs.height*3/4],
                [cvs.width/2, cvs.height/4],
                [cvs.width/2, cvs.height*3/4]
              ];
              for (const [x, y] of samplePoints) {
                const p = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
                if (p[3] > 0) { hasContent = true; break; }
              }
              if (!hasContent) continue;
            }
            // 对于 WebGL canvas，getContext('2d') 返回 null，但仍可 toDataURL
            const dataUrl = cvs.toDataURL('image/png');
            if (dataUrl && dataUrl.length > 1000) {
              results.push(dataUrl);
            }
          } catch(e) {
            // toDataURL 可能因跨域 taint 抛异常，忽略
          }
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

/** 自动滚动 + Canvas 连续捕获（专为 Canvas 渲染的漫画设计） */
ipcMain.handle('sniff:scrollAndCapture', async (): Promise<string[]> => {
  if (!sniffWin || sniffWin.isDestroyed()) return []
  try {
    const mainWin = getMainWin()

    // 注入脚本：动态检测滚动容器，逐步滚动并捕获 Canvas
    const allDataUrls: string[] = await sniffWin.webContents.executeJavaScript(`
      new Promise(async (resolve) => {
        const captured = new Set();
        const results = [];

        // ── 检测滚动容器 ──
        function findScrollContainer() {
          const commonSelectors = [
            '.reader-container', '.comic-container', '.manga-container',
            '.chapter-content', '.reading-content', '.comic-content',
            '#comic-container', '#reader', '#viewer', '#content',
            '.viewer', '.reader', '[class*="reader"]', '[class*="viewer"]',
            '[class*="comic"]', '[class*="manga"]'
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
          const allEls = document.querySelectorAll('div, main, section, article');
          for (const el of allEls) {
            const style = getComputedStyle(el);
            const overflowY = style.overflowY;
            if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
              if (el.scrollHeight > el.clientHeight + 100 && el.scrollHeight > bestH) {
                bestH = el.scrollHeight;
                best = el;
              }
            }
          }
          return best || docEl;
        }

        // ── 封装滚动状态，支持动态切换容器 ──
        let container = findScrollContainer();
        let isDocScroll = container === document.documentElement || container === document.body;
        let redetectCounter = 0;
        const REDETECT_INTERVAL = 8; // 每滚动 8 步重新检测

        function getViewHeight() {
          return isDocScroll ? window.innerHeight : container.clientHeight;
        }
        function getStep() {
          // Canvas 渲染需要更小的步长
          return Math.floor(getViewHeight() * 0.6);
        }
        function getScrollTop() {
          return isDocScroll ? (window.scrollY || window.pageYOffset) : container.scrollTop;
        }
        function getScrollMax() {
          return isDocScroll
            ? document.documentElement.scrollHeight - window.innerHeight
            : container.scrollHeight - container.clientHeight;
        }
        function doScroll(amount) {
          if (isDocScroll) window.scrollBy(0, amount);
          else container.scrollTop += amount;
        }

        // 重新检测容器：如果发现更大/更合适的容器就切换
        function redetectContainer() {
          const newContainer = findScrollContainer();
          const newIsDoc = newContainer === document.documentElement || newContainer === document.body;
          const newScrollable = newIsDoc
            ? document.documentElement.scrollHeight - window.innerHeight
            : newContainer.scrollHeight - newContainer.clientHeight;
          const oldScrollable = getScrollMax();

          if (newContainer !== container && (newScrollable > oldScrollable * 1.5 || oldScrollable <= 10)) {
            container = newContainer;
            isDocScroll = newIsDoc;
          }
        }

        function captureVisibleCanvases() {
          const allCanvas = document.querySelectorAll('canvas');
          let newCount = 0;
          for (const cvs of allCanvas) {
            if (cvs.width < 100 || cvs.height < 100) continue;
            const rect = cvs.getBoundingClientRect();
            const containerRect = isDocScroll
              ? { top: 0, bottom: window.innerHeight }
              : container.getBoundingClientRect();
            const inView = rect.bottom > containerRect.top - 800
              && rect.top < containerRect.bottom + 800;
            if (!inView) continue;
            try {
              let ctx = cvs.getContext('2d');
              if (ctx) {
                let hasContent = false;
                const checkPoints = [
                  [cvs.width/2, cvs.height/2],
                  [cvs.width/4, cvs.height/4],
                  [cvs.width*3/4, cvs.height*3/4],
                  [cvs.width/2, cvs.height/4],
                  [cvs.width/2, cvs.height*3/4]
                ];
                for (const [x, y] of checkPoints) {
                  const p = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
                  if (p[3] > 0) { hasContent = true; break; }
                }
                if (!hasContent) continue;
              }
              const dataUrl = cvs.toDataURL('image/png');
              if (dataUrl && dataUrl.length > 1000 && !captured.has(dataUrl)) {
                captured.add(dataUrl);
                results.push(dataUrl);
                newCount++;
              }
            } catch(e) { /* tainted canvas */ }
          }
          return newCount;
        }

        // 滚到顶部
        if (isDocScroll) window.scrollTo(0, 0);
        else container.scrollTop = 0;
        // 等待 Canvas 渲染初始内容
        await new Promise(r => setTimeout(r, 1000));

        // 初始等待后重新检测容器
        redetectContainer();

        let lastScrollMax = 0;
        let sameCount = 0;
        let noNewCapture = 0;
        let iterations = 0;
        const maxIterations = 300; // 安全上限

        while (iterations < maxIterations) {
          iterations++;
          redetectCounter++;

          // 周期性重新检测滚动容器
          if (redetectCounter >= REDETECT_INTERVAL) {
            redetectCounter = 0;
            redetectContainer();
          }

          // 捕获当前可见的 canvas
          const newFound = captureVisibleCanvases();

          doScroll(getStep()); // 动态计算步长
          // 等待 Canvas 渲染新内容（Canvas 渲染比 img 慢）
          await new Promise(r => setTimeout(r, 800));

          const scrollTop = getScrollTop();
          const scrollMax = getScrollMax();

          // 到底检测
          if (scrollTop >= scrollMax - 10) {
            // 到底了，多等一下让渲染/网络完成
            await new Promise(r => setTimeout(r, 1500));
            captureVisibleCanvases();
            // 重新检测容器——图片/Canvas 加载后布局可能变化
            redetectContainer();
            const newMax = getScrollMax();
            if (newMax > scrollMax + 50) {
              // 高度增长了，继续滚动
              sameCount = 0;
              lastScrollMax = newMax;
              continue;
            }
            // 尝试再滚一步确认
            doScroll(getStep());
            await new Promise(r => setTimeout(r, 800));
            const finalMax = getScrollMax();
            if (finalMax > scrollMax + 50) {
              sameCount = 0;
              lastScrollMax = finalMax;
              continue;
            }
            // 确实到底了
            captureVisibleCanvases();
            break;
          }

          // 高度不变检测
          if (scrollMax === lastScrollMax) {
            sameCount++;
          } else {
            sameCount = 0;
            lastScrollMax = scrollMax;
          }

          // 没有新 canvas 内容检测
          if (newFound === 0) {
            noNewCapture++;
          } else {
            noNewCapture = 0;
          }

          // 连续多次高度不变 且 没有新捕获 才退出
          if (sameCount >= 8 && noNewCapture >= 5) {
            // 退出前重新检测容器做最后确认
            redetectContainer();
            const confirmMax = getScrollMax();
            if (confirmMax > scrollMax + 50) {
              sameCount = 0;
              noNewCapture = 0;
              lastScrollMax = confirmMax;
              continue;
            }
            break;
          }

          // 仅高度不变但还有新捕获，继续（Canvas 可能是固定容器高度，但内容在变）
          if (sameCount >= 15) {
            // 绝对上限前也重检一次
            redetectContainer();
            const confirmMax2 = getScrollMax();
            if (confirmMax2 > scrollMax + 50) {
              sameCount = 0;
              lastScrollMax = confirmMax2;
              continue;
            }
            break;
          }
        }

        // 最终全量捕获一次
        captureVisibleCanvases();
        resolve(results);
      })
    `, true)

    // 通知进度
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

/** 下载图片并保存到指定目录（带重试） */
function downloadImage(imageUrl: string, destPath: string, retries = 3): Promise<boolean> {
  return new Promise((resolve) => {
    const doDownload = (attempt: number): void => {
      try {
        const urlObj = new URL(imageUrl)
        const getter = urlObj.protocol === 'https:' ? httpsGet : httpGet
        const req = getter(imageUrl, {
          headers: {
            'Referer': urlObj.origin,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        }, (res) => {
          // 跟随重定向
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            downloadImage(res.headers.location, destPath, attempt).then(resolve)
            return
          }
          if (!res.statusCode || res.statusCode >= 400) {
            if (attempt < retries) {
              setTimeout(() => doDownload(attempt + 1), 500 * attempt)
            } else {
              resolve(false)
            }
            return
          }
          const file = createWriteStream(destPath)
          res.pipe(file)
          file.on('finish', () => { file.close(); resolve(true) })
          file.on('error', () => {
            if (attempt < retries) {
              setTimeout(() => doDownload(attempt + 1), 500 * attempt)
            } else {
              resolve(false)
            }
          })
        })
        req.on('error', () => {
          if (attempt < retries) {
            setTimeout(() => doDownload(attempt + 1), 500 * attempt)
          } else {
            resolve(false)
          }
        })
        req.setTimeout(30000, () => {
          req.destroy()
          if (attempt < retries) {
            setTimeout(() => doDownload(attempt + 1), 500 * attempt)
          } else {
            resolve(false)
          }
        })
      } catch {
        resolve(false)
      }
    }
    doDownload(1)
  })
}

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
