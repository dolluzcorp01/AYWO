// Live messages over GET /ws. The token goes in the first message, never in the address.
// The answer says whether the socket is up: when it is not, screens fetch on a timer instead.
import { useEffect, useRef, useState } from 'react';
import { accessToken, api, API_URL } from '@/lib/api';
import type { Message } from '@/social/types';

const FIRST_RETRY_MS = 1_000;
const LONGEST_RETRY_MS = 30_000;
// A connection can die without the phone being told (a tunnel, a sleeping radio, a changed network). Asking the server
// "are you there?" now and then is the only way to notice, so that screens go back to fetching on a timer.
const PING_EVERY_MS = 25_000;
const PONG_WAIT_MS = 10_000;

export const FETCH_WHEN_OFFLINE_MS = 15_000;

export function useChatSocket(onMessage: (message: Message) => void, onReady?: () => void): boolean {
  const [connected, setConnected] = useState(false);
  const latest = useRef({ onMessage, onReady });
  latest.current = { onMessage, onReady };

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let dropCurrent: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = FIRST_RETRY_MS;

    const retry = () => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
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
      let over = false;
      let pingTimer: ReturnType<typeof setInterval> | undefined;
      let pongTimer: ReturnType<typeof setTimeout> | undefined;
      let waitingForPong = false;

      // Ends this connection once, however it ended, and tries again. A dead connection may never say it has closed,
      // so this does not wait for the close event.
      const drop = () => {
        if (over) return;
        over = true;
        if (pingTimer) clearInterval(pingTimer);
        if (pongTimer) clearTimeout(pongTimer);
        if (dropCurrent === drop) dropCurrent = null;
        open.onopen = null;
        open.onmessage = null;
        open.onerror = null;
        open.onclose = null;
        try {
          open.close();
        } catch {
          // Already closed.
        }
        if (stopped) return;
        setConnected(false);
        retry();
      };
      dropCurrent = drop;

      const ping = () => {
        if (waitingForPong) return;
        try {
          open.send(JSON.stringify({ type: 'ping' }));
        } catch {
          drop();
          return;
        }
        waitingForPong = true;
        pongTimer = setTimeout(() => {
          if (waitingForPong) drop();
        }, PONG_WAIT_MS);
      };

      open.onopen = () => open.send(JSON.stringify({ type: 'auth', token: sent }));
      open.onmessage = (event) => {
        // Anything from the server shows the connection is alive.
        waitingForPong = false;
        if (pongTimer) clearTimeout(pongTimer);
        try {
          const data = JSON.parse(String(event.data)) as { type: string; message?: Message };
          if (data.type === 'ready') {
            delay = FIRST_RETRY_MS;
            setConnected(true);
            if (!pingTimer) pingTimer = setInterval(ping, PING_EVERY_MS);
            latest.current.onReady?.();
          } else if (data.type === 'message' && data.message) {
            latest.current.onMessage(data.message);
          }
        } catch {
          // A frame that cannot be read is skipped; the next fetch fills any gap.
        }
      };
      open.onerror = () => drop();
      open.onclose = () => drop();
    }

    void connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (dropCurrent) dropCurrent();
      else socket?.close();
    };
  }, []);

  return connected;
}
