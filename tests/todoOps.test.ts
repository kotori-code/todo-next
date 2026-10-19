import { describe, expect, it } from "vitest";
import { applyOp, collectRemoved, isTodoOp, type Todo } from "@/lib/todoOps";

const todo = (id: string, done = false): Todo => ({ id, title: id, done, createdAt: 0 });

describe("applyOp", () => {
  it("追加すると送った順に上から並ぶ", () => {
    const result = applyOp([todo("a")], {
      type: "add",
      items: [{ title: "牛乳" }, { title: " 卵 " }, { title: "" }],
    });
    expect(result.map((t) => t.title)).toEqual(["牛乳", "卵", "a"]);
  });

  it("長すぎるタスク名は 100 文字で切る", () => {
    const [added] = applyOp([], { type: "add", items: [{ title: "あ".repeat(150) }] });
    expect(added.title).toHaveLength(100);
  });

  it("一度に追加できるのは 20 件まで", () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ title: `t${i}` }));
    expect(applyOp([], { type: "add", items })).toHaveLength(20);
  });

  it("期限を付けて追加できる。期限がなければキーを入れない", () => {
    const [a, b] = applyOp([], { type: "add", items: [{ title: "歯医者", due: "2026-10-25" }, { title: "牛乳" }] });
    expect(a.due).toBe("2026-10-25");
    expect("due" in b).toBe(false);
  });

  it("完了を切り替えられる", () => {
    const result = applyOp([todo("a"), todo("b")], { type: "toggle", id: "b" });
    expect(result.map((t) => t.done)).toEqual([false, true]);
  });

  it("削除して元に戻すと、もとの位置に戻る", () => {
    const list = [todo("a"), todo("b", true), todo("c"), todo("d", true)];
    const ids = ["b", "d"];
    const removed = collectRemoved(list, ids);
    const after = applyOp(list, { type: "remove", ids });
    expect(after.map((t) => t.id)).toEqual(["a", "c"]);
    const restored = applyOp(after, { type: "restore", items: removed });
    expect(restored.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("大きな位置で戻すと、元の順番のまま末尾に入る（ブラウザのリストを移すとき）", () => {
    const items = [todo("x", true), todo("y")].map((t, i) => ({ todo: t, index: 1_000_000_000 + i }));
    const result = applyOp([todo("a"), todo("b")], { type: "restore", items });
    expect(result.map((t) => [t.id, t.done])).toEqual([["a", false], ["b", false], ["x", true], ["y", false]]);
  });

  it("すでにあるものは元に戻しても二重にならない", () => {
    const list = [todo("a")];
    const restored = applyOp(list, { type: "restore", items: [{ todo: todo("a"), index: 0 }] });
    expect(restored).toHaveLength(1);
  });
});

describe("isTodoOp", () => {
  it("正しくない形の操作を受け付けない", () => {
    expect(isTodoOp({ type: "add", items: [{ title: "a" }] })).toBe(true);
    expect(isTodoOp({ type: "add", items: [{ title: "a", due: "2026-10-25" }] })).toBe(true);
    expect(isTodoOp({ type: "add", items: [{ title: 1 }] })).toBe(false);
    expect(isTodoOp({ type: "add", items: [{ title: "a", due: "2026-02-30" }] })).toBe(false);
    expect(isTodoOp({ type: "drop" })).toBe(false);
    expect(isTodoOp({ type: "restore", items: [{ todo: { id: "x" }, index: 0 }] })).toBe(false);
    expect(isTodoOp(null)).toBe(false);
  });
});
