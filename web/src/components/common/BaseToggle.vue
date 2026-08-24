<template>
  <label
    class="flex items-start gap-3 cursor-pointer select-none py-2"
    :class="{ 'opacity-50 cursor-not-allowed': disabled }"
  >
    <button
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :disabled="disabled"
      class="relative shrink-0 mt-0.5 inline-flex items-center h-6 w-11 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      :class="modelValue ? 'bg-primary' : 'bg-border-default'"
      @click.prevent="toggle"
    >
      <span
        class="inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 will-change-transform"
        :class="modelValue ? 'translate-x-[22px]' : 'translate-x-0.5'"
      />
    </button>
    <div class="flex-1 min-w-0">
      <div class="text-sm font-medium leading-snug">
        <slot name="label">{{ label }}</slot>
        <span v-if="warning" class="ml-1.5 text-xs text-warning align-middle">权限敏感</span>
      </div>
      <div v-if="hint || $slots.hint" class="text-xs opacity-65 leading-snug mt-0.5">
        <slot name="hint">{{ hint }}</slot>
      </div>
    </div>
  </label>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean;
  label?: string;
  hint?: string;
  disabled?: boolean;
  warning?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

function toggle() {
  if (props.disabled) return;
  emit('update:modelValue', !props.modelValue);
}
</script>
