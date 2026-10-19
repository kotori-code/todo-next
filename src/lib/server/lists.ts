// LINE 連携のリストをサーバー（Upstash Redis）に保存する。
// リストは秘密のトークンで見分ける。DB にはトークンのハッシュだけをキーとして使う。

import { createHash, randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import { applyOp, isTodo, type Todo, type TodoOp } from "@/lib/todoOps";

// Redis と、開発・テスト用のメモリ上の実装の共通部分
export type KeyValueStore = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { nx: true }): Promise<unknown>;
};

export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    async get<T>(key: string) {
      const v = map.get(key);
      return v === undefined ? null : (JSON.parse(v) as T);
    },
    async set(key, value, opts) {
      if (opts?.nx && map.has(key)) return null;
      map.set(key, JSON.stringify(value));
      return "OK";
    },
  };
}

let defaultStore: KeyValueStore | undefined;

// Vercel の Storage から Upstash をつなぐと KV_REST_API_* が入る。直接作ったときは UPSTASH_REDIS_REST_*
export function getStore(): KeyValueStore {
  if (defaultStore) return defaultStore;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    defaultStore = new Redis({ url, token }) as unknown as KeyValueStore;
  } else if (process.env.NODE_ENV !== "production") {
    // 開発中は Redis がなくても動かせるように、メモリに置く（再起動で消える）
    defaultStore = createMemoryStore();
  } else {
    throw new Error("Upstash Redis の環境変数（KV_REST_API_URL / KV_REST_API_TOKEN）がありません");
  }
  return defaultStore;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

export function isValidToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

function listKey(token: string): string {
  return `list:${createHash("sha256").update(token).digest("hex")}`;
}

function lineUserKey(lineUserId: string): string {
  return `line-user:${lineUserId}`;
}

// LINE の利用者のリストのトークンを返す。まだなければ作る
export async function getOrCreateLineToken(
  lineUserId: string,
  store = getStore(),
): Promise<string> {
  const key = lineUserKey(lineUserId);
  let token = await store.get<string>(key);
  if (!token) {
    const created = randomBytes(24).toString("base64url");
    // 同時に 2 回呼ばれても、先に保存されたほうを使う
    const ok = await store.set(key, created, { nx: true });
    token = ok ? created : await store.get<string>(key);
    if (!token) throw new Error("リストのトークンを保存できませんでした");
  }
  await store.set(listKey(token), [], { nx: true });
  return token;
}

// 存在しないリストなら null
export async function readList(token: string, store = getStore()): Promise<Todo[] | null> {
  const value = await store.get<unknown>(listKey(token));
  if (!Array.isArray(value)) return null;
  return value.filter(isTodo);
}

// 最新のリストに操作をあてて保存し、変える前と後のリストを返す。存在しないリストなら null
// （読んでから書くまでの間に別の変更が来ると片方が消えうるが、1 人で使う前提なので許容する）
export async function updateList(
  token: string,
  op: TodoOp,
  store = getStore(),
): Promise<{ prev: Todo[]; next: Todo[] } | null> {
  const prev = await readList(token, store);
  if (prev === null) return null;
  const next = applyOp(prev, op);
  await store.set(listKey(token), next);
  return { prev, next };
}
