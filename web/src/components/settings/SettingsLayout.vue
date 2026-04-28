<template>
  <div class="flex flex-col gap-6 lg:flex-row">
    <!-- Tab nav -->
    <nav class="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible lg:shrink-0 lg:w-44">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap text-left"
        :class="activeTab === tab.key
          ? 'bg-primary/10 text-primary'
          : 'text-foreground-muted hover:text-foreground hover:bg-interactive-hover'"
        @click="activeTab = tab.key"
      >
        <Icon v-if="tab.icon" :icon="tab.icon" class="inline-block mr-2 text-base" />
        {{ tab.label }}
      </button>
    </nav>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <slot :active-tab="activeTab" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Icon } from '@iconify/vue';

export interface TabDef {
  key: string;
  label: string;
  icon?: string;
}

const props = defineProps<{ tabs: TabDef[]; defaultTab?: string }>();
const activeTab = ref(props.defaultTab ?? props.tabs[0]?.key ?? '');
</script>
