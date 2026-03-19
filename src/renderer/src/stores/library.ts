import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useLibraryStore = defineStore('library', () => {
  const books = ref<Book[]>([])
  const readProgress = ref<Record<string, ReadProgress>>({})
  const libraryPath = ref<string>('')
  const isLoading = ref<boolean>(false)
  const isImporting = ref<boolean>(false)

  /** 章节阅读时的上下文（章节不在 books 列表中，通过此传递） */
  const readerContext = ref<ReaderContext | null>(null)

  const recentBooks = computed<Book[]>(() => {
    return [...books.value]
      .filter((b) => readProgress.value[b.id])
      .sort((a, b) => {
        const pa = readProgress.value[a.id]?.lastReadAt ?? 0
        const pb = readProgress.value[b.id]?.lastReadAt ?? 0
        return pb - pa
      })
      .slice(0, 12)
  })

  async function loadFromStore(): Promise<void> {
    const api = window.electronAPI
    const savedProgress = (await api.storeGet('readProgress')) as
      | Record<string, ReadProgress>
      | undefined
    if (savedProgress) readProgress.value = savedProgress

    const savedPath = (await api.storeGet('libraryPath')) as string | undefined
    if (savedPath) {
      libraryPath.value = savedPath
    } else {
      libraryPath.value = await api.getDefaultLibraryDir()
    }

    await refreshLibrary()
  }

  async function setLibraryPath(path: string): Promise<void> {
    libraryPath.value = path
    await window.electronAPI.storeSet('libraryPath', path)
    await refreshLibrary()
  }

  async function resetLibraryPath(): Promise<void> {
    const defaultDir = await window.electronAPI.getDefaultLibraryDir()
    libraryPath.value = defaultDir
    await window.electronAPI.storeDelete('libraryPath')
    await refreshLibrary()
  }

  async function refreshLibrary(): Promise<void> {
    if (!libraryPath.value) return
    isLoading.value = true
    try {
      const scanned = await window.electronAPI.scanLibrary(libraryPath.value)
      books.value = scanned
    } finally {
      isLoading.value = false
    }
  }

  async function removeBook(bookId: string): Promise<void> {
    const book = books.value.find((b) => b.id === bookId)
    if (book) {
      await window.electronAPI.removeBook(book.path)
      await refreshLibrary()
    }
  }

  async function saveProgress(bookId: string, page: number, total: number): Promise<void> {
    readProgress.value[bookId] = { page, total, lastReadAt: Date.now() }
    await window.electronAPI.storeSet('readProgress', readProgress.value)
  }

  function getProgress(bookId: string): ReadProgress | null {
    return readProgress.value[bookId] ?? null
  }

  function getBook(bookId: string): Book | undefined {
    return books.value.find((b) => b.id === bookId)
  }

  function setReaderContext(ctx: ReaderContext | null): void {
    readerContext.value = ctx
  }

  return {
    books,
    readProgress,
    libraryPath,
    isLoading,
    isImporting,
    readerContext,
    recentBooks,
    loadFromStore,
    setLibraryPath,
    resetLibraryPath,
    refreshLibrary,
    removeBook,
    saveProgress,
    getProgress,
    getBook,
    setReaderContext
  }
})
