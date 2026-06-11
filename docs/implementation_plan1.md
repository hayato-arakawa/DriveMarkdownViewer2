# フォルダプレビューと直リンクの環境分離およびMDボタン配置の修正計画

Google Driveのフォルダ画面（`drive/folders/*`）上のプレビューにおいて、依然として「MD」ボタンが左上に誤配置される不具合を、環境の完全分離（URL判定による個別ロジック適用）によって解決します。

## ユーザーレビュー要求事項
特に影響のある設計上の判断はありません。

## 提案される変更点

### Content Scriptの修正

#### [MODIFY] [content.js](file:///Users/nakamegurokoumylab/Downloads/DriveMarkdownViewer/DMV/content.js)

1. **`findToolbar()` の完全分離化**:
   - `window.location.href` を確認し、`drive.google.com/drive`（フォルダやリスト表示）と `drive.google.com/file/d`（直リンク）でロジックを完全に分けます。
   - `drive.google.com/drive` の場合は、プレビューヘッダー（`div.xWSG7`）の直下にある安定した属性 `div[jsname="anhgRb"] > div` から直接ボタンコンテナを取得します。これによって、背景ページのアクションボタンとの干渉を完全に防ぎます。

2. **`injectButton()` の挿入対象探索の改善**:
   - ボタンコンテナ内部の「Google ドキュメントで開く」ボタンをテキストコンテンツ判定（`Google ドキュメント` / `Google Docs` 等）を用いて確実に特定し、その右隣に挿入します。

```javascript
function findToolbar() {
  const url = window.location.href;

  // Case A: Google Drive Folder Page (drive/folders/* or other list views)
  if (url.includes('drive.google.com/drive')) {
    const previewHeader = document.querySelector('div.xWSG7');
    if (previewHeader) {
      // Find the stable action buttons container using jsname
      const buttonContainer = previewHeader.querySelector('div[jsname="anhgRb"] > div');
      if (buttonContainer) return buttonContainer;
      
      // Fallbacks inside preview header
      const rWIAq = previewHeader.querySelector('div.rWIAq');
      if (rWIAq) return rWIAq;
      
      return previewHeader;
    }
    return null;
  }

  // Case B: Standalone File Preview Page (file/d/*)
  // Priority 0: Preview toolbar
  const previewToolbar = document.querySelector('div.a-b-K[role="toolbar"]');
  if (previewToolbar) return previewToolbar;

  // Selector Priority 1: Parent or sibling of "Open with" / "アプリで開く" / "開く"
  const openWithBtn = document.querySelector('[data-tooltip*="開く"], [data-tooltip*="Open with"], [data-tooltip*="アプリで開く"], [aria-label*="開く"], [aria-label*="Open with"]');
  if (openWithBtn) {
    const parent = openWithBtn.parentElement;
    if (parent) return parent;
  }

  // Custom target selector for folder pages (fallback)
  const customTarget = document.querySelector("div.rWIAq");
  if (customTarget) return customTarget;

  // Selector Priority 2: Toolbar role elements
  const toolbar = document.querySelector('[role="toolbar"]');
  if (toolbar) return toolbar;
  ...
```

---

## 検証計画

### 手動検証
- フォルダ画面 `https://drive.google.com/drive/folders/1BfnNX73pL5mn8anHGTx6QUgMm-TWJV6K` で適当なmdファイルを開き、プレビュー画面の右上にボタンが正しく表示されること、および直リンク `https://drive.google.com/file/d/1-LSStEY5SQ0_0uH-h5lOMKEta24xLNlD/view` でも正しく表示されることをブラウザでテストします。
