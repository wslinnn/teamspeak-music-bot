<template>
  <button
    :disabled="disabled || loading"
    :type="type"
    :aria-busy="loading"
    class="inline-flex items-center justify-center rounded-md font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    :class="[variantClasses, sizeClasses, { 'opacity-50 cursor-not-allowed': disabled || loading }]"
  >
    <LoadingSpinner v-if="loading" size="sm" class="mr-2" />
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import LoadingSpinner from './LoadingSpinner.vue';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    loading?: boolean;
    type?: 'button' | 'submit' | 'reset';
  }>(),
  { variant: 'primary', size: 'md', type: 'button' }
);

const variantClasses = computed(() => {
  switch (props.variant) {
    case 'primary':
      return 'bg-primary text-white hover:brightness-110 active:scale-[0.98]';
    case 'secondary':
      return 'bg-interactive-hover text-foreground hover:bg-border-default active:scale-[0.98]';
    case 'danger':
      return 'bg-danger text-white hover:brightness-110 active:scale-[0.98]';
    case 'ghost':
      return 'bg-transparent text-foreground-muted hover:text-foreground hover:bg-interactive-hover';
  }
});

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm': return 'px-3 py-1.5 text-xs';
    case 'lg': return 'px-6 py-3 text-base';
    default: return 'px-4 py-2 text-sm';
  }
});
</script>
