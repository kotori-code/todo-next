// LINE 連携のリストを画面から読み書きする API。
// トークンは URL に残らないようにヘッダー（x-list-token）で受け取る。

import { isValidToken, readList, updateList } from "@/lib/server/lists";
import { isTodoOp } from "@/lib/todoOps";

function tokenFrom(request: Request): string | null {
  const token = request.headers.get("x-list-token");
  return isValidToken(token) ? token : null;
}

function notFound() {
  return Response.json({ error: "リストが見つかりません" }, { status: 404 });
}

export async function GET(request: Request) {
  const token = tokenFrom(request);
  if (!token) return notFound();
  const todos = await readList(token);
  if (!todos) return notFound();
  return Response.json({ todos }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const token = tokenFrom(request);
  if (!token) return notFound();
  const body: unknown = await request.json().catch(() => null);
  const op = (body as { op?: unknown } | null)?.op;
  if (!isTodoOp(op)) {
    return Response.json({ error: "操作の形が正しくありません" }, { status: 400 });
  }
  const todos = await updateList(token, op);
  if (!todos) return notFound();
  return Response.json({ todos });
}
