// The one way the app talks to the server. Keeps the session, refreshes it, and turns failures into ApiFailure.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const ACCESS = 'aywo.access';
const REFRESH = 'aywo.refresh';
// Staff only, on the web: proof of the second sign-in step, sent with every /admin call. Lasts 12 hours.
const STAFF_PROOF = 'aywo.staffProof';

// Sessions stay in the phone's secure store; on web the browser's own storage is used.
export const deviceStore = {
  get: (key: string): Promise<string | null> =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null) : SecureStore.getItemAsync(key),
  set: (key: string, value: string): Promise<void> => {
    if (Platform.OS !== 'web') return SecureStore.setItemAsync(key, value);
    globalThis.localStorage?.setItem(key, value);
    return Promise.resolve();
  },
  remove: (key: string): Promise<void> => {
    if (Platform.OS !== 'web') return SecureStore.deleteItemAsync(key);
    globalThis.localStorage?.removeItem(key);
    return Promise.resolve();
  },
};

export class ApiFailure extends Error {
  status: number;
  code: string;
  /** An i18n key for showing the failure in the user's language. */
  messageKey: string;
  constructor(status: number, code: string, messageKey: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.messageKey = messageKey;
  }
}

let refreshing: Promise<boolean> | null = null;

// The sign-in gate listens here, so an ended session sends the person back to Welcome from any screen.
const sessionListeners = new Set<(signedIn: boolean) => void>();

export function onSessionChange(listener: (signedIn: boolean) => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

async function refreshSession(): Promise<boolean> {
  const token = await deviceStore.get(REFRESH);
  if (!token) return false;
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: token }),
  });
  if (!response.ok) {
    await clearSession();
    return false;
  }
  await saveSession(await response.json());
  return true;
}

export async function saveSession(session: { access_token: string; refresh_token: string }): Promise<void> {
  await deviceStore.set(ACCESS, session.access_token);
  await deviceStore.set(REFRESH, session.refresh_token);
  sessionListeners.forEach((listener) => listener(true));
}

export async function clearSession(): Promise<void> {
  await deviceStore.remove(ACCESS);
  await deviceStore.remove(REFRESH);
  await deviceStore.remove(STAFF_PROOF);
  sessionListeners.forEach((listener) => listener(false));
}

export async function hasSession(): Promise<boolean> {
  return (await deviceStore.get(REFRESH)) !== null;
}

export async function accessToken(): Promise<string | null> {
  return deviceStore.get(ACCESS);
}

/** Ends this device's session on the server too. The device forgets it even when the server cannot be reached. */
export async function signOut(): Promise<void> {
  const token = await deviceStore.get(REFRESH);
  if (token) {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: token }),
    }).catch(() => undefined);
  }
  await clearSession();
}

export function saveStaffProof(proof: string): Promise<void> {
  return deviceStore.set(STAFF_PROOF, proof);
}

export function forgetStaffProof(): Promise<void> {
  return deviceStore.remove(STAFF_PROOF);
}

async function send(method: string, path: string, body: unknown): Promise<Response> {
  const token = await deviceStore.get(ACCESS);
  const proof = path.startsWith('/admin') ? await deviceStore.get(STAFF_PROOF) : null;
  return fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(proof ? { 'X-Staff-Proof': proof } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function sendWithRefresh(method: string, path: string, body?: unknown): Promise<Response> {
  let response = await send(method, path, body);
  if (response.status === 401) {
    // Several calls may fail together; they share one refresh.
    refreshing ??= refreshSession().finally(() => {
      refreshing = null;
    });
    if (await refreshing) response = await send(method, path, body);
  }
  return response;
}

function parseJson(text: string): { code?: string; message_key?: string } | null {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await sendWithRefresh(method, path, body);
  const text = await response.text();
  if (!response.ok) {
    const failure = parseJson(text);
    throw new ApiFailure(response.status, failure?.code ?? 'server_error', failure?.message_key ?? 'errors.server_error');
  }
  if (!text) return null as T;
  // A database function that returns one uuid or word comes back as plain text, not JSON.
  const type = response.headers.get('content-type') ?? '';
  return (type.includes('json') ? JSON.parse(text) : text) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  /** A plain-text answer, such as a GEDCOM file. */
  text: async (path: string): Promise<string> => {
    const response = await sendWithRefresh('GET', path);
    const text = await response.text();
    if (!response.ok) {
      const failure = parseJson(text);
      throw new ApiFailure(response.status, failure?.code ?? 'server_error', failure?.message_key ?? 'errors.server_error');
    }
    return text;
  },
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  /** Calls a listed database function, for example rpc('person_card', {p_person: id}). */
  rpc: <T>(name: string, args: Record<string, unknown> = {}) => request<T>('POST', `/rpc/${name}`, args),
};

export interface PickedFile {
  uri: string;
  contentType: string;
  extension: string;
}

/** Uploads straight to storage with a signed link and returns the stored path. */
export async function uploadFile(kind: 'photos' | 'imports' | 'chat' | 'posts', file: PickedFile): Promise<string> {
  const { upload_url: url, path } = await api.post<{ upload_url: string; path: string }>('/uploads/presign', {
    kind,
    content_type: file.contentType,
    extension: file.extension,
  });
  const blob = await (await fetch(file.uri)).blob();
  // A refused or unreachable file store is an upload problem, not "no connection": the API answered a moment ago.
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': file.contentType }, body: blob }).catch(() => null);
  if (!response?.ok) throw new ApiFailure(response?.status ?? 0, 'upload_failed', 'errors.upload_failed');
  return path;
}
