"use client";

// 一覧の 1 行。パソコンはマウスでドラッグ、スマホは長押ししてから動かして並び替える。
// キーボードでは左のつまみにフォーカスして、スペースで持ち上げ、上下キーで動かし、スペースで置く。

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatDue, todayInJapan } from "@/lib/due";
import type { Todo } from "@/lib/todoOps";

type Props = {
  todo: Todo;
  glowing: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onGlowEnd: () => void;
};

export default function SortableTodo({ todo, glowing, onToggle, onRemove, onGlowEnd }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: todo.id,
  });
  // マウス・タッチは行のどこからでも動かせるようにし、キーボードはつまみだけで受ける
  // （行全体をボタンにすると、中のチェックや削除と入れ子になってしまうため）
  const { onKeyDown, ...pointerListeners } = listeners ?? {};

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...pointerListeners}
      className={`relative flex touch-manipulation first:rounded-t-xl last:rounded-b-xl select-none items-center gap-1 px-1 [-webkit-touch-callout:none] ${
        todo.done ? "bg-slate-200 dark:bg-slate-800" : "bg-white dark:bg-slate-900"
      } ${isDragging ? "z-10 rounded-lg opacity-90 shadow-xl ring-2 ring-blue-600 dark:ring-blue-400" : ""}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        onKeyDown={onKeyDown as React.KeyboardEventHandler | undefined}
        aria-label={`「${todo.title}」を並び替え`}
        className="grid min-h-11 w-7 shrink-0 cursor-grab place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 active:cursor-grabbing dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
      >
        <svg aria-hidden="true" viewBox="0 0 10 16" className="h-4 w-2.5 fill-current">
          <circle cx="2" cy="2" r="1.5" />
          <circle cx="8" cy="2" r="1.5" />
          <circle cx="2" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="2" cy="14" r="1.5" />
          <circle cx="8" cy="14" r="1.5" />
        </svg>
      </button>
      <label
        className={`flex min-h-14 flex-1 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 ${
          todo.done ? "hover:bg-slate-300 dark:hover:bg-slate-700" : "hover:bg-slate-50 dark:hover:bg-slate-800"
        }`}
      >
        <span
          className={`grid shrink-0 place-items-center rounded-md ${glowing ? "check-glow" : ""}`}
          onAnimationEnd={onGlowEnd}
        >
          <input
            type="checkbox"
            checked={todo.done}
            onChange={onToggle}
            className={`size-6 cursor-pointer ${todo.done ? "accent-slate-500" : "accent-blue-700"}`}
          />
        </span>
        <span className="flex min-w-0 flex-col">
          <span
            className={`break-words text-lg [overflow-wrap:anywhere] ${
              todo.done ? "text-slate-500 line-through dark:text-slate-400" : "text-slate-900 dark:text-slate-50"
            }`}
          >
            {todo.title}
          </span>
          {todo.due && <DueLabel due={todo.due} done={todo.done} />}
        </span>
      </label>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`「${todo.title}」を削除`}
        className="min-h-11 shrink-0 rounded-lg px-3 text-base font-semibold text-red-800 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200 dark:text-red-300 dark:hover:bg-red-950"
      >
        削除
      </button>
    </li>
  );
}

function DueLabel({ due, done }: { due: string; done: boolean }) {
  const overdue = !done && due < todayInJapan();
  return (
    <span
      className={`text-sm ${
        done
          ? "text-slate-500 dark:text-slate-400"
          : overdue
            ? "font-semibold text-red-800 dark:text-red-300"
            : "text-slate-600 dark:text-slate-300"
      }`}
    >
      期限 {formatDue(due)}
      {overdue && "・過ぎています"}
    </span>
  );
}
