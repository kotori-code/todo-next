// 一度 LINE のリンク（?l=）で開いたら、そのトークンをこのブラウザに覚えておく。
// 次からはリンクなしで開いても LINE のリストを出す。

const STORAGE_KEY = "todo-next:line-token";

const listeners = new Set<() => void>();

export function getLinkedToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getServerLinkedToken(): string | null {
  return null;
}

export function subscribeLinkedToken(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setLinkedToken(token: string | null): void {
  if (token === getLinkedToken()) return;
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 覚えられなくても、リンクで開けば使える
  }
  listeners.forEach((l) => l());
}
