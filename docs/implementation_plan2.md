# フォルダプレビューにおけるMDボタン配置と動作ライフサイクルの修正計画

Google Driveのフォルダ画面（`drive/folders/*`）上のプレビューにおいて、「MD」ボタンが配置されない、または位置がズレるライフサイクル不具合を、プレビュー判定の厳格化とMutationObserverのクリーンアップ条件の適正化によって解決します。

## ユーザーレビュー要求事項
特に影響のある設計上の判断はありません。

## 提案される変更点

### Content Scriptの修正

#### [MODIFY] [content.js](file:///Users/nakamegurokoumylab/Downloads/DriveMarkdownViewer/DMV/content.js)

1. **`isPreviewPage()` の修正**:
   - `div.a-b-r` はプレビューが開いていない状態でもフォルダリストのDOM上に存在するケースがあるため、プレビュー判定から除外します。
   - 代わりに、プレビューダイアログのヘッダーツールバー（`div.a-b-K[role="toolbar"]`）の存在をもってプレビュー表示中と判定します。

2. **`startObserver()` の修正**:
   - `findToolbar()` がマッチしただけでオブザーバーを停止してしまうバグを修正します。
   - ボタンが実際にDOMへ注入された（`document.getElementById('md-toggle-button')` が存在する）場合のみ、オブザーバーの切断（`cleanupObserver()`）を実行するように変更します。

```javascript
function isPreviewPage() {
  const url = window.location.href;
  const isPreviewUrl = url.includes('/file/d/') && (url.includes('/view') || url.includes('/edit') || url.match(/\/file\/d\/[a-zA-Z0-9_-]+$/));

  const isPreviewDomPresent = !!document.querySelector('div.a-b-K[role="toolbar"]');

  return isPreviewUrl || isPreviewDomPresent;
}
```

```javascript
function startObserver() {
  if (!isDrivePage()) return;

  // Attempt to inject immediately
  injectButton();

  if (document.getElementById('md-toggle-button')) {
    return; // Already injected
  }

  observer = new MutationObserver(() => {
    if (document.getElementById('md-toggle-button')) {
      cleanupObserver();
      return;
    }

    if (isPreviewPage()) {
      const toolbar = findToolbar();
      if (toolbar) {
        injectButton();
        if (document.getElementById('md-toggle-button')) {
          cleanupObserver();
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  timeoutId = setTimeout(() => {
    cleanupObserver();
    console.log("Drive Markdown Viewer: Observer timeout reached. Stopped watching.");
  }, 30000);
}
```

---

## 検証計画

### 手動検証
- フォルダ画面 `https://drive.google.com/drive/folders/1BfnNX73pL5mn8anHGTx6QUgMm-TWJV6K` で適当なmdファイルを開き、プレビュー画面の右上にボタンが正しく表示されること、および直リンク `https://drive.google.com/file/d/1-LSStEY5SQ0_0uH-h5lOMKEta24xLNlD/view` でも正しく表示されることをブラウザでテストします。
