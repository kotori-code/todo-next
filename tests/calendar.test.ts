import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { formatDue, isDue, nextDay, parseLeadingDue, todayInJapan } from "@/lib/due";
import { calendarChanges, eventFor, eventIdFor, syncCalendar } from "@/lib/server/calendar";
import type { Todo } from "@/lib/todoOps";

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, title: id, done: false, createdAt: 0, ...extra });

describe("期限の日付", () => {
  it("ありえない日付は期限にしない", () => {
    expect(isDue("2026-10-25")).toBe(true);
    expect(isDue("2026-02-30")).toBe(false);
    expect(isDue("2026-1-5")).toBe(false);
  });

  it("日本時間で今日を決める", () => {
    // 日本時間では 10/20 の 0:30
    expect(todayInJapan(Date.UTC(2026, 9, 19, 15, 30))).toBe("2026-10-20");
  });

  it("次の日は月や年をまたぐ", () => {
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("曜日付きで短く出す", () => {
    expect(formatDue("2026-10-19")).toBe("10/19（月）");
  });

  it("行の頭の日付を読む", () => {
    const today = "2026-10-19";
    expect(parseLeadingDue("10/25 歯医者", today)).toEqual({ title: "歯医者", due: "2026-10-25" });
    expect(parseLeadingDue("10月25日 歯医者", today)).toEqual({ title: "歯医者", due: "2026-10-25" });
    expect(parseLeadingDue("2027/3/1 更新", today)).toEqual({ title: "更新", due: "2027-03-01" });
    expect(parseLeadingDue("1/5 年賀状", today)).toEqual({ title: "年賀状", due: "2027-01-05" });
    // 日付でないもの・日付だけの行はそのまま名前にする
    expect(parseLeadingDue("2/30 なにか", today)).toEqual({ title: "2/30 なにか" });
    expect(parseLeadingDue("牛乳 2 本", today)).toEqual({ title: "牛乳 2 本" });
    expect(parseLeadingDue("10/25", today)).toEqual({ title: "10/25" });
  });
});

describe("calendarChanges", () => {
  it("期限のあるものだけ、変わったときに書き換える", () => {
    const prev = [todo("a", { due: "2026-10-25" }), todo("b", { due: "2026-10-26" }), todo("c")];
    const next = [
      todo("new", { due: "2026-10-30" }),
      todo("a", { due: "2026-10-25" }),
      todo("b", { due: "2026-10-26", done: true }),
      todo("c"),
      todo("d"),
    ];
    expect(calendarChanges(prev, next).upsert.map((t) => t.id)).toEqual(["new", "b"]);
    expect(calendarChanges(prev, next).remove).toEqual([]);
  });

  it("削除したら予定も消す", () => {
    const prev = [todo("a", { due: "2026-10-25" }), todo("c")];
    expect(calendarChanges(prev, [])).toEqual({ upsert: [], remove: ["a"] });
  });
});

describe("予定の中身", () => {
  it("終日の予定にして、完了したら ✓ を付ける", () => {
    const event = eventFor({ ...todo("a", { done: true }), title: "歯医者", due: "2026-10-25" });
    expect(event.summary).toBe("✓ 歯医者");
    expect(event.start).toEqual({ date: "2026-10-25" });
    expect(event.end).toEqual({ date: "2026-10-26" });
  });

  it("予定の ID は Google で使える文字だけで、同じやることなら同じ", () => {
    const id = eventIdFor("1760000000000-abcxyz");
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(eventIdFor("1760000000000-abcxyz")).toBe(id);
  });
});

describe("syncCalendar", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const serviceAccount = {
    client_email: "bot@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };

  function setup(eventStatus: (method: string) => number) {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://oauth2")) {
        return Response.json({ access_token: "at", expires_in: 3600 });
      }
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return new Response("{}", { status: eventStatus(method) });
    });
    const config = { serviceAccount, calendarId: "me@example.com", fetch: fetchMock as unknown as typeof fetch };
    return { calls, config };
  }

  it("まだない予定は作る", async () => {
    const { calls, config } = setup((method) => (method === "PUT" ? 404 : 200));
    await syncCalendar([], [todo("a", { due: "2026-10-25" })], config);
    expect(calls.map((c) => c.method)).toEqual(["PUT", "POST"]);
    expect(calls[1].url).toBe("https://www.googleapis.com/calendar/v3/calendars/me%40example.com/events");
    expect(calls[1].body).toMatchObject({ id: eventIdFor("a"), summary: "a" });
  });

  it("消すときに予定がもうなくても失敗にしない", async () => {
    const { calls, config } = setup(() => 410);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await syncCalendar([todo("a", { due: "2026-10-25" })], [], config);
    expect(calls.map((c) => c.method)).toEqual(["DELETE"]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
