<template>
  <div class="flex flex-col gap-6 lg:flex-row">
    <!-- Tab nav -->
    <nav role="tablist" class="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible lg:shrink-0 lg:w-44">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        role="tab"
        :aria-selected="active === tab.key"
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap text-left"
        :class="active === tab.key
          ? 'bg-primary/10 text-primary'
          : 'text-foreground-muted hover:text-foreground hover:bg-interactive-hover'"
        @click="select(tab.key)"
      >
        <Icon v-if="tab.icon" :icon="tab.icon" class="inline-block mr-2 text-base" aria-hidden="true" />
        {{ tab.label }}
      </button>
    </nav>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <slot :active-tab="active" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Icon } from '@iconify/vue';

export interface TabDef {
  key: string;
  label: string;
  icon?: string;
}

const props = defineProps<{
  tabs: TabDef[];
  defaultTab?: string;
  /** 受控模式：传入后由父组件持有状态（供 ?tab= 深链同步） */
  activeTab?: string;
}>();

const emit = defineEmits<{
  (e: 'update:activeTab', value: string): void;
}>();

const internal = ref(
  props.activeTab ??
  props.tabs.find((t) => t.key === props.defaultTab)?.key ??
  props.tabs[0]?.key ??
  ''
);

const active = computed(() => props.activeTab ?? internal.value);

function select(key: string) {
  internal.value = key;
  emit('update:activeTab', key);
}
</script>
