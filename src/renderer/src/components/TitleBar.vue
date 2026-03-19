<template>
  <div class="titlebar" @dblclick="maximize">
    <div class="titlebar-left">
      <div class="app-logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14" stroke="url(#g1)" stroke-width="2" stroke-linecap="round"/>
          <path d="M4 19h14a2 2 0 010 4H4v-4z" fill="url(#g2)"/>
          <line x1="8" y1="7" x2="16" y2="7" stroke="url(#g1)" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="8" y1="11" x2="14" y2="11" stroke="url(#g1)" stroke-width="1.5" stroke-linecap="round"/>
          <defs>
            <linearGradient id="g1" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#a855f7"/>
              <stop offset="100%" stop-color="#7c3aed"/>
            </linearGradient>
            <linearGradient id="g2" x1="4" y1="19" x2="20" y2="23" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#a855f7"/>
              <stop offset="100%" stop-color="#7c3aed"/>
            </linearGradient>
          </defs>
        </svg>
      </div>
      <span class="app-title">MangaBox</span>
    </div>

    <div class="titlebar-drag" />

    <div class="titlebar-controls">
      <button class="ctrl-btn" @click="minimize" title="最小化">
        <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5.5" width="12" height="1" fill="currentColor"/></svg>
      </button>
      <button class="ctrl-btn" @click="maximize" title="最大化">
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
      </button>
      <button class="ctrl-btn close-btn" @click="close" title="关闭">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const minimize = () => window.electronAPI.minimizeWindow()
const maximize = () => window.electronAPI.maximizeWindow()
const close = () => window.electronAPI.closeWindow()
</script>

<style scoped lang="less">
.titlebar {
  height: 40px;
  background: @bg-sidebar;
  border-bottom: 1px solid @border;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  -webkit-app-region: drag;
  position: relative;
  z-index: 100;

  &-left {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    -webkit-app-region: no-drag;
  }

  &-drag {
    flex: 1;
  }

  &-controls {
    display: flex;
    align-items: center;
    -webkit-app-region: no-drag;
  }
}

.app-logo {
  display: flex;
  align-items: center;
}

.app-title {
  font-size: 13px;
  font-weight: 700;
  .gradient-text();
  letter-spacing: 0.5px;
}

.ctrl-btn {
  width: 46px;
  height: 40px;
  .flex-center();
  background: transparent;
  border: none;
  color: @text-secondary;
  cursor: pointer;
  transition: all @transition;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: @text-primary;
  }

  &.close-btn:hover {
    background: #e53e3e;
    color: #fff;
  }
}
</style>
