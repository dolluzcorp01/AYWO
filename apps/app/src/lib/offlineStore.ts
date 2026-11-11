// Where the saved copy lives: a file in the app's own folder on a phone, localStorage in a browser. Writes are bunched
// up (at most one a second) because the copy is saved again after every change in the app.
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { Platform } from 'react-native';
import { setSavedAt } from '@/lib/offline';
import { scrub } from '@/lib/offlineKeep';

const NAME = 'aywo-offline-v1';
const WRITE_EVERY_MS = 1000;

interface Storage {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  remove(): Promise<void>;
}

function browserStorage(): Storage {
  // Private browsing and some embedded views throw on any storage use; the app then simply has no saved copy.
  return {
    read: async () => {
      try {
        return window.localStorage.getItem(NAME);
      } catch {
        return null;
      }
    },
    write: async (text) => {
      try {
        window.localStorage.setItem(NAME, text);
      } catch {
        // Full or blocked: skip this save.
      }
    },
    remove: async () => {
      try {
        window.localStorage.removeItem(NAME);
      } catch {
        // Nothing to remove.
      }
    },
  };
}

function phoneStorage(): Storage {
  // Loaded only on a phone, so the web build never touches the native module.
  const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  const file = () => new File(Paths.document, `${NAME}.json`);
  return {
    read: async () => {
      const f = file();
      return f.exists ? f.text() : null;
    },
    write: async (text) => {
      const f = file();
      if (!f.exists) f.create();
      await f.write(text);
    },
    remove: async () => {
      const f = file();
      if (f.exists) f.delete();
    },
  };
}

const storage: Storage = Platform.OS === 'web' ? browserStorage() : phoneStorage();

let pending: PersistedClient | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

function cleaned(client: PersistedClient): PersistedClient {
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.map((q) => ({ ...q, state: { ...q.state, data: scrub(q.queryKey[0], q.state.data) } })),
    },
  };
}

export const offlinePersister: Persister = {
  persistClient: async (client) => {
    pending = client;
    const mine = generation;
    timer ??= setTimeout(() => {
      timer = null;
      const next = pending;
      pending = null;
      // A sign-out in the meantime wins: never write the last person's family back.
      if (next && mine === generation) void storage.write(JSON.stringify(cleaned(next))).catch(() => undefined);
    }, WRITE_EVERY_MS);
  },
  restoreClient: async () => {
    try {
      const text = await storage.read();
      if (!text) return undefined;
      const client = JSON.parse(text) as PersistedClient;
      if (client.timestamp) setSavedAt(client.timestamp);
      return client;
    } catch {
      return undefined;
    }
  },
  removeClient: async () => {
    generation += 1;
    pending = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await storage.remove().catch(() => undefined);
  },
};
