// LINE の Webhook を受けて、送られた文をやることに追加する。
// 1 行が 1 件。「一覧」「使い方」だけは命令として扱う。

import { createHmac, timingSafeEqual } from "node:crypto";
import { formatDue, parseLeadingDue, todayInJapan } from "@/lib/due";
import { MAX_ADD, type Todo } from "@/lib/todoOps";
import { getOrCreateLineToken, getStore, readList, updateList, type KeyValueStore } from "./lists";

export type LineConfig = {
  channelSecret: string;
  accessToken: string;
  // 返事に載せるリンクの元（例: https://todo-next-eight-psi.vercel.app）
  appUrl: string;
  fetch?: typeof fetch;
  store?: KeyValueStore;
  // リストが変わったときに呼ぶ（カレンダーへの反映）
  onListChange?: (token: string, prev: Todo[], next: Todo[]) => void;
  // テスト用。日本時間の今日（"2026-10-19"）
  today?: string;
};

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
};

const LIST_COMMANDS = new Set(["一覧", "いちらん", "リスト"]);
const HELP_COMMANDS = new Set(["使い方", "つかいかた", "ヘルプ", "help"]);
// 一覧で返事に載せる最大件数
const MAX_LIST = 30;

export function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(signature, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function listUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/?l=${token}`;
}

export function helpText(url: string): string {
  return [
    "やることを送ると、リストに追加します。",
    "・1 行に 1 件。改行すると何件でもまとめて追加できます（1 回に 20 件まで）",
    "・「10/25 歯医者」のように頭に日付を書くと期限になります",
    "・「一覧」と送ると、まだ終わっていないものを返します",
    "",
    "完了のチェックや削除は、こちらのページで行えます。",
    url,
  ].join("\n");
}

function formatList(todos: Todo[], url: string): string {
  const active = todos.filter((t) => !t.done);
  if (active.length === 0) return `まだ終わっていないやることはありません。\n\n${url}`;
  const lines = active.slice(0, MAX_LIST).map((t, i) => `${i + 1}. ${t.title}${t.due ? `（${formatDue(t.due)}）` : ""}`);
  if (active.length > MAX_LIST) lines.push(`…ほか ${active.length - MAX_LIST} 件`);
  return `未完了 ${active.length} 件\n${lines.join("\n")}\n\n${url}`;
}

// 1 件の出来事に対する返事の文を作る。返事しないなら null
export async function replyFor(event: LineEvent, config: LineConfig): Promise<string | null> {
  // グループで使うと全員の発言が追加されてしまうので、1 対 1 のトークだけで使う
  if (event.source?.type !== "user" || !event.source.userId) return null;
  const store = config.store ?? getStore();
  const token = await getOrCreateLineToken(event.source.userId, store);
  const url = listUrl(config.appUrl, token);

  if (event.type === "follow") {
    return `友だち追加ありがとうございます！\n\n${helpText(url)}`;
  }
  if (event.type !== "message") return null;
  if (event.message?.type !== "text" || !event.message.text) {
    return "文字で送ってください。1 行が 1 件のやることになります。";
  }

  const text = event.message.text.trim();
  if (LIST_COMMANDS.has(text)) {
    return formatList((await readList(token, store)) ?? [], url);
  }
  if (HELP_COMMANDS.has(text.toLowerCase())) {
    return helpText(url);
  }

  const today = config.today ?? todayInJapan();
  const items = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-・*•]|\d+[.)．])\s*/, "").trim())
    .filter(Boolean)
    .map((line) => parseLeadingDue(line, today));
  if (items.length === 0) return null;
  const result = await updateList(token, { type: "add", items }, store);
  if (result) config.onListChange?.(token, result.prev, result.next);
  const todos = result?.next ?? [];
  const added = items.slice(0, MAX_ADD);
  const active = todos.filter((t) => !t.done).length;
  const lines = [
    `${added.length} 件追加しました`,
    ...added.map((t) => `・${t.title.slice(0, 100)}${t.due ? `（期限 ${formatDue(t.due)}）` : ""}`),
  ];
  if (items.length > MAX_ADD) lines.push(`（${MAX_ADD} 件を超えた分は追加していません）`);
  lines.push("", `未完了 ${active} 件`, url);
  return lines.join("\n");
}

async function reply(replyToken: string, text: string, config: LineConfig): Promise<void> {
  // 開発中は返事の文をログに出す（本物のチャネルなしで動きを確かめるため）
  if (process.env.NODE_ENV === "development") console.log("[LINE 返事]", text);
  const res = await (config.fetch ?? fetch)("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text: text.slice(0, 5000) }] }),
  });
  if (!res.ok) {
    console.error("LINE への返事に失敗しました", res.status, await res.text());
  }
}

// Webhook の本体。署名が正しくなければ false
export async function handleWebhook(
  body: string,
  signature: string | null,
  config: LineConfig,
): Promise<boolean> {
  if (!verifySignature(body, signature, config.channelSecret)) return false;
  const events: LineEvent[] = JSON.parse(body).events ?? [];
  for (const event of events) {
    try {
      const text = await replyFor(event, config);
      if (text && event.replyToken) await reply(event.replyToken, text, config);
    } catch (e) {
      // 1 件の失敗で残りを止めない。LINE に 200 以外を返すと同じ出来事が再送されるので握りつぶす
      console.error("LINE の出来事の処理に失敗しました", e);
    }
  }
  return true;
}
