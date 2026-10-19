// 期限のあるやることを Google カレンダーの終日の予定にする。
// サービスアカウントで Calendar API を呼ぶ。カレンダーをサービスアカウントのメールアドレスに
// 「予定の変更」の権限で共有して使う。
// LINE の公式アカウントは誰でも友だち追加できるので、CALENDAR_LIST_TOKEN のリストだけを入れる。

import { createHash, createSign } from "node:crypto";
import { after } from "next/server";
import { nextDay } from "@/lib/due";
import type { Todo } from "@/lib/todoOps";

type ServiceAccount = { client_email: string; private_key: string };

export type CalendarConfig = {
  serviceAccount: ServiceAccount;
  calendarId: string;
  fetch?: typeof fetch;
};

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// 予定の ID はやることの ID から作る。同じやることは同じ予定を書き換える。
// Google の予定の ID に使える文字は 0-9 と a-v なので、16 進のハッシュにする
export function eventIdFor(todoId: string): string {
  return `todo${createHash("sha256").update(todoId).digest("hex").slice(0, 32)}`;
}

export function eventFor(todo: Todo & { due: string }) {
  return {
    summary: `${todo.done ? "✓ " : ""}${todo.title}`,
    description: "やることリストから追加しました",
    start: { date: todo.due },
    end: { date: nextDay(todo.due) },
    // カレンダーで消した予定も ID は残っている。書き換えるときに戻す
    status: "confirmed",
    transparency: "transparent",
  };
}

// 前後のリストを比べて、カレンダーで書き換える・消すやることを決める
export function calendarChanges(prev: Todo[], next: Todo[]): { upsert: (Todo & { due: string })[]; remove: string[] } {
  const prevById = new Map(prev.map((t) => [t.id, t]));
  const nextById = new Map(next.map((t) => [t.id, t]));
  const upsert = next.filter((t): t is Todo & { due: string } => {
    if (!t.due) return false;
    const p = prevById.get(t.id);
    return !p || p.due !== t.due || p.title !== t.title || p.done !== t.done;
  });
  const remove = prev.filter((p) => p.due && !nextById.get(p.id)?.due).map((p) => p.id);
  return { upsert, remove };
}

let cachedToken: { email: string; value: string; expiresAt: number } | undefined;

async function accessToken(config: CalendarConfig): Promise<string> {
  const { client_email, private_key } = config.serviceAccount;
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken?.email === client_email && cachedToken.expiresAt - 60 > now) return cachedToken.value;
  const encode = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(private_key, "base64url");
  const res = await (config.fetch ?? fetch)(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Google の認証に失敗しました ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { email: client_email, value: body.access_token, expiresAt: now + body.expires_in };
  return body.access_token;
}

async function call(config: CalendarConfig, method: string, path: string, body?: object): Promise<Response> {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events`;
  return (config.fetch ?? fetch)(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken(config)}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function upsertEvent(config: CalendarConfig, todo: Todo & { due: string }): Promise<void> {
  const id = eventIdFor(todo.id);
  const event = eventFor(todo);
  let res = await call(config, "PUT", `/${id}`, event);
  if (res.status === 404) {
    res = await call(config, "POST", "", { id, ...event });
    // 同時に作られていたら書き換える
    if (res.status === 409) res = await call(config, "PUT", `/${id}`, event);
  }
  if (!res.ok) throw new Error(`予定を保存できませんでした ${res.status} ${await res.text()}`);
}

async function deleteEvent(config: CalendarConfig, todoId: string): Promise<void> {
  const res = await call(config, "DELETE", `/${eventIdFor(todoId)}`);
  // もうない予定（404・410）は消せたことにする
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`予定を消せませんでした ${res.status} ${await res.text()}`);
  }
}

export async function syncCalendar(prev: Todo[], next: Todo[], config: CalendarConfig): Promise<void> {
  const { upsert, remove } = calendarChanges(prev, next);
  const results = await Promise.allSettled([
    ...upsert.map((t) => upsertEvent(config, t)),
    ...remove.map((id) => deleteEvent(config, id)),
  ]);
  for (const r of results) {
    if (r.status === "rejected") console.error("カレンダーへの反映に失敗しました", r.reason);
  }
}

// 環境変数がそろっていて、カレンダーに入れるリストのときだけ設定を返す
export function calendarConfigFor(token: string): CalendarConfig | null {
  const { CALENDAR_LIST_TOKEN, GOOGLE_CALENDAR_ID, GOOGLE_SERVICE_ACCOUNT_KEY } = process.env;
  if (!CALENDAR_LIST_TOKEN || !GOOGLE_CALENDAR_ID || !GOOGLE_SERVICE_ACCOUNT_KEY) return null;
  if (token !== CALENDAR_LIST_TOKEN) return null;
  try {
    return { serviceAccount: JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY), calendarId: GOOGLE_CALENDAR_ID };
  } catch {
    console.error("GOOGLE_SERVICE_ACCOUNT_KEY が JSON として読めません");
    return null;
  }
}

// 返事を返したあとでカレンダーに反映する（画面や LINE の返事を待たせない）。
// （同じやることを短い間に続けて変えると反映の順番が入れ替わりうるが、1 人で使う前提なので許容する）
export function syncCalendarLater(token: string, prev: Todo[], next: Todo[]): void {
  const config = calendarConfigFor(token);
  if (!config) return;
  const { upsert, remove } = calendarChanges(prev, next);
  if (upsert.length === 0 && remove.length === 0) return;
  after(() => syncCalendar(prev, next, config));
}
