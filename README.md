<!-- File: README.md -->
# Claude Chat

Cloudflare Workers上で動く、Claude APIを使ったシンプルなチャットWebアプリです。
APIキーはサーバー側の環境変数のみで管理し、ブラウザには一切露出しません。

## 機能

- アクセスコードによる簡易ログイン（コードは `1359`）
- モデル選択: Haiku 4.5 / Sonnet 5 / Opus 5
- 推論量（effort）選択: Haiku 4.5 / Sonnet 5 / Opus 5 で low / medium / high / xhigh / max
- チャット履歴表示とストリーミング応答
- 入力・出力のMarkdownレンダリング（コードブロック、箇条書き、表など）
- 入力欄・各回答のワンクリックコピー
- PC・スマートフォン対応の落ち着いたUI
- エラー時にAPIキーや内部情報を画面に表示しない

## モデルとeffortについて（一次情報に基づく）

要件どおり、Haiku 4.5 / Sonnet 5 / Opus 5 をそのまま使用しています（いずれも
Anthropic公式に提供されているモデルであり、偽装や別モデルへの置き換えは行っていません）。

- Haiku 4.5: `claude-haiku-4-5`
- Sonnet 5: `claude-sonnet-5`
- Opus 5: `claude-opus-5`

`effort`（推論量）はAnthropic公式のMessages API仕様に基づき、
`output_config.effort` として送信します（GA機能でベータヘッダー不要）。

- Haiku 4.5 / Sonnet 5 / Opus 5: `low` / `medium` / `high` / `xhigh` / `max` に対応

Sonnet 5 / Opus 5 は思考（thinking）がデフォルトで有効（adaptive）です。
本アプリでは明示的に `thinking` を無効化するオプションは提供していません
（無効化と `effort` の組み合わせによっては仕様上エラーになる場合があるため）。

モデルやeffortの仕様が更新された場合は `src/models.ts` を確認し、
Anthropic公式ドキュメント（Models overview / Effort）と照合の上で更新してください。

## 必要環境

- Node.js 20以上
- npm 10以上
- Cloudflareアカウント（デプロイ時）
- Anthropic APIキー

## ローカルでの起動方法

1. 依存関係をインストールする

       npm install

2. 環境変数ファイルを作成する

       cp .dev.vars.example .dev.vars

3. `.dev.vars` を編集する

       CLAUDE_API_KEY=（Anthropic Consoleで発行したAPIキー）
       SESSION_SECRET=（例: openssl rand -hex 32 の出力）
       ACCESS_CODE=1359

   `.dev.vars` は `.gitignore` の対象です。Gitへコミットしないでください。

4. テストを実行する

       npm test

5. 開発サーバーを起動する

       npm run dev

6. Wranglerが表示したローカルアドレス（通常 `http://localhost:8787`）をブラウザで開く
7. アクセスコード `1359` を入力する

   ログイン画面には「アルファベット大文字・小文字・記号を含む必要があります」と
   表示されますが、実際の判定条件はアクセスコード `1359`（環境変数 `ACCESS_CODE`）
   との一致のみです。

## Cloudflareへのデプロイ手順

1. Cloudflareにログインする

       npx wrangler login

2. シークレットを登録する（対話プロンプトで値を入力）

       npx wrangler secret put CLAUDE_API_KEY
       npx wrangler secret put SESSION_SECRET
       npx wrangler secret put ACCESS_CODE

   - `CLAUDE_API_KEY` は必須
   - `SESSION_SECRET` は必須（32文字以上のランダムな値を推奨）
   - `ACCESS_CODE` は任意（未設定時は `1359` にフォールバック。要件どおり `1359`
     を使う場合はこのステップで `1359` と入力する）

   秘密情報を `wrangler.toml` に平文で書かないでください。

3. デプロイする

       npm run deploy

4. 発行された `https://<name>.<account>.workers.dev` にアクセスし、
   アクセスコードでログインして動作確認する

## 更新デプロイ

コード変更後は `npm run deploy` を再実行してください。
環境変数だけを変更する場合は、対象の `wrangler secret put` を再実行してください。

## API構成

- `POST /api/login`: アクセスコードを検証しセッションCookieを発行
- `POST /api/logout`: セッションCookieを削除
- `GET /api/session`: 現在の認証状態を返す
- `GET /api/models`: 認証後に利用可能なモデル一覧を返す
- `POST /api/chat`: 認証後にClaude Messages APIへ接続し、NDJSON形式でストリーミング応答を返す

Claudeからの生のSSEをブラウザへ直接転送せず、Worker側で解析し
`{"type":"delta","text":"..."}` / `{"type":"done"}` / `{"type":"error","message":"..."}`
の3種類の安全なイベントのみへ変換して転送します。

## セキュリティ上の位置付け

このログインは、URLを知っているだけの利用を防ぐための簡易的なアクセス制限です。
本格的な利用者管理、権限分離、監査ログ、多要素認証を提供するものではありません。

実装上の保護:

- Claude APIキーはWorkerの環境変数（シークレット）のみに保持し、クライアントへは渡さない
- アクセスコードはクライアントコードに埋め込まない（サーバー側でのみ照合）
- セッションはHMAC署名付きのHttpOnly Cookie（`SameSite=Strict`、HTTPS時は`Secure`）
- 送信可能なモデルIDをサーバー側の許可リストで制限
- Claude API側のエラー詳細はサーバーログにのみ出力し、画面には定型メッセージのみ表示
- Markdownレンダラは依存ライブラリなしの自前実装で、常にHTMLエスケープしてから
  構造を組み立てるため、生のHTMLがレンダリング結果に混入しない
- CSP・X-Frame-Options等のセキュリティヘッダーを付与

アクセスコードが固定かつ短いため、公開範囲が広い場合やAPI利用コストが
高額になりうる場合は、Cloudflare AccessやTurnstile、レート制限、
本格的なユーザー認証基盤への置き換えを検討してください。

## テスト

    npm test

`vitest`でセッション署名の検証（改ざん検知・有効期限）と、
チャットリクエストの組み立て（モデル許可リスト、effortの適用条件、
メッセージ検証）、およびストリーミング変換（SSE→NDJSON、エラー時の
情報漏洩防止）をカバーしています。

## ファイル構成

    claude-chat/
    ├── wrangler.toml          # Worker設定（静的アセット配信を含む）
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── .dev.vars.example      # ローカル用環境変数テンプレート
    ├── src/
    │   ├── index.ts           # ルーティング・認証チェック・セキュリティヘッダー
    │   ├── auth.ts            # アクセスコード検証・セッション署名/検証
    │   ├── models.ts          # モデル一覧・effort設定
    │   └── claude.ts          # リクエスト検証・Claude API呼び出し・SSE変換
    ├── public/
    │   ├── index.html         # ログイン画面 + チャット画面
    │   ├── styles.css
    │   ├── app.js             # フロントエンドロジック
    │   └── markdown.js        # 依存関係なしの安全なMarkdownレンダラ
    └── test/
        ├── auth.test.ts
        └── claude.test.ts

## トラブルシューティング

- 「サーバーの設定が完了していません」と表示される
  → `CLAUDE_API_KEY` または `SESSION_SECRET` が未設定です。
    `wrangler secret put` で再設定してください。
- 「現在混み合っています」と表示される
  → Anthropic側のレート制限です。時間をおくか利用プランを確認してください。
