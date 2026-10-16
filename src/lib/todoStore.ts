// やることを localStorage に保存する小さなストア。
// useSyncExternalStore から使うので、読み書きのたびに購読者へ知らせる。

export type Todo = {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
};

const STORAGE_KEY = "todo-next:todos";

const listeners = new Set<() => void>();

// getSnapshot は同じ内容なら同じ配列を返す必要があるので、元の文字列ごとに覚えておく
let cachedRaw: string | null | undefined;
let cachedTodos: Todo[] = [];

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // プライベートブラウズなどで localStorage が使えないとき
    return null;
  }
}

function parse(raw: string | null): Todo[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (t): t is Todo =>
        typeof t?.id === "string" &&
        typeof t?.title === "string" &&
        typeof t?.done === "boolean",
    );
  } catch {
    return [];
  }
}

// localStorage に書けなかったときだけ、メモリ上の値を使う
let memoryTodos: Todo[] | null = null;

export function getSnapshot(): Todo[] {
  if (memoryTodos) return memoryTodos;
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedTodos = parse(raw);
  }
  return cachedTodos;
}

// サーバーでは localStorage がないので、読み込み中を表す null を返す
export function getServerSnapshot(): Todo[] | null {
  return null;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // 別のタブで変更されたときも画面を合わせる
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function saveTodos(todos: Todo[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  } catch {
    // 容量オーバーなどで保存できなくても、画面の操作は止めない
    memoryTodos = todos;
  }
  listeners.forEach((l) => l());
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
