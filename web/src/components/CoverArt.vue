<template>
  <div class="cover-art" :style="{ width: size + 'px', height: size + 'px', borderRadius: radius + 'px' }">
    <img
      v-if="url && !errored"
      :src="url"
      alt=""
      class="cover-img"
      :class="{ visible: loaded }"
      :style="{ borderRadius: radius + 'px' }"
      loading="lazy"
      referrerpolicy="no-referrer"
      @load="onImageLoad"
      @error="onImageError"
    />
    <div
      v-if="!loaded || errored"
      class="cover-placeholder"
      :class="{ 'has-dominant': dominantColor }"
      :style="{
        borderRadius: radius + 'px',
        backgroundColor: dominantColor || undefined,
      }"
    >
      <svg v-if="!dominantColor" viewBox="0 0 24 24" class="placeholder-icon"><path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
    </div>
    <div
      v-if="showShadow && url && !errored"
      class="cover-shadow"
      :style="{
        backgroundImage: `url(${url})`,
        borderRadius: radius + 'px',
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  url: string;
  size?: number;
  radius?: number;
  showShadow?: boolean;
}>(), {
  size: 48,
  radius: 8,
  showShadow: false,
});

const loaded = ref(false);
const errored = ref(false);
const dominantColor = ref<string | null>(null);

function extractDominantColor(url: string): void {
  dominantColor.value = null;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // Sample a small version for performance
      const w = 32;
      const h = 32;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let r = 0, g = 0, b = 0, count = 0;
      // Sample every 4th pixel for speed
      for (let i = 0; i < data.length; i += 16) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
      if (count > 0) {
        dominantColor.value = `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`;
      }
    } catch {
      // ignore — fall back to default placeholder
    }
  };
  img.onerror = () => {
    // ignore
  };
  img.src = url;
}

// Reset state when URL changes
watch(() => props.url, (url) => {
  errored.value = false;
  loaded.value = false;
  if (url) {
    extractDominantColor(url);
  } else {
    dominantColor.value = null;
  }
}, { immediate: true });

function onImageLoad() {
  loaded.value = true;
}

function onImageError() {
  errored.value = true;
}
</script>

<style scoped>
.cover-art {
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--bg-card);
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  display: block;
  opacity: 0;
  transition: opacity 0.3s ease;
}
.cover-img.visible {
  opacity: 1;
}

.cover-placeholder {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--hover-bg);
}
.cover-placeholder.has-dominant {
  filter: blur(8px);
}

.placeholder-icon {
  width: 40%;
  height: 40%;
  color: var(--text-tertiary);
  opacity: 0.4;
}

.cover-shadow {
  position: absolute;
  top: 12px;
  left: 0;
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
  filter: blur(16px);
  opacity: 0.6;
  transform: scale(0.92);
  z-index: 0;
  transition: opacity 0.3s ease;
}
</style>
