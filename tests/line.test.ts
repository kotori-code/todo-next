import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMemoryStore, getOrCreateLineToken, readList } from "@/lib/server/lists";
import { handleWebhook, verifySignature, type LineConfig } from "@/lib/server/line";

const SECRET = "test-secret";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("base64");
}

function setup() {
  const store = createMemoryStore();
  const fetchMock = vi.fn(async () => new Response("{}"));
  const config: LineConfig = {
    channelSecret: SECRET,
    accessToken: "token",
    appUrl: "https://example.com/",
    fetch: fetchMock as unknown as typeof fetch,
    store,
    today: "2026-10-19",
  };
  // 送った返事の文を取り出す
  const replies = () =>
    fetchMock.mock.calls.map(
      (call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string).messages[0].text as string,
    );
  return { store, config, fetchMock, replies };
}

function textEvent(text: string, sourceType = "user") {
  return {
    type: "message",
    replyToken: "r",
    source: { type: sourceType, userId: "U1", groupId: "G1" },
    message: { type: "text", text },
  };
}

async function send(config: LineConfig, ...events: unknown[]) {
  const body = JSON.stringify({ events });
  return handleWebhook(body, sign(body), config);
}

describe("verifySignature", () => {
  it("署名が違えば受け付けない", () => {
    expect(verifySignature("{}", sign("{}"), SECRET)).toBe(true);
    expect(verifySignature("{}", sign("{ }"), SECRET)).toBe(false);
    expect(verifySignature("{}", null, SECRET)).toBe(false);
    expect(verifySignature("{}", "短い", SECRET)).toBe(false);
  });
});

describe("handleWebhook", () => {
  it("署名が違うと何もしない", async () => {
    const { config, fetchMock } = setup();
    const body = JSON.stringify({ events: [textEvent("牛乳")] });
    expect(await handleWebhook(body, "bad", config)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("送った文が 1 行 1 件で追加され、リンク付きで返事する", async () => {
    const { config, store, replies } = setup();
    expect(await send(config, textEvent("・牛乳\n\n1. 卵\nパン"))).toBe(true);
    const token = await getOrCreateLineToken("U1", store);
    const todos = await readList(token, store);
    expect(todos?.map((t) => t.title)).toEqual(["牛乳", "卵", "パン"]);
    expect(replies()[0]).toContain("3 件追加しました");
    expect(replies()[0]).toContain(`https://example.com/?l=${token}`);
  });

  it("頭に日付を書くと期限になり、リストが変わったことを知らせる", async () => {
    const { config, store, replies } = setup();
    const onListChange = vi.fn();
    await send({ ...config, onListChange }, textEvent("10/25 歯医者\n1月5日 年賀状\n牛乳"));
    const token = await getOrCreateLineToken("U1", store);
    const todos = await readList(token, store);
    expect(todos?.map((t) => [t.title, t.due])).toEqual([
      ["歯医者", "2026-10-25"],
      // 今日より前の日付は来年にする
      ["年賀状", "2027-01-05"],
      ["牛乳", undefined],
    ]);
    expect(replies()[0]).toContain("・歯医者（期限 10/25（日））");
    expect(onListChange).toHaveBeenCalledWith(token, [], todos);
  });

  it("「一覧」で未完了のものを返す", async () => {
    const { config, replies } = setup();
    await send(config, textEvent("牛乳"));
    await send(config, textEvent("一覧"));
    expect(replies()[1]).toContain("未完了 1 件");
    expect(replies()[1]).toContain("1. 牛乳");
  });

  it("グループでの発言は追加しない", async () => {
    const { config, store, fetchMock } = setup();
    await send(config, textEvent("牛乳", "group"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await store.get("line-user:U1")).toBeNull();
  });

  it("友だち追加でリストを作り、使い方を送る", async () => {
    const { config, replies } = setup();
    await send(config, { type: "follow", replyToken: "r", source: { type: "user", userId: "U1" } });
    expect(replies()[0]).toContain("友だち追加ありがとうございます");
  });

  it("同じ人には同じリストを使う", async () => {
    const { store } = setup();
    const a = await getOrCreateLineToken("U1", store);
    const b = await getOrCreateLineToken("U1", store);
    const c = await getOrCreateLineToken("U2", store);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
