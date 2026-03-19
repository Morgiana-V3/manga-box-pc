<template>
  <div class="settings-overlay" @click.self="$emit('close')">
    <div class="settings-panel">
      <div class="settings-header">
        <h2>设置</h2>
        <button class="btn-icon" @click="$emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="settings-body">
        <!-- 书库路径 -->
        <section class="settings-section">
          <h3>书库路径</h3>
          <div class="path-row">
            <input
              :value="library.libraryPath || '加载中...'"
              class="path-input"
              readonly
              :title="library.libraryPath"
            />
            <button class="btn btn-ghost" @click="changeLibraryPath">更改</button>
            <button
              class="btn btn-ghost btn-icon-only"
              title="在文件管理器中打开"
              @click="openLibraryDir"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </button>
          </div>
          <div v-if="isCustomPath" class="path-hint">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            已使用自定义路径。
            <button class="link-btn" @click="resetLibraryPath">恢复默认目录</button>
          </div>
          <p class="setting-desc">漫画导入时会复制到此目录。默认为 App 数据目录下的 manga-library 文件夹，也可指定已有的漫画收藏目录（不会复制，仅扫描）。</p>
        </section>

        <!-- 阅读默认设置 -->
        <section class="settings-section">
          <h3>阅读设置</h3>
          <div class="setting-row">
            <label>默认阅读模式</label>
            <select v-model="defaultReadMode" class="setting-select">
              <option value="single">单页</option>
              <option value="double">双页</option>
              <option value="scroll">长条滚动</option>
            </select>
          </div>
          <div class="setting-row">
            <label>阅读方向</label>
            <select v-model="readDirection" class="setting-select">
              <option value="ltr">从左到右（普通漫画）</option>
              <option value="rtl">从右到左（日式漫画）</option>
            </select>
          </div>
        </section>

        <!-- 关于 -->
        <section class="settings-section">
          <h3>关于</h3>
          <div class="about-info">
            <p class="app-name-big">MangaBox</p>
            <p class="version-text">Version 1.0.0</p>
            <p class="about-desc">一个简洁的本地漫画阅读器，支持文件夹和 ZIP/CBZ 格式</p>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useLibraryStore } from '../stores/library'

defineEmits<{ (e: 'close'): void }>()

const library = useLibraryStore()
const defaultReadMode = ref<string>('single')
const readDirection = ref<string>('ltr')
const defaultLibraryDir = ref<string>('')

/** 判断是否使用了自定义路径（非 App 默认目录） */
const isCustomPath = computed<boolean>(() => {
  return !!defaultLibraryDir.value && library.libraryPath !== defaultLibraryDir.value
})

onMounted(async () => {
  defaultLibraryDir.value = await window.electronAPI.getDefaultLibraryDir()
  const mode = await window.electronAPI.storeGet('readMode')
  if (mode) defaultReadMode.value = mode as string
  const dir = await window.electronAPI.storeGet('readDirection')
  if (dir) readDirection.value = dir as string
})

async function changeLibraryPath(): Promise<void> {
  const p = await window.electronAPI.openFolder()
  if (p) await library.setLibraryPath(p)
}

async function resetLibraryPath(): Promise<void> {
  await library.resetLibraryPath()
}

function openLibraryDir(): void {
  if (library.libraryPath) {
    window.electronAPI.openPath(library.libraryPath)
  }
}

async function saveSettings(): Promise<void> {
  await window.electronAPI.storeSet('readMode', defaultReadMode.value)
  await window.electronAPI.storeSet('readDirection', readDirection.value)
}

watch([defaultReadMode, readDirection], saveSettings)
</script>

<style scoped lang="less">
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 500;
  .flex-center();
}

.settings-panel {
  background: @bg-secondary;
  border: 1px solid @border;
  border-radius: @radius-lg;
  width: 520px;
  max-height: 80vh;
  .flex-col();
  box-shadow: @shadow-card;
  animation: fadeIn 0.2s ease;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid @border;

  h2 {
    font-size: 16px;
    font-weight: 700;
    color: @text-primary;
  }
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  .flex-col();
  gap: 28px;
}

.settings-section {
  h3 {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: @accent-light;
    margin-bottom: 14px;
  }
}

.path-row {
  display: flex;
  gap: 10px;
}

.path-input {
  flex: 1;
  background: @bg-card;
  border: 1px solid @border;
  border-radius: @radius-sm;
  padding: 8px 12px;
  color: @text-secondary;
  font-size: 12px;
  font-family: monospace;
  outline: none;
}

.btn-icon-only {
  padding: 7px 9px;
  flex-shrink: 0;
}

.path-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: @accent-light;
  margin-top: 6px;
}

.link-btn {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 11px;
  color: @accent-light;
  text-decoration: underline;
  text-underline-offset: 2px;

  &:hover {
    color: @text-primary;
  }
}

.setting-desc {
  font-size: 12px;
  color: @text-muted;
  margin-top: 8px;
  line-height: 1.6;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid @border;

  &:last-child {
    border-bottom: none;
  }

  label {
    font-size: 13px;
    color: @text-secondary;
  }
}

.setting-select {
  background: @bg-card;
  border: 1px solid @border;
  border-radius: @radius-sm;
  padding: 6px 10px;
  color: @text-primary;
  font-size: 12px;
  outline: none;
  cursor: pointer;
  transition: border-color @transition;

  &:focus {
    border-color: @border-accent;
  }
}

.about-info {
  text-align: center;
  padding: 12px 0;
}

.app-name-big {
  font-size: 22px;
  font-weight: 800;
  .gradient-text();
  margin-bottom: 4px;
}

.version-text {
  font-size: 12px;
  color: @text-muted;
  margin-bottom: 10px;
}

.about-desc {
  font-size: 12px;
  color: @text-secondary;
  line-height: 1.6;
}
</style>
