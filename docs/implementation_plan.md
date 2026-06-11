# MDボタンの配置不具合の修正計画

Google Driveのフォルダ画面（`drive/folders/*`）からMarkdownファイルをプレビュー表示した際、「MD」ボタンが画面左上に表示されてしまう問題を解決します。

## ユーザーレビュー要求事項
特に影響のある設計上の判断はありません。`content.js` 内の優先順位を修正するのみとなります。

## 提案される変更点

### Content Scriptの修正

#### [MODIFY] [content.js](file:///Users/nakamegurokoumylab/Downloads/DriveMarkdownViewer/DMV/content.js)

`findToolbar()` 関数において、`div.rWIAq`（フォルダプレビュー時のヘッダー大枠コンテナ）を直接返す処理の優先順位を下げ、「アプリで開く」等のボタンの親要素（`openWithBtn.parentElement`、直接のボタンコンテナ）を返す処理を優先させます。

これにより、ボタンが正しい親コンテナに挿入され、`file/d/*/view` と同様に画面右上（「アプリで開く」等の隣）に綺麗に配置されるようになります。

```javascript
function findToolbar() {
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

### 自動テスト
- なし

### 手動検証
- フォルダ画面 `https://drive.google.com/drive/folders/1BfnNX73pL5mn8anHGTx6QUgMm-TWJV6K` で適当なmdファイルを開き、プレビュー画面の右上にボタンが正しく表示されること、および直リンク `https://drive.google.com/file/d/1-LSStEY5SQ0_0uH-h5lOMKEta24xLNlD/view` でも正しく表示されることをブラウザでテストします。
