// LINE Developers の Webhook URL に https://…/api/line/webhook を設定する

import { syncCalendarLater } from "@/lib/server/calendar";
import { handleWebhook } from "@/lib/server/line";

function appUrl(request: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  // Vercel では本番の URL が入る。プレビューの URL ではなく本番のリンクを返す
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelSecret || !accessToken) {
    console.error("LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN がありません");
    return new Response("not configured", { status: 500 });
  }
  const body = await request.text();
  const ok = await handleWebhook(body, request.headers.get("x-line-signature"), {
    channelSecret,
    accessToken,
    appUrl: appUrl(request),
    onListChange: syncCalendarLater,
  });
  return new Response(ok ? "OK" : "invalid signature", { status: ok ? 200 : 401 });
}
