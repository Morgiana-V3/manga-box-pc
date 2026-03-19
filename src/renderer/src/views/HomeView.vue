<template>
  <div class="home">
    <Sidebar
      @show-recent="activeTab = 'recent'"
      @add-folder="handleAddFolder"
      @add-archive="handleAddArchive"
      @show-settings="showSettings = true"
    />

    <main class="main-content">
      <!-- 顶部工具栏 -->
      <div class="toolbar">
        <div class="tab-group">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'shelf' }"
            @click="activeTab = 'shelf'"
          >
            全部漫画
            <span class="tab-badge">{{ library.books.length }}</span>
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'recent' }"
            @click="activeTab = 'recent'"
          >
            最近阅读
            <span class="tab-badge">{{ library.recentBooks.length }}</span>
          </button>
        </div>

        <div class="toolbar-right">
          <div class="search-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索漫画..."
              class="search-input"
            />
          </div>

          <div class="view-btns">
            <button
              class="btn-icon"
              :class="{ active: viewMode === 'grid' }"
              @click="viewMode = 'grid'"
              title="网格视图"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
            </button>
            <button
              class="btn-icon"
              :class="{ active: viewMode === 'list' }"
              @click="viewMode = 'list'"
              title="列表视图"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                <line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/>
                <line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
            </button>
          </div>

          <button
            class="btn btn-ghost"
            :disabled="library.isLoading"
            @click="library.refreshLibrary()"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
              :class="{ spinning: library.isLoading }">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
            </svg>
            刷新
          </button>
        </div>
      </div>

      <!-- 拖拽提示区域 -->
      <div
        class="drop-zone"
        :class="{ dragging: isDragging }"
        @dragover.prevent="isDragging = true"
        @dragleave="isDragging = false"
        @drop.prevent="handleDrop"
      >
        <!-- 导入状态 -->
        <div v-if="library.isImporting" class="loading-state">
          <div class="spinner" />
          <p>正在复制到漫画库，请稍候...</p>
        </div>

        <!-- 加载状态 -->
        <div v-else-if="library.isLoading" class="loading-state">
          <div class="spinner" />
          <p>正在扫描漫画库...</p>
        </div>

        <!-- 空状态 -->
        <div v-else-if="filteredBooks.length === 0" class="empty-state">
          <div class="empty-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
              <path d="M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14" stroke="url(#eg1)" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M4 19h14a2 2 0 010 4H4v-4z" fill="url(#eg2)" fill-opacity="0.5"/>
              <defs>
                <linearGradient id="eg1" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#a855f7" stop-opacity="0.5"/>
                  <stop offset="100%" stop-color="#7c3aed" stop-opacity="0.5"/>
                </linearGradient>
                <linearGradient id="eg2" x1="4" y1="19" x2="20" y2="23" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#a855f7" stop-opacity="0.5"/>
                  <stop offset="100%" stop-color="#7c3aed" stop-opacity="0.5"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h3>{{ searchQuery ? '没有找到匹配的漫画' : '书架空空如也' }}</h3>
          <p>{{ searchQuery ? '试试其他关键词' : '拖拽文件夹或压缩包到此处，或点击下方按钮添加' }}</p>
          <div v-if="!searchQuery" class="empty-actions">
            <button class="btn btn-primary" @click="handleAddFolder">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
              添加文件夹
            </button>
            <button class="btn btn-ghost" @click="handleAddArchive">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>
                <line x1="10" y1="12" x2="14" y2="12"/>
              </svg>
              添加压缩包
            </button>
          </div>
        </div>

        <!-- 网格视图 -->
        <div v-else-if="viewMode === 'grid'" class="book-grid">
          <BookCard
            v-for="book in filteredBooks"
            :key="book.id"
            :book="book"
            @open="openBook"
            @edit="editBook"
            @remove="removeBook"
          />
        </div>

        <!-- 列表视图 -->
        <div v-else class="book-list">
          <div
            v-for="book in filteredBooks"
            :key="book.id"
            class="list-item"
            @click="openBook(book)"
          >
            <div class="list-cover">
              <img v-if="book.coverData" :src="book.coverData" />
              <img v-else-if="book.cover" :src="`manga-file://${encodeURIComponent(book.cover)}`" />
              <div v-else class="list-cover-placeholder">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14M4 19h14a2 2 0 010 4H4v-4z"/>
                </svg>
              </div>
            </div>
            <div class="list-info">
              <p class="list-title">{{ book.title }}</p>
              <p class="list-meta">
              {{ book.kind === 'series' ? `${book.chapterCount ?? 0} 话` : `${book.pageCount} 页` }}
              · {{ book.type === 'archive' ? '压缩包' : book.kind === 'series' ? '系列' : '文件夹' }}
            </p>
              <div v-if="library.getProgress(book.id)" class="list-progress">
                <div class="list-progress-bar">
                  <div class="list-progress-fill"
                    :style="{ width: Math.round(((library.getProgress(book.id)!.page + 1) / library.getProgress(book.id)!.total) * 100) + '%' }"
                  />
                </div>
                <span>P.{{ library.getProgress(book.id)!.page + 1 }} / {{ library.getProgress(book.id)!.total }}</span>
              </div>
            </div>
            <button class="list-remove btn-icon" @click.stop="removeBook(book.id)" title="移除">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3,6 5,6 21,6"/>
                <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- 设置面板 -->
    <SettingsPanel v-if="showSettings" @close="showSettings = false" />

    <!-- 拖拽覆盖层 -->
    <div v-if="isDragging" class="drag-overlay">
      <div class="drag-hint">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <p>松开以添加漫画</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useLibraryStore } from '../stores/library'
import Sidebar from '../components/Sidebar.vue'
import BookCard from '../components/BookCard.vue'
import SettingsPanel from '../components/SettingsPanel.vue'

const router = useRouter()
const library = useLibraryStore()

const activeTab = ref<'shelf' | 'recent'>('shelf')
const searchQuery = ref<string>('')
const viewMode = ref<'grid' | 'list'>('grid')
const isDragging = ref<boolean>(false)
const showSettings = ref<boolean>(false)

const filteredBooks = computed<Book[]>(() => {
  const source = activeTab.value === 'recent' ? library.recentBooks : library.books
  if (!searchQuery.value.trim()) return source
  const q = searchQuery.value.toLowerCase()
  return source.filter((b) => b.title.toLowerCase().includes(q))
})

function openBook(book: Book): void {
  if (book.kind === 'series') {
    router.push(`/series/${book.id}`)
  } else {
    router.push(`/reader/${book.id}`)
  }
}

function editBook(book: Book): void {
  router.push(`/edit/${book.id}`)
}

async function removeBook(bookId: string): Promise<void> {
  await library.removeBook(bookId)
}

async function handleAddFolder(): Promise<void> {
  const folderPath = await window.electronAPI.openFolder()
  if (!folderPath) return
  library.isImporting = true
  try {
    await window.electronAPI.importBook(folderPath, library.libraryPath)
    await library.refreshLibrary()
  } finally {
    library.isImporting = false
  }
}

async function handleAddArchive(): Promise<void> {
  const paths = await window.electronAPI.openArchive()
  if (!paths.length) return
  library.isImporting = true
  try {
    for (const p of paths) {
      await window.electronAPI.importBook(p, library.libraryPath)
    }
    await library.refreshLibrary()
  } finally {
    library.isImporting = false
  }
}

async function handleDrop(e: DragEvent): Promise<void> {
  isDragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (!files.length) return
  library.isImporting = true
  try {
    for (const file of files) {
      await window.electronAPI.importBook(
        (file as File & { path: string }).path,
        library.libraryPath
      )
    }
    await library.refreshLibrary()
  } finally {
    library.isImporting = false
  }
}
</script>

<style scoped lang="less">
.home {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.main-content {
  flex: 1;
  .flex-col();
  overflow: hidden;
  background: @bg-primary;
}

// 工具栏
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid @border;
  flex-shrink: 0;
  gap: 12px;
}

.tab-group {
  display: flex;
  gap: 4px;
  background: @bg-secondary;
  padding: 4px;
  border-radius: @radius-sm;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 4px;
  border: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: @text-secondary;
  transition: all @transition;

  &.active {
    background: @accent;
    color: #fff;
  }

  &:not(.active):hover {
    background: @bg-hover;
    color: @text-primary;
  }
}

.tab-badge {
  background: rgba(255, 255, 255, 0.15);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 700;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: @bg-secondary;
  border: 1px solid @border;
  border-radius: @radius-sm;
  padding: 6px 12px;
  transition: border-color @transition;

  &:focus-within {
    border-color: @border-accent;
  }
}

.search-input {
  background: transparent;
  border: none;
  color: @text-primary;
  font-size: 13px;
  outline: none;
  width: 180px;

  &::placeholder {
    color: @text-muted;
  }
}

.view-btns {
  display: flex;
  gap: 2px;

  :deep(.btn-icon.active) {
    background: @bg-hover;
    color: @accent-light;
  }
}

.spinning {
  animation: spin 0.8s linear infinite;
}

// 内容区
.drop-zone {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  position: relative;
}

// 网格
.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 20px;
  animation: fadeIn 0.3s ease;
}

// 列表
.book-list {
  .flex-col();
  gap: 8px;
  animation: fadeIn 0.3s ease;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  background: @bg-card;
  border: 1px solid @border;
  border-radius: @radius;
  cursor: pointer;
  transition: all @transition;

  &:hover {
    background: @bg-hover;
    border-color: @border-accent;

    .list-remove {
      opacity: 1;
    }
  }
}

.list-cover {
  width: 52px;
  height: 72px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  background: @bg-secondary;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.list-cover-placeholder {
  width: 100%;
  height: 100%;
  .flex-center();
  color: @text-muted;
}

.list-info {
  flex: 1;
  overflow: hidden;
}

.list-title {
  font-size: 14px;
  font-weight: 500;
  color: @text-primary;
  .text-truncate();
}

.list-meta {
  font-size: 12px;
  color: @text-muted;
  margin-top: 4px;
}

.list-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;

  span {
    font-size: 11px;
    color: @accent-light;
    white-space: nowrap;
  }
}

.list-progress-bar {
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
  max-width: 200px;
}

.list-progress-fill {
  height: 100%;
  background: @accent-light;
  border-radius: 2px;
}

.list-remove {
  opacity: 0;
  transition: opacity @transition;
}

// 空状态
.empty-state {
  .flex-col();
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  min-height: 400px;
  text-align: center;

  h3 {
    font-size: 18px;
    font-weight: 600;
    color: @text-secondary;
  }

  p {
    font-size: 13px;
    color: @text-muted;
    max-width: 300px;
  }
}

.empty-icon {
  color: @text-muted;
  margin-bottom: 8px;
}

.empty-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

// 加载状态
.loading-state {
  .flex-col();
  align-items: center;
  justify-content: center;
  gap: 16px;
  height: 100%;
  min-height: 400px;
  color: @text-secondary;
}

.spinner {
  .spinner-base(36px, 3px);
}

// 拖拽覆盖层
.drag-overlay {
  position: fixed;
  inset: 0;
  background: rgba(124, 58, 237, 0.15);
  border: 2px dashed @accent-light;
  z-index: 1000;
  .flex-center();
  pointer-events: none;
}

.drag-hint {
  .flex-col();
  align-items: center;
  gap: 12px;
  color: @accent-light;
  font-size: 16px;
  font-weight: 600;
}
</style>
