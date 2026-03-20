<template>
  <div class="series-view">
    <!-- 顶栏 -->
    <div class="series-header">
      <button class="back-btn" @click="goBack">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <div class="header-info">
        <h1 class="series-title">{{ book?.title || '系列漫画' }}</h1>
        <span class="series-meta">{{ chapters.length }} 话 · {{ totalPages }} 页</span>
      </div>
      <button class="btn btn-ghost" @click="goEdit" title="编辑">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        编辑系列
      </button>
    </div>

    <!-- 加载 -->
    <div v-if="isLoading" class="loading-state">
      <div class="spinner" />
      <p>加载中...</p>
    </div>

    <!-- 章节网格 -->
    <div v-else class="chapter-grid">
      <BookCard
        v-for="ch in chapters"
        :key="ch.id"
        :chapter="ch"
        @open-chapter="readChapter"
        @edit-chapter="editChapter"
        @remove-chapter="removeChapter"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLibraryStore } from '../stores/library'
import BookCard from '../components/BookCard.vue'

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()

const chapters = ref<Chapter[]>([])
const isLoading = ref(true)

const book = computed(() => library.getBook(route.params.id as string))
const totalPages = computed(() => chapters.value.reduce((sum, c) => sum + c.pageCount, 0))

onMounted(async () => {
  if (!book.value) { router.push('/'); return }
  isLoading.value = true
  try {
    chapters.value = await window.electronAPI.getChapters(book.value.path)
  } finally {
    isLoading.value = false
  }
})

function readChapter(ch: Chapter): void {
  library.setReaderContext({
    bookPath: ch.path,
    bookType: 'folder',
    title: `${book.value?.title} · ${ch.title}`,
    seriesId: route.params.id as string,
    chapterIndex: ch.index,
    totalChapters: chapters.value.length
  })
  router.push(`/reader/${ch.id}`)
}

function goBack(): void {
  router.push('/')
}

function goEdit(): void {
  router.push(`/edit/${route.params.id}`)
}

function editChapter(ch: Chapter): void {
  const q = new URLSearchParams({
    chapterPath: encodeURIComponent(ch.path),
    chapterTitle: encodeURIComponent(ch.title),
    fromSeries: String(route.params.id)
  })
  router.push(`/edit/${route.params.id}?${q.toString()}`)
}

async function removeChapter(ch: Chapter): Promise<void> {
  const ok = window.confirm(`确认删除「${ch.title}」吗？`)
  if (!ok) return
  await window.electronAPI.removeBook(ch.path)
  if (!book.value) return
  chapters.value = await window.electronAPI.getChapters(book.value.path)
  await library.refreshLibrary()
}
</script>

<style scoped lang="less">
.series-view {
  width: 100%;
  height: 100%;
  .flex-col();
  background: @bg-primary;
  overflow: hidden;
}

.series-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  height: 60px;
  background: rgba(10, 10, 15, 0.9);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid @border;
  flex-shrink: 0;
}

.back-btn {
  .flex-center();
  width: 32px;
  height: 32px;
  border-radius: @radius-sm;
  background: transparent;
  border: 1px solid @border;
  color: @text-secondary;
  cursor: pointer;
  transition: all @transition;
  flex-shrink: 0;

  &:hover {
    background: @bg-hover;
    color: @text-primary;
  }
}

.header-info {
  flex: 1;
  overflow: hidden;
}

.series-title {
  font-size: 16px;
  font-weight: 700;
  color: @text-primary;
  .text-truncate();
}

.series-meta {
  font-size: 12px;
  color: @text-muted;
}

.loading-state {
  flex: 1;
  .flex-col();
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: @text-secondary;
}

.spinner {
  .spinner-base(32px, 3px);
}

.chapter-grid {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 20px;
  align-content: start;
}
</style>
