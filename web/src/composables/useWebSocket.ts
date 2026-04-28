import { ref, onUnmounted } from 'vue';
import { usePlayerStore } from '../stores/player';
import { useAuthStore } from '../stores/auth';
import { useToast } from './useToast';

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

interface WsMessage {
  type: string;
  [key: string]: unknown;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const MAX_RETRIES = 10;

function isValidMessage(data: unknown): data is WsMessage {
  return typeof data === 'object' && data !== null && 'type' in data && typeof (data as WsMessage).type === 'string';
}

function getReconnectDelay(retryCount: number): number {
  const jitter = Math.random() * 500;
  const delay = RECONNECT_BASE_MS * Math.pow(2, retryCount) + jitter;
  return Math.min(delay, RECONNECT_MAX_MS);
}

export function useWebSocket() {
  const connected = ref(false);
  const connectionState = ref<ConnectionState>('disconnected');
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;
  const toast = useToast();

  function connect() {
    if (ws?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${protocol}//${window.location.host}/ws`;

    const authStore = useAuthStore();
    const token = authStore.getToken();
    if (token) {
      url += `?token=${encodeURIComponent(token)}`;
    }

    connectionState.value = 'reconnecting';
    ws = new WebSocket(url);

    ws.onopen = () => {
      connected.value = true;
      connectionState.value = 'connected';
      retryCount = 0;
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        console.warn('WebSocket received invalid JSON');
        return;
      }

      if (!isValidMessage(data)) {
        console.warn('WebSocket received message without type field', data);
        return;
      }

      const store = usePlayerStore();

      switch (data.type) {
        case 'init':
          if (Array.isArray(data.bots)) {
            for (const bot of data.bots) {
              if (bot && typeof bot.id === 'string') {
                store.updateBotStatus(bot.id, bot as any);
              }
            }
          }
          break;
        case 'stateChange':
          if (typeof data.botId === 'string') {
            store.updateBotStatus(data.botId, data.status as any);
            if (Array.isArray(data.queue)) {
              store.setQueue(data.botId, data.queue as any);
            } else {
              store.fetchQueueForBot(data.botId);
            }
          }
          break;
        case 'botConnected':
          if (typeof data.botId === 'string') {
            store.updateBotStatus(data.botId, data.status as any);
          }
          break;
        case 'botDisconnected':
          if (typeof data.botId === 'string') {
            if (data.status) {
              store.updateBotStatus(data.botId, data.status as any);
            } else {
              const existing = store.bots.find((b) => b.id === data.botId);
              if (existing) {
                store.updateBotStatus(data.botId as string, {
                  ...existing,
                  connected: false,
                  playing: false,
                  paused: false,
                  currentSong: null,
                });
              }
            }
          }
          break;
        case 'botRemoved':
          if (typeof data.botId === 'string') {
            store.removeBotStatus(data.botId);
            if (store.activeBotId === data.botId) {
              store.activeBotId = store.bots[0]?.id ?? null;
            }
          }
          break;
        default:
          console.warn('Unknown WebSocket message type:', data.type);
      }
    };

    ws.onclose = (event) => {
      connected.value = false;

      // Auth failure — stop reconnecting
      if (event.code === 4001) {
        connectionState.value = 'disconnected';
        console.warn('WebSocket auth failed, stopping reconnection');
        toast.error('WebSocket 认证失败，请重新登录');
        return;
      }

      // Normal close (e.g., page unload) — don't reconnect
      if (event.wasClean && event.code === 1000) {
        connectionState.value = 'disconnected';
        return;
      }

      if (retryCount >= MAX_RETRIES) {
        connectionState.value = 'disconnected';
        toast.error('WebSocket 连接失败，已达最大重试次数');
        return;
      }

      const delay = getReconnectDelay(retryCount);
      retryCount++;
      console.log(`WebSocket reconnecting in ${Math.round(delay)}ms (attempt ${retryCount})`);
      connectionState.value = 'reconnecting';
      reconnectTimer = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    retryCount = 0;
    ws?.close();
  }

  onUnmounted(disconnect);

  return { connected, connectionState, connect, disconnect };
}
