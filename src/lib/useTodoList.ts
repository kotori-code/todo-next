"use client";

// やることの一覧と、それを変える apply を返す。
// token があれば LINE 連携のリスト（サーバー）、なければこのブラウザの localStorage を使う。

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { applyOp, type Todo, type TodoOp } from "./todoOps";
import { getLinkedToken, setLinkedToken } from "./linkedToken";
import { getServerSnapshot, getSnapshot, saveTodos, subscribe } from "./todoStore";

export type TodoList = {
  // 読み込み中は null
  todos: Todo[] | null;
  error: string | null;
  apply: (op: TodoOp) => void;
  reload: () => void;
};

type FetchResult = { todos: Todo[] } | { error: string; notFound?: boolean };

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
      return {
        error: "このリンクのリストが見つかりません。LINE で「一覧」と送ると、正しいリンクが届きます。",
        notFound: true,
      };
    }
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as { todos: Todo[] };
  } catch {
    return { error: "サーバーにつながりませんでした。通信できる場所で「最新にする」を押してください。" };
  }
}

export function useTodoList(token: string | null): TodoList {
  const local = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // どのトークンの結果かも持っておき、トークンが変わったら古い結果を出さない
  const [remote, setRemote] = useState<{ token: string; todos: Todo[] } | null>(null);
  const [error, setError] = useState<{ token: string; message: string } | null>(null);
  // 後から送った要求の応答だけを画面に反映する（応答の順番が入れ替わっても古い値に戻らない）
  const requestSeq = useRef(0);

  // このブラウザだけに保存していたやることを LINE のリストの末尾に移し、リストを 1 つにまとめる。
  // 移せたときだけブラウザ側を消すので、失敗しても次に開いたときにまた移す
  const moveLocalTodos = useCallback((target: string) => {
    const localTodos = getSnapshot();
    if (localTodos.length === 0) return;
    // 位置を大きくしておけば、元の順番のまま末尾に入る
    const items = localTodos.map((todo, i) => ({ todo, index: 1_000_000_000 + i }));
    const seq = ++requestSeq.current;
    void fetchList(target, { type: "restore", items }).then((result) => {
      if ("error" in result) return;
      saveTodos([]);
      if (seq === requestSeq.current) setRemote({ token: target, todos: result.todos });
    });
  }, []);

  const request = useCallback(
    (op?: TodoOp) => {
      if (!token) return;
      const seq = ++requestSeq.current;
      void fetchList(token, op).then((result) => {
        if (seq !== requestSeq.current) return;
        if ("error" in result) {
          setError({ token, message: result.error });
          // 覚えていたリストが消えていたら忘れて、このブラウザのリストに戻す
          if (result.notFound && getLinkedToken() === token) setLinkedToken(null);
        } else {
          setRemote({ token, todos: result.todos });
          setError(null);
          // 開けたリストを覚えて、次からはリンクなしでも開けるようにする
          setLinkedToken(token);
          moveLocalTodos(token);
        }
      });
    },
    [token, moveLocalTodos],
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
      setRemote((prev) => (prev?.token === token ? { token, todos: applyOp(prev.todos, op) } : prev));
      request(op);
    },
    [token, request],
  );

  return {
    todos: token ? (remote?.token === token ? remote.todos : null) : local,
    error: token && error?.token === token ? error.message : null,
    apply,
    reload,
  };
}
