# やることリスト（Next.js）

タスクの追加・完了マーク・削除ができる ToDo リストです。データはブラウザの localStorage に保存されるので、ブラウザを閉じても残ります。

## 使い方

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # 本番ビルド
npm test         # テスト（Vitest）
```

## LINE から追加する

LINE の公式アカウントに送った文が、1 行 1 件のやることとして追加されます。「一覧」と送ると未完了のものを返します。
返事に載っている `?l=トークン` 付きのリンクを開くと、LINE で追加したリストを画面で見て、完了や削除ができます。

- 一度リンクで開いたブラウザはトークンを覚えるので、次からはリンクなしで開いても LINE のリストが出る（`src/lib/linkedToken.ts`）
- そのとき、ブラウザだけに保存していたやることは LINE のリストの末尾に移して、リストを 1 つにまとめる。移せたときだけブラウザ側を消す
- LINE のリンクで開いたことがないブラウザでは、今までどおりブラウザに保存する

- LINE の利用者ごとにリストを作る。リストは秘密のトークンで見分け、Redis にはトークンのハッシュをキーにして保存する
- グループでは全員の発言が追加されてしまうので、1 対 1 のトークだけで使う

### 設定（環境変数）

| 名前 | 内容 |
| --- | --- |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis（Vercel の Storage からつなぐと自動で入る） |
| `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers の Messaging API チャネル |
| `NEXT_PUBLIC_LINE_ADD_URL` | （任意）友だち追加の URL。画面に案内を出す |

LINE Developers の Webhook URL は `https://<公開 URL>/api/line/webhook`。
開発中は Redis がなければメモリに保存し、LINE への返事の文をログに出す。

## 構成

- `src/lib/todoOps.ts` … やることの型とリストへの操作（追加・完了・削除・元に戻す）。画面とサーバーの両方で使う
- `src/lib/todoStore.ts` … localStorage への保存。`useSyncExternalStore` で読むので、サーバー描画とのずれ（hydration エラー）が起きず、別のタブの変更にも追従する
- `src/lib/useTodoList.ts` … LINE のトークン（`?l=` か覚えたもの）があればサーバー、なければ localStorage を使い分ける
- `src/lib/server/lists.ts` … Redis への保存
- `src/lib/server/line.ts` / `src/app/api/line/webhook/route.ts` … LINE の Webhook
- `src/app/api/todos/route.ts` … 画面から LINE 連携のリストを読み書きする API
- `src/components/TodoApp.tsx` … 画面

## UI/UX で気をつけたこと

1. **読みやすさ** … 本文は 16〜18px、文字と背景のコントラストを十分にとる。ダークモードにも対応。長いタスク名は折り返す
2. **押しやすさ** … ボタン・チェックボックスの押せる範囲を 44px 以上にし、タスク名をタップしても完了にできる
3. **操作の手応え** … 空のときは「追加」を押せない、追加後は入力欄にフォーカスが戻る、残り件数・各絞り込みの件数を表示
4. **取り返しがつく** … 削除のあと「元に戻す」を数秒表示する（確認ダイアログで手を止めさせない）
5. **迷わせない** … ラベルを常に表示、空の状態では次にすることを案内、キーボードと読み上げ（aria-live / aria-label）にも対応
