// Live messages over GET /ws. The token goes in the first message, never in the address.
// The answer says whether the socket is up: when it is not, screens fetch on a timer instead.
import { useEffect, useRef, useState } from 'react';
import { accessToken, api, API_URL } from '@/lib/api';
import type { Message } from '@/social/types';

const FIRST_RETRY_MS = 1_000;
const LONGEST_RETRY_MS = 30_000;

export const FETCH_WHEN_OFFLINE_MS = 15_000;

export function useChatSocket(onMessage: (message: Message) => void, onReady?: () => void): boolean {
  const [connected, setConnected] = useState(false);
  const latest = useRef({ onMessage, onReady });
  latest.current = { onMessage, onReady };

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = FIRST_RETRY_MS;

    const retry = () => {
      if (stopped) return;
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, LONGEST_RETRY_MS);
    };

    async function connect() {
      if (stopped) return;
      let token: string | null = null;
      try {
        // Any signed-in call refreshes an expired session first, so the token read next is a good one.
        await api.rpc('social_home_counts');
        token = await accessToken();
      } catch {
        retry();
        return;
      }
      if (stopped || !token) return;
      const sent = token;
      const open = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/ws`);
      socket = open;
      open.onopen = () => open.send(JSON.stringify({ type: 'auth', token: sent }));
      open.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as { type: string; message?: Message };
          if (data.type === 'ready') {
            delay = FIRST_RETRY_MS;
            setConnected(true);
            latest.current.onReady?.();
          } else if (data.type === 'message' && data.message) {
            latest.current.onMessage(data.message);
          }
        } catch {
          // A frame that cannot be read is skipped; the next fetch fills any gap.
        }
      };
      open.onerror = () => open.close();
      open.onclose = () => {
        setConnected(false);
        retry();
      };
    }

    void connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, []);

  return connected;
}
