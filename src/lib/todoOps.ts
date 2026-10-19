// やることの型と、リストへの操作。ブラウザ（localStorage）とサーバー（LINE 連携）の両方で使う。

import { isDue } from "./due";

export type Todo = {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
  // 期限（"2026-10-25"）。なければキーを入れない
  due?: string;
};

// 追加するときに送るもの
export type NewTodo = { title: string; due?: string };

// 削除した項目と元の位置。「元に戻す」で同じ場所に戻す
export type RemovedItem = { todo: Todo; index: number };

export type TodoOp =
  | { type: "add"; items: NewTodo[] }
  | { type: "toggle"; id: string }
  | { type: "remove"; ids: string[] }
  // id を beforeId の前、または afterId の後ろに動かす。
  // 位置の番号でなく隣の項目で指すので、その間に LINE から追加されても狙った場所に入る
  | { type: "move"; id: string; beforeId?: string; afterId?: string }
  | { type: "restore"; items: RemovedItem[] };

export const MAX_TITLE = 100;
// 一度に追加できる件数（LINE で長い文章を送られたときのため）
export const MAX_ADD = 20;

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 前後の空白を除き、長すぎる分は切る。空なら null
export function normalizeTitle(title: string): string | null {
  const trimmed = title.trim();
  return trimmed ? trimmed.slice(0, MAX_TITLE) : null;
}

export function isTodo(value: unknown): value is Todo {
  const t = value as Todo;
  return (
    typeof t === "object" &&
    t !== null &&
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    typeof t.done === "boolean" &&
    typeof t.createdAt === "number" &&
    (t.due === undefined || isDue(t.due))
  );
}

// サーバーで受け取った操作が正しい形かを確かめる
export function isTodoOp(value: unknown): value is TodoOp {
  const op = value as TodoOp;
  if (typeof op !== "object" || op === null) return false;
  const isStrings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string");
  switch (op.type) {
    case "add":
      return (
        Array.isArray(op.items) &&
        op.items.every((i) => typeof i?.title === "string" && (i.due === undefined || isDue(i.due)))
      );
    case "toggle":
      return typeof op.id === "string";
    case "remove":
      return isStrings(op.ids);
    case "move":
      return (
        typeof op.id === "string" &&
        (typeof op.beforeId === "string") !== (typeof op.afterId === "string")
      );
    case "restore":
      return (
        Array.isArray(op.items) &&
        op.items.every((i) => isTodo(i?.todo) && Number.isInteger(i?.index))
      );
    default:
      return false;
  }
}

export function applyOp(todos: Todo[], op: TodoOp, now = Date.now()): Todo[] {
  switch (op.type) {
    case "add": {
      const added = op.items
        .flatMap(({ title, due }): NewTodo[] => {
          const normalized = normalizeTitle(title);
          return normalized ? [{ title: normalized, due }] : [];
        })
        .slice(0, MAX_ADD)
        .map(({ title, due }): Todo => ({
          id: newId(),
          title,
          done: false,
          createdAt: now,
          ...(due && isDue(due) ? { due } : {}),
        }));
      // 新しいものを上に。送った順に上から並ぶようにする
      return [...added, ...todos];
    }
    case "toggle":
      return todos.map((t) => (t.id === op.id ? { ...t, done: !t.done } : t));
    case "remove": {
      const ids = new Set(op.ids);
      return todos.filter((t) => !ids.has(t.id));
    }
    case "move": {
      const moving = todos.find((t) => t.id === op.id);
      const rest = todos.filter((t) => t.id !== op.id);
      const ref = rest.findIndex((t) => t.id === (op.beforeId ?? op.afterId));
      // 動かすものか目印がもう消えていたら何もしない
      if (!moving || ref === -1) return todos;
      rest.splice(op.beforeId !== undefined ? ref : ref + 1, 0, moving);
      return rest;
    }
    case "restore": {
      const next = [...todos];
      const existing = new Set(todos.map((t) => t.id));
      // 元の位置の小さい順に差し込めば、もとの並びに戻る
      const items = [...op.items].sort((a, b) => a.index - b.index);
      for (const { todo, index } of items) {
        if (existing.has(todo.id)) continue;
        const title = normalizeTitle(todo.title);
        if (!title) continue;
        next.splice(Math.max(0, Math.min(index, next.length)), 0, { ...todo, title });
      }
      return next;
    }
  }
}

// 削除する前に、元に戻すための情報を取っておく
export function collectRemoved(todos: Todo[], ids: string[]): RemovedItem[] {
  const set = new Set(ids);
  return todos.map((todo, index) => ({ todo, index })).filter(({ todo }) => set.has(todo.id));
}
