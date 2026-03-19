import { app, BrowserWindow, ipcMain, dialog, protocol, shell } from 'electron'
import { join, basename, extname, dirname } from 'path'
import {
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  cpSync,
  copyFileSync,
  renameSync
} from 'fs'
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
    const url = decodeURIComponent(request.url.replace('manga-file://', ''))
    callback({ path: url })
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

/** 判断文件夹是否为系列（包含子目录） */
function checkIsSeries(folderPath: string): boolean {
  try {
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

ipcMain.handle('fs:getDefaultLibraryDir', () => DEFAULT_LIBRARY_DIR)

/** 导入漫画：复制到书库目录，文件夹自动重命名图片 */
ipcMain.handle(
  'fs:importBook',
  async (_event, sourcePath: string, destDir: string): Promise<boolean> => {
    if (!existsSync(sourcePath)) return false

    mkdirSync(destDir, { recursive: true })

    const name = basename(sourcePath)
    const ext = extname(name)
    const base = basename(name, ext)

    let destPath = join(destDir, name)
    if (existsSync(destPath)) {
      destPath = join(destDir, `${base}_${Date.now()}${ext}`)
    }

    try {
      const stat = statSync(sourcePath)
      if (stat.isDirectory()) {
        cpSync(sourcePath, destPath, { recursive: true })
        // 导入后自动按序号重命名
        autoRenameImages(destPath)
      } else {
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

      if (hasSubs) {
        // ── 系列：子目录 = 话数 ──
        const chapterDirs = subEntries
          .filter((e) => e.isDirectory())
          .sort((a, b) => naturalSort(a.name, b.name))

        let totalPages = 0
        let cover: string | null = null

        for (const ch of chapterDirs) {
          const chPath = join(fullPath, ch.name)
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
          pageCount: totalPages,
          chapterCount: chapterDirs.length,
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
      return files.map((f) => `manga-file://${encodeURIComponent(join(bookPath, f))}`)
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

/** 获取系列的所有章节 */
ipcMain.handle('fs:getChapters', async (_event, seriesPath: string): Promise<Chapter[]> => {
  if (!existsSync(seriesPath)) return []
  const entries = readdirSync(seriesPath, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => naturalSort(a.name, b.name))

  const chapters: Chapter[] = []
  for (let i = 0; i < entries.length; i++) {
    const chPath = join(seriesPath, entries[i].name)
    const imgs = readdirSync(chPath)
      .filter((f) => IMAGE_EXTS.includes(getExt(f)))
      .sort(naturalSort)
    if (imgs.length > 0) {
      chapters.push({
        id: btoa(encodeURIComponent(chPath)),
        title: entries[i].name,
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
 * 重命名章节/子目录顺序（用于系列编辑）
 * chapterNames: 子目录名称，按新顺序排列
 */
ipcMain.handle(
  'fs:reorderChapters',
  async (_event, seriesPath: string, chapterNames: string[]): Promise<boolean> => {
    try {
      // 先改为临时名
      const tmpNames: string[] = []
      for (let i = 0; i < chapterNames.length; i++) {
        const tmpName = `_reorder_tmp_${i}`
        renameSync(join(seriesPath, chapterNames[i]), join(seriesPath, tmpName))
        tmpNames.push(tmpName)
      }
      // 再改为最终名
      for (let i = 0; i < tmpNames.length; i++) {
        renameSync(join(seriesPath, tmpNames[i]), join(seriesPath, chapterNames[i]))
      }
      return true
    } catch (err) {
      console.error('reorderChapters failed:', err)
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
      const tmpMaps: Array<{ tmp: string; ext: string }> = []
      for (let i = 0; i < filenames.length; i++) {
        const ext = getExt(filenames[i])
        const tmpName = `_rename_tmp_${i}${ext}`
        renameSync(join(bookPath, filenames[i]), join(bookPath, tmpName))
        tmpMaps.push({ tmp: tmpName, ext })
      }
      for (let i = 0; i < tmpMaps.length; i++) {
        const finalName = `${String(i + 1).padStart(3, '0')}${tmpMaps[i].ext}`
        renameSync(join(bookPath, tmpMaps[i].tmp), join(bookPath, finalName))
      }
      return true
    } catch (err) {
      console.error('renamePages failed:', err)
      return false
    }
  }
)

/** 重命名书/章节目录 */
ipcMain.handle(
  'fs:renameBook',
  async (_event, bookPath: string, newTitle: string): Promise<string | null> => {
    try {
      const parent = dirname(bookPath)
      const newPath = join(parent, newTitle)
      if (existsSync(newPath) && newPath !== bookPath) return null
      if (newPath !== bookPath) renameSync(bookPath, newPath)
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
