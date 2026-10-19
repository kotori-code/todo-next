// やることの期限（日付だけ）。"2026-10-25" の形で持つ。

const DUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDue(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  // 2/30 のようなありえない日付は受け付けない
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function isDue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DUE_PATTERN.exec(value);
  return m !== null && toDue(Number(m[1]), Number(m[2]), Number(m[3])) === value;
}

// 日本時間の今日
export function todayInJapan(now = Date.now()): string {
  const d = new Date(now + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// 次の日。カレンダーの終日の予定は終わりの日を含まないので、終わりに使う
export function nextDay(due: string): string {
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// 「10/25」のような短い表示（曜日付き）
export function formatDue(due: string): string {
  const [y, m, d] = due.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}（${weekday}）`;
}

// LINE で送られた 1 行の頭にある日付を読む。「10/25 歯医者」「10月25日 歯医者」「2026/10/25 歯医者」。
// 年がなければ、今日より前にならない年にする（12 月に「1/5」と送ったら来年）
export function parseLeadingDue(line: string, today: string): { title: string; due?: string } {
  const m = /^(?:(\d{4})[/年-])?(\d{1,2})(?:[/月])(\d{1,2})日?(?:\s+|$)/.exec(line);
  if (!m) return { title: line };
  const [ty] = today.split("-").map(Number);
  let due: string | null;
  if (m[1]) {
    due = toDue(Number(m[1]), Number(m[2]), Number(m[3]));
  } else {
    due = toDue(ty, Number(m[2]), Number(m[3]));
    if (due && due < today) due = toDue(ty + 1, Number(m[2]), Number(m[3]));
  }
  const title = line.slice(m[0].length).trim();
  // 日付だけの行は、やることの名前として扱う
  if (!due || !title) return { title: line };
  return { title, due };
}
