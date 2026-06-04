# Drive Markdown Viewer — 要件定義書

## 1. 概要

Google Drive のファイルプレビュー画面（`https://drive.google.com/file/d/*/view*`）上で、Markdownファイル（`.md` / `.markdown`）のテキストをレンダリングし、整形された状態で閲覧できるChrome拡張機能。

---

## 2. 対象環境

| 項目 | 値 |
|---|---|
| ブラウザ | Google Chrome |
| Manifest | V3 |
| 対象ページ | `https://drive.google.com/file/d/*/view*` |
| 実行タイミング | `document_idle` |

---

## 3. 機能要件

### 3.2 コンテンツ取得

> [!IMPORTANT]
> **UI変更に強いセレクタ設計とフォールバックの徹底**:
> Google DriveのDOM構造は頻繁に変更されるため、絶対パスによるセレクタは避け、属性セレクタ、部分一致、および複数の代替セレクタ（フォールバック）を組み合わせてコンテンツとファイル名を取得する。

| 優先度 | 取得方法 | セレクタ・判定ロジック |
|---|---|---|
| 1（最優先） | `<pre>` 要素からtextContent | `pre[role="presentation"]`, `div[class*="viewer"] pre`, `div.a-b-r pre` |
| 2 | テキスト表示コンテナからの抽出 | `[class*="text-page"]`, `[id*="text-page"]` |
| 3 | スタイル属性による判定 | `div[style*="white-space"]` などの折り返しスタイルを持つ要素 |
| 4 | CORS回避用Fetch（バックグラウンド経由） | DOMからの取得に失敗した場合、background script経由でGoogle DriveのダウンロードURLから直接取得を試みる（フォールバック） |

#### ファイル名の取得

1. `[role="banner"]` 内のテキスト要素、または `[data-tooltip]` 付近のタイトル要素
2. クラス名に `title` または `filename` を含む要素（例: `div[class*="title"]`, `[class*="filename"]`）
3. フォールバック: `document.title` から不要な文字列（「 - Google ドライブ」など）を除去

### 3.3 Markdown レンダリング

| 項目 | 仕様 |
|---|---|
| パーサー | [marked.min.js]（GFM, breaks: true） |
| サニタイズ | [purify.min.js]（DOMPurify, HTMLプロファイル） |
| シンタックスハイライト | [highlight.min.js]（highlight.js、コードブロックの言語自動判定・ハイライト表示） |
| ハイライト用スタイル | `github-dark.min.css`（またはダークテーマに調和するスタイルシート） |
| フォールバック | 基本的なMarkdown変換（h1–h3, bold, italic, code, 改行） |

#### サポートするMarkdown構文

- 見出し（h1–h6）
- 太字・斜体
- リンク
- リスト（ul, ol）
- 引用（blockquote）
- インラインコード・コードブロック（シンタックスハイライト付き）
- テーブル
- 水平線
- 画像
- タスクリスト（チェックボックス）

### 3.4 UIトグルボタン

- **位置**: Driveファイルプレビューのツールバー内に挿入
- **ラベル**: `MD`（アイコン + テキスト）
- **動作**: クリックでMarkdown表示 ↔ 元の表示をトグル
- **状態表示**:
  - 非アクティブ: 半透明の背景
  - アクティブ: 青色グラデーション背景 + ラベル「元に戻す」
  - ローディング: スピナー + 「読み込み中…」

#### ボタン挿入のセレクタ優先順位（UI変更に強い設計）

1. アクションボタン群のコンテナ: `[data-tooltip*="開く"]` または `[data-tooltip*="Open with"]` を持つ要素の親・兄弟要素
2. ツールバー要素: `[role="toolbar"]`, `header`, `[role="banner"]` 内の右側ボタン群エリア
3. 動的監視: `MutationObserver` を用いて、上記ツールバー要素がDOMに追加されるのを検知して挿入する


### 3.5 表示方式

> [!IMPORTANT]
> **全画面オーバーレイは使用しない**。Driveプレビューのコンテンツ領域内にインライン表示する。

| モード | 条件 | 表示先 |
|---|---|---|
| **インライン（主）** | コンテナ検出成功時 | `div.a-b-r > div > div` 内に挿入 |
| **オーバーレイ（副）** | コンテナ検出失敗時のみ | `position: fixed` の全画面オーバーレイ |

#### インライン表示の動作

1. コンテナ内の既存の子要素を `display: none` で隠す
2. 新しい `div.md-viewer-inline` を追加してレンダリング結果を表示
3. 「元に戻す」クリック時に元の子要素の表示を復元

### 3.6 エラーハンドリング

| 状況 | 表示メッセージ |
|---|---|
| DOMからテキスト取得失敗 | 「ファイルの内容を取得できませんでした。Driveプレビューにテキストが表示されていることを確認してください。」 |
| その他のエラー | 「エラーが発生しました: {error.message}」 |

---

## 4. 非機能要件

### 4.1 アーキテクチャ

- **content script と background script の連携**
  - **content script**: DOM解析、UIトグルボタンの挿入、Markdownレンダリング（marked.js, DOMPurify, highlight.jsを使用）
  - **background script (service worker)**: DOMからファイルコンテンツが取得できなかった場合の代替手段として、認証済みのコンテキストを利用してGoogle Drive APIまたはファイルダウンロードURLからデータをFetchし、content scriptにメッセージ送信する役割を担う
- Google認証・OAuthトークン: 基本的にはブラウザのCookie/セッション情報を再利用する（追加の認証フローは不要）

### 4.2 セキュリティ

- DOMPurify によるHTMLサニタイズ必須
- 最小権限の原則: `activeTab` + `host_permissions: drive.google.com` のみ

### 4.3 UX

- フェードイン/アウトアニメーション（CSS transition 0.3s）
- ローディングスピナー表示
- ESCキーで閉じる（オーバーレイモード時）
- ダークテーマベース（`#1a1a2e` 背景、`#8ab4f8` アクセント）

### 4.4 DOM監視

- `MutationObserver` でツールバーの出現を監視
- 30秒のタイムアウトで監視を自動停止

---

## 5. 技術スタック

| 要素 | 技術 |
|---|---|
| 拡張規格 | Chrome Extension Manifest V3 |
| Markdown パーサー | marked.js（バンドル済） |
| サニタイザー | DOMPurify（バンドル済） |
| スタイリング | Vanilla CSS（content.css） |
| DOM 操作 | Vanilla JavaScript |

---

## 6. ファイル構成

```
DriveMarkdownViewer/
├── manifest.json          # 拡張設定（content_scripts と background の定義）
├── content.js             # メインロジック（content script）
├── content.css            # スタイルシート
├── background.js          # メッセージング・CORS回避用フェッチ処理（background script）
├── icons/                 # 拡張アイコン
└── lib/
    ├── marked.min.js      # Markdown パーサー
    ├── purify.min.js      # HTML サニタイザー
    ├── highlight.min.js   # シンタックスハイライター
    └── github-dark.min.css # コードハイライト用スタイル（ダークテーマ用）
```

---

## 7. 既知の制約事項

| 制約 | 理由 |
|---|---|
| Driveプレビューにテキストが表示されず、かつダウンロードURLからの取得も不可能なファイルでは動作しない | バイナリファイルやGoogleアカウントの権限不足などの制限がある場合 |
| Googleがプレビュー画面のDOM構造を大幅に変更するとボタンの自動挿入などが機能しなくなる可能性がある | セレクタを動的・抽象的に指定しているが、根本的な構造変化には追従が必要なため |
| 画像参照は相対パスの場合表示不可 | Drive上の画像は直接URLで参照する必要がある |
