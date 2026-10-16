"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import {
  getServerSnapshot,
  getSnapshot,
  newId,
  saveTodos,
  subscribe,
  type Todo,
} from "@/lib/todoStore";

type Filter = "all" | "active" | "done";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "active", label: "未完了" },
  { value: "done", label: "完了" },
];

const MAX_TITLE = 100;
const UNDO_MS = 6000;

// 削除した項目と元の位置。「元に戻す」で同じ場所に戻す
type Removed = { message: string; items: { todo: Todo; index: number }[] };

export default function TodoApp() {
  const todos = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [title, setTitle] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [removed, setRemoved] = useState<Removed | null>(null);
  const [announce, setAnnounce] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  // 「元に戻す」は一定時間で消す
  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [removed]);

  if (todos === null) {
    return <Shell><p className="py-12 text-center text-slate-600 dark:text-slate-300">読み込み中…</p></Shell>;
  }

  const activeCount = todos.filter((t) => !t.done).length;
  const doneCount = todos.length - activeCount;
  const visible = todos.filter((t) =>
    filter === "all" ? true : filter === "active" ? !t.done : t.done,
  );
  const trimmed = title.trim();

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    saveTodos([
      { id: newId(), title: trimmed, done: false, createdAt: Date.now() },
      ...todos!,
    ]);
    setTitle("");
    setAnnounce(`「${trimmed}」を追加しました`);
    // 続けて入力できるように入力欄に戻す
    inputRef.current?.focus();
    // 追加したものが見えるように、完了の絞り込み中なら外す
    if (filter === "done") setFilter("all");
  }

  function toggle(id: string) {
    const target = todos!.find((t) => t.id === id);
    if (!target) return;
    saveTodos(todos!.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    setAnnounce(`「${target.title}」を${target.done ? "未完了に戻しました" : "完了にしました"}`);
  }

  function removeWhere(pred: (t: Todo) => boolean, message: string) {
    const items = todos!
      .map((todo, index) => ({ todo, index }))
      .filter(({ todo }) => pred(todo));
    if (items.length === 0) return;
    saveTodos(todos!.filter((t) => !pred(t)));
    setRemoved({ message, items });
    setAnnounce(`${message}。元に戻すこともできます`);
  }

  function undo() {
    if (!removed) return;
    const next = [...todos!];
    // 元の位置の小さい順に差し込めば、もとの並びに戻る
    for (const { todo, index } of removed.items) {
      next.splice(Math.min(index, next.length), 0, todo);
    }
    saveTodos(next);
    setRemoved(null);
    setAnnounce("元に戻しました");
  }

  return (
    <Shell>
      <form onSubmit={add} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-base font-semibold">
          新しいやること
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE}
            placeholder="例：牛乳を買う"
            autoComplete="off"
            enterKeyHint="done"
            className="min-h-12 min-w-0 flex-1 rounded-lg border-2 border-slate-400 bg-white px-4 text-lg text-slate-900 placeholder:text-slate-500 focus:border-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 dark:border-slate-500 dark:bg-slate-900 dark:text-slate-50 dark:placeholder:text-slate-400 dark:focus:border-blue-400 dark:focus:ring-blue-900"
          />
          <button
            type="submit"
            disabled={!trimmed}
            className="min-h-12 shrink-0 rounded-lg bg-blue-700 px-5 text-lg font-bold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-300"
          >
            追加
          </button>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Enter キーでも追加できます（{title.length}/{MAX_TITLE} 文字）
        </p>
      </form>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="表示する項目" className="flex gap-1 rounded-lg bg-slate-200 p-1 dark:bg-slate-800">
          {FILTERS.map(({ value, label }) => {
            const count = value === "all" ? todos.length : value === "active" ? activeCount : doneCount;
            const selected = filter === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => setFilter(value)}
                className={`min-h-11 rounded-md px-3 text-base font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 ${
                  selected
                    ? "bg-white text-blue-800 shadow dark:bg-slate-950 dark:text-blue-300"
                    : "text-slate-700 hover:bg-slate-300 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {label} <span className="tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => removeWhere((t) => t.done, `完了した ${doneCount} 件を削除しました`)}
          disabled={doneCount === 0}
          className="min-h-11 rounded-lg px-3 text-base font-semibold text-red-800 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200 disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline dark:text-red-300 dark:disabled:text-slate-500"
        >
          完了したものを削除
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState filter={filter} total={todos.length} />
      ) : (
        <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-300 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
          {visible.map((todo) => (
            <li key={todo.id} className="flex items-center gap-2 px-2">
              <label className="flex min-h-14 flex-1 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => toggle(todo.id)}
                  className="size-6 shrink-0 cursor-pointer accent-blue-700"
                />
                <span
                  className={`break-words text-lg [overflow-wrap:anywhere] ${
                    todo.done
                      ? "text-slate-500 line-through dark:text-slate-400"
                      : "text-slate-900 dark:text-slate-50"
                  }`}
                >
                  {todo.title}
                </span>
              </label>
              <button
                type="button"
                onClick={() => removeWhere((t) => t.id === todo.id, `「${todo.title}」を削除しました`)}
                aria-label={`「${todo.title}」を削除`}
                className="min-h-11 shrink-0 rounded-lg px-3 text-base font-semibold text-red-800 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200 dark:text-red-300 dark:hover:bg-red-950"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-base text-slate-700 dark:text-slate-300">
        残り <strong className="tabular-nums">{activeCount}</strong> 件
        {todos.length > 0 && activeCount === 0 && " — すべて完了です！"}
      </p>

      {/* 画面読み上げ向けのお知らせ */}
      <p aria-live="polite" className="sr-only">{announce}</p>

      {removed && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-4 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
        >
          <span className="text-base [overflow-wrap:anywhere]">{removed.message}</span>
          <button
            type="button"
            onClick={undo}
            className="min-h-11 shrink-0 rounded-lg px-3 text-base font-bold text-blue-300 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400 dark:text-blue-800 dark:hover:bg-slate-900/10"
          >
            元に戻す
          </button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-28 pt-10">
      <h1 className="mb-1 text-3xl font-bold">やることリスト</h1>
      <p className="mb-8 text-base text-slate-600 dark:text-slate-300">
        このブラウザに保存されるので、閉じても消えません。
      </p>
      {children}
    </main>
  );
}

function EmptyState({ filter, total }: { filter: Filter; total: number }) {
  const message =
    total === 0
      ? "まだやることはありません。上の入力欄から追加してみましょう。"
      : filter === "active"
        ? "未完了のやることはありません。おつかれさまでした！"
        : "完了したやることはまだありません。終わったらチェックを付けましょう。";
  return (
    <p className="mt-4 rounded-xl border-2 border-dashed border-slate-300 px-4 py-10 text-center text-base text-slate-600 dark:border-slate-600 dark:text-slate-300">
      {message}
    </p>
  );
}
