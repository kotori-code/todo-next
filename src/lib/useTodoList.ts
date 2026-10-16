"use client";

// やることの一覧と、それを変える apply を返す。
// token があれば LINE 連携のリスト（サーバー）、なければこのブラウザの localStorage を使う。

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { applyOp, type Todo, type TodoOp } from "./todoOps";
import { getServerSnapshot, getSnapshot, saveTodos, subscribe } from "./todoStore";

export type TodoList = {
  // 読み込み中は null
  todos: Todo[] | null;
  error: string | null;
  apply: (op: TodoOp) => void;
  reload: () => void;
};

type FetchResult = { todos: Todo[] } | { error: string };

// サーバーのリストを読む（op があれば変えてから読む）。state は触らない
async function fetchList(token: string, op?: TodoOp): Promise<FetchResult> {
  try {
    const res = await fetch("/api/todos", {
      method: op ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "x-list-token": token },
      body: op ? JSON.stringify({ op }) : undefined,
      cache: "no-store",
    });
    if (res.status === 404) {
      return { error: "このリンクのリストが見つかりません。LINE で「一覧」と送ると、正しいリンクが届きます。" };
    }
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as { todos: Todo[] };
  } catch {
    return { error: "サーバーにつながりませんでした。通信できる場所で「最新にする」を押してください。" };
  }
}

export function useTodoList(token: string | null): TodoList {
  const local = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [remote, setRemote] = useState<Todo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 後から送った要求の応答だけを画面に反映する（応答の順番が入れ替わっても古い値に戻らない）
  const requestSeq = useRef(0);

  const request = useCallback(
    (op?: TodoOp) => {
      if (!token) return;
      const seq = ++requestSeq.current;
      void fetchList(token, op).then((result) => {
        if (seq !== requestSeq.current) return;
        if ("error" in result) {
          setError(result.error);
        } else {
          setRemote(result.todos);
          setError(null);
        }
      });
    },
    [token],
  );

  const reload = useCallback(() => request(), [request]);

  // 開いたときと、ほかのアプリ（LINE）から戻ってきたときに読み直す
  useEffect(() => {
    request();
    const onVisible = () => {
      if (document.visibilityState === "visible") request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [request]);

  const apply = useCallback(
    (op: TodoOp) => {
      if (!token) {
        saveTodos(applyOp(getSnapshot(), op));
        return;
      }
      // 先に画面を変えておき、サーバーの結果で置き換える
      setRemote((prev) => (prev ? applyOp(prev, op) : prev));
      request(op);
    },
    [token, request],
  );

  return { todos: token ? remote : local, error, apply, reload };
}
