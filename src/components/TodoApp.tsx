"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import SortableTodo from "@/components/SortableTodo";
import { formatDue } from "@/lib/due";
import { getLinkedToken, getServerLinkedToken, subscribeLinkedToken } from "@/lib/linkedToken";
import { collectRemoved, MAX_TITLE, type RemovedItem, type Todo } from "@/lib/todoOps";
import { useTodoList } from "@/lib/useTodoList";

type Filter = "all" | "active" | "done";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "active", label: "未完了" },
  { value: "done", label: "完了" },
];

const UNDO_MS = 6000;

// 並び替えは縦にだけ動かす
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

// 並び替えの読み上げ（dnd-kit の既定は英語なので日本語にする）
const screenReaderInstructions = {
  draggable: "スペースキーで持ち上げ、上下の矢印キーで動かし、もう一度スペースキーで置きます。Esc キーで取りやめます。",
};
const announcements: Announcements = {
  onDragStart: () => "持ち上げました",
  onDragOver: ({ over }) => (over ? "移動しています" : undefined),
  onDragEnd: ({ over }) => (over ? "置きました" : "元の場所に戻しました"),
  onDragCancel: () => "並び替えを取りやめました",
};

type Removed = { message: string; items: RemovedItem[] };

type Props = {
  // LINE の友だち追加の URL。あれば画面に案内を出す
  lineAddUrl: string | null;
};

export default function TodoApp({ lineAddUrl }: Props) {
  // LINE 連携のリストのトークン。リンク（?l=）になければ、前に開いたときに覚えたものを使う。
  // どちらもなければこのブラウザに保存する
  const urlToken = useSearchParams().get("l") || null;
  const savedToken = useSyncExternalStore(subscribeLinkedToken, getLinkedToken, getServerLinkedToken);
  const token = urlToken ?? savedToken;
  const { todos, error, apply, reload } = useTodoList(token);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  // 完了にした直後のやること。チェックを光らせる
  const [glowId, setGlowId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [removed, setRemoved] = useState<Removed | null>(null);
  const [announce, setAnnounce] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const dueId = useId();
  const dndId = useId();
  // ドラッグを終えた直後のクリックでチェックが切り替わらないようにする
  const justDragged = useRef(false);
  const sensors = useSensors(
    // パソコン: 少し動かしたらドラッグ（クリックだけならチェック）
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // スマホ: 長押ししてから動かす（すぐ動かせばスクロール）
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // 「元に戻す」は一定時間で消す
  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [removed]);

  const shellProps = { token, lineAddUrl, error, onReload: reload };

  if (todos === null) {
    return (
      <Shell {...shellProps}>
        {!error && <p className="py-12 text-center text-slate-600 dark:text-slate-300">読み込み中…</p>}
      </Shell>
    );
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
    apply({ type: "add", items: [{ title: trimmed, ...(due ? { due } : {}) }] });
    setTitle("");
    setDue("");
    setAnnounce(`「${trimmed}」を追加しました${due ? `（期限 ${formatDue(due)}）` : ""}`);
    // 続けて入力できるように入力欄に戻す
    inputRef.current?.focus();
    // 追加したものが見えるように、完了の絞り込み中なら外す
    if (filter === "done") setFilter("all");
  }

  function toggle(id: string) {
    const target = todos!.find((t) => t.id === id);
    if (!target) return;
    apply({ type: "toggle", id });
    setGlowId(target.done ? null : id);
    setAnnounce(`「${target.title}」を${target.done ? "未完了に戻しました" : "完了にしました"}`);
  }

  function dragEnd({ active, over }: DragEndEvent) {
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
    if (!over || active.id === over.id) return;
    const from = visible.findIndex((t) => t.id === active.id);
    const to = visible.findIndex((t) => t.id === over.id);
    if (from === -1 || to === -1) return;
    // 絞り込み中は見えている項目だけで動くので、置いた場所の隣の項目を目印にする
    const moved = arrayMove(visible, from, to);
    const id = String(active.id);
    const target = visible[from];
    if (moved[to + 1]) apply({ type: "move", id, beforeId: moved[to + 1].id });
    else apply({ type: "move", id, afterId: moved[to - 1].id });
    setAnnounce(`「${target.title}」を ${to + 1} 番目に動かしました`);
  }

  function swallowClickAfterDrag(e: React.MouseEvent) {
    if (!justDragged.current) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function removeWhere(pred: (t: Todo) => boolean, message: string) {
    const ids = todos!.filter(pred).map((t) => t.id);
    if (ids.length === 0) return;
    const items = collectRemoved(todos!, ids);
    apply({ type: "remove", ids });
    setRemoved({ message, items });
    setAnnounce(`${message}。元に戻すこともできます`);
  }

  function undo() {
    if (!removed) return;
    apply({ type: "restore", items: removed.items });
    setRemoved(null);
    setAnnounce("元に戻しました");
  }

  return (
    <Shell {...shellProps}>
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label htmlFor={dueId} className="text-base font-semibold">
            期限<span className="font-normal text-slate-600 dark:text-slate-300">（なくてもよい）</span>
          </label>
          <input
            id={dueId}
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="min-h-11 rounded-lg border-2 border-slate-400 bg-white px-3 text-base text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 dark:border-slate-500 dark:bg-slate-900 dark:text-slate-50 dark:focus:border-blue-400 dark:focus:ring-blue-900"
          />
        </div>
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
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[verticalOnly]}
          accessibility={{ announcements, screenReaderInstructions }}
          onDragEnd={dragEnd}
        >
          <SortableContext items={visible.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <ul
              onClickCapture={swallowClickAfterDrag}
              className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-300 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900"
            >
              {visible.map((todo) => (
                <SortableTodo
                  key={todo.id}
                  todo={todo}
                  glowing={glowId === todo.id}
                  onToggle={() => toggle(todo.id)}
                  onRemove={() => removeWhere((t) => t.id === todo.id, `「${todo.title}」を削除しました`)}
                  onGlowEnd={() => setGlowId(null)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {visible.length > 1 && (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          ドラッグ（スマホは長押し）で並び替えられます
        </p>
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

type ShellProps = {
  token: string | null;
  lineAddUrl: string | null;
  error: string | null;
  onReload: () => void;
  children: React.ReactNode;
};

function Shell({ token, lineAddUrl, error, onReload, children }: ShellProps) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-28 pt-10">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold">やることリスト</h1>
        {token && (
          <button
            type="button"
            onClick={onReload}
            className="min-h-11 rounded-lg border-2 border-slate-400 px-3 text-base font-semibold hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 dark:border-slate-500 dark:hover:bg-slate-800"
          >
            最新にする
          </button>
        )}
      </div>
      <p className="mb-8 text-base text-slate-600 dark:text-slate-300">
        {token ? (
          <>
            <span className="mr-2 inline-block rounded bg-green-700 px-2 text-sm font-bold text-white">LINE 連携</span>
            LINE で送ったやることと同じリストです。このブラウザでは、次からリンクなしで開いてもこのリストが出ます。
          </>
        ) : (
          <>
            このブラウザに保存されるので、閉じても消えません。
            {lineAddUrl && (
              <>
                {" "}
                <a href={lineAddUrl} className="font-semibold text-blue-800 underline underline-offset-4 dark:text-blue-300">
                  LINE から追加する
                </a>
                （友だち追加すると、LINE 用のリストのリンクが届きます）
              </>
            )}
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="mb-6 rounded-lg border-2 border-red-700 bg-red-50 px-4 py-3 text-base text-red-900 dark:border-red-400 dark:bg-red-950 dark:text-red-100">
          {error}
        </p>
      )}
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
