<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <div
          class="absolute inset-0 bg-black/50 backdrop-blur-sm"
          @click="close"
        />
        <div
          ref="modalRef"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="title ? 'modal-title' : undefined"
          tabindex="-1"
          class="relative w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl bg-surface-elevated p-6 shadow-xl"
          @click.stop
        >
          <div v-if="title" class="mb-5">
            <h3 id="modal-title" class="text-xl font-bold">{{ title }}</h3>
          </div>
          <slot />
          <div v-if="$slots.footer" class="mt-6 flex justify-end gap-3">
            <slot name="footer" :close="close" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';

const props = defineProps<{ modelValue: boolean; title?: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const modalRef = ref<HTMLElement | null>(null);

function close() {
  emit('update:modelValue', false);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

watch(
  () => props.modelValue,
  (open, wasOpen) => {
    document.body.style.overflow = open ? 'hidden' : '';
    if (open && !wasOpen) {
      document.addEventListener('keydown', onKeydown);
      setTimeout(() => modalRef.value?.focus(), 0);
    } else if (!open && wasOpen) {
      document.removeEventListener('keydown', onKeydown);
    }
  }
);

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
});
</script>

<style>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
