// Drive Markdown Viewer Content Script (content.js)

let isButtonInjected = false;
let isMarkdownActive = false;
let originalChildrenStates = [];
let inlineViewerElement = null;
let overlayViewerElement = null;
let currentUrl = window.location.href;

let observer = null;
let timeoutId = null;

// ==========================================
// SPA URL and Page Checks
// ==========================================
function isPreviewPage() {
  const url = window.location.href;
  return url.includes('/file/d/') && (url.includes('/view') || url.includes('/edit') || url.match(/\/file\/d\/[a-zA-Z0-9_-]+$/));
}

function checkUrlChange() {
  const url = window.location.href;
  if (url !== currentUrl) {
    console.log("Drive Markdown Viewer: URL changed from", currentUrl, "to", url);
    currentUrl = url;
    
    // Deactivate/cleanup any active viewers from previous pages
    if (isMarkdownActive) {
      restoreOriginalView();
    } else {
      // Direct hard cleanup to be safe
      hardCleanup();
    }
    
    cleanupObserver();
    
    if (isPreviewPage()) {
      startObserver();
    }
  }
}

function hardCleanup() {
  isButtonInjected = false;
  isMarkdownActive = false;
  originalChildrenStates = [];
  
  if (inlineViewerElement) {
    inlineViewerElement.remove();
    inlineViewerElement = null;
  }
  if (overlayViewerElement) {
    overlayViewerElement.remove();
    overlayViewerElement = null;
  }
  
  const existingBtn = document.getElementById('md-toggle-button');
  if (existingBtn) {
    existingBtn.remove();
  }
  
  document.removeEventListener('keydown', handleOverlayEsc);
}

// ==========================================
// DOM Selectors for Toolbar & Scraping
// ==========================================
function findToolbar() {
  // Selector Priority 1: Parent or sibling of "Open with" / "アプリで開く" / "開く"
  const openWithBtn = document.querySelector('[data-tooltip*="開く"], [data-tooltip*="Open with"], [data-tooltip*="アプリで開く"], [aria-label*="開く"], [aria-label*="Open with"]');
  if (openWithBtn) {
    const parent = openWithBtn.parentElement;
    if (parent) return parent;
  }
  
  // Selector Priority 2: Toolbar role elements
  const toolbar = document.querySelector('[role="toolbar"]');
  if (toolbar) return toolbar;
  
  // Header / Banner right side elements
  const header = document.querySelector('header');
  if (header) {
    const rightButtons = header.querySelector('div[style*="justify-content: flex-end"], div[class*="right"], div[class*="buttons"]');
    if (rightButtons) return rightButtons;
    return header;
  }
  
  const banner = document.querySelector('[role="banner"]');
  if (banner) {
    const buttonsContainer = banner.querySelector('div[class*="button"], div[class*="toolbar"]');
    if (buttonsContainer) return buttonsContainer;
    return banner;
  }

  // Generic fallback toolbar class selectors
  const driveToolbar = document.querySelector('.nd-toolbar, .drive-viewer-toolbar');
  if (driveToolbar) return driveToolbar;
  
  return null;
}

function findContentArea() {
  // Primary container: div.a-b-r > div > div
  const container = document.querySelector('div.a-b-r > div > div');
  if (container) return container;
  
  // Secondary fallback: Direct child of main viewer div.a-b-r
  const mainViewer = document.querySelector('div.a-b-r');
  if (mainViewer) {
    const primaryChild = mainViewer.querySelector('div');
    if (primaryChild) {
      const secondaryChild = primaryChild.querySelector('div');
      if (secondaryChild) return secondaryChild;
      return primaryChild;
    }
    return mainViewer;
  }
  
  // Tertiary: general viewer body selectors
  const viewerContainer = document.querySelector('[class*="viewer-content"], [class*="viewer-body"], .nd-viewer-body');
  if (viewerContainer) return viewerContainer;

  return null;
}

// ==========================================
// Content Scraping & Fetching
// ==========================================
async function acquireContent() {
  // Priority 1: <pre> tags with specific attributes
  let text = scrapePreElements();
  if (text) {
    console.log("Drive Markdown Viewer: Scraped content from <pre> tags");
    return text;
  }
  
  // Priority 2: Text page container classes
  text = scrapeTextPages();
  if (text) {
    console.log("Drive Markdown Viewer: Scraped content from text page container");
    return text;
  }
  
  // Priority 3: style attributes indicating white-space
  text = scrapeWhiteSpaceDivs();
  if (text) {
    console.log("Drive Markdown Viewer: Scraped content from white-space style divs");
    return text;
  }
  
  // Priority 4: Background Service Worker direct download fetch
  text = await fetchFromBackground();
  if (text) {
    console.log("Drive Markdown Viewer: Acquired content via Background Fetch");
    return text;
  }
  
  return null;
}

function scrapePreElements() {
  const selectors = [
    'pre[role="presentation"]',
    'div[class*="viewer"] pre',
    'div.a-b-r pre',
    '.drive-viewer-text-content pre',
    'pre'
  ];
  
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      const parts = [];
      elements.forEach(el => {
        if (el.textContent) parts.push(el.textContent);
      });
      const content = parts.join('\n');
      if (content.trim().length > 0) {
        return content;
      }
    }
  }
  return null;
}

function scrapeTextPages() {
  const selectors = [
    '[class*="text-page"]',
    '[id*="text-page"]',
    '.drive-viewer-text-page'
  ];
  
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      const parts = [];
      elements.forEach(el => {
        if (el.textContent) parts.push(el.textContent);
      });
      const content = parts.join('\n');
      if (content.trim().length > 0) {
        return content;
      }
    }
  }
  return null;
}

function scrapeWhiteSpaceDivs() {
  const elements = document.querySelectorAll('div[style*="white-space"]');
  if (elements.length > 0) {
    const parts = [];
    elements.forEach(el => {
      // Ensure we extract leaf node text to prevent duplicates
      if (el.children.length === 0 && el.textContent) {
        parts.push(el.textContent);
      }
    });
    const content = parts.join('\n');
    if (content.trim().length > 0) {
      return content;
    }
  }
  return null;
}

async function fetchFromBackground() {
  const url = window.location.href;
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    return null;
  }
  
  const fileId = match[1];
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "fetchContent", fileId: fileId }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Chrome runtime error during fetch:", chrome.runtime.lastError);
        resolve(null);
      } else if (response && response.success) {
        resolve(response.content);
      } else {
        console.warn("Background fetch failed:", response ? response.error : "no response");
        resolve(null);
      }
    });
  });
}

// ==========================================
// Filename Scraping
// ==========================================
function acquireFileName() {
  // Priority 1: Title in role="banner"
  const banner = document.querySelector('[role="banner"]');
  if (banner) {
    const titleCandidates = banner.querySelectorAll('[class*="title"], [class*="name"], [id*="title"], [id*="name"]');
    for (const el of titleCandidates) {
      if (el.textContent && el.textContent.trim().length > 0 && el.children.length === 0) {
        return el.textContent.trim();
      }
    }
    
    const ariaLabels = banner.querySelectorAll('[aria-label]');
    for (const el of ariaLabels) {
      const label = el.getAttribute('aria-label');
      if (label && (label.endsWith('.md') || label.endsWith('.markdown'))) {
        return label;
      }
    }
  }

  // Priority 2: General title classes
  const generalTitles = document.querySelectorAll('div[class*="title"], div[class*="filename"], span[class*="title"], span[class*="filename"]');
  for (const el of generalTitles) {
    if (el.textContent && el.textContent.trim().includes('.') && el.children.length === 0) {
      return el.textContent.trim();
    }
  }

  // Priority 3: Clean up document.title
  let docTitle = document.title;
  if (docTitle) {
    docTitle = docTitle.replace(/ - Google (ドライブ|ドライブプレビュー|Drive|Drive Preview)/i, '');
    docTitle = docTitle.replace(/ - Google (ドキュメント|Docs)/i, '');
    return docTitle.trim();
  }
  
  return 'Markdown File';
}

// ==========================================
// Markdown Core Toggle Functions
// ==========================================
function toggleMarkdownView() {
  if (isMarkdownActive) {
    restoreOriginalView();
  } else {
    activateMarkdownView();
  }
}

async function activateMarkdownView() {
  const btn = document.getElementById('md-toggle-button');
  if (!btn) return;
  
  // Transition button to loading state
  btn.className = 'md-toggle-btn loading';
  const btnText = btn.querySelector('.btn-text');
  if (btnText) btnText.textContent = '読み込み中…';
  
  if (!btn.querySelector('.md-btn-spinner')) {
    const spinner = document.createElement('div');
    spinner.className = 'md-btn-spinner';
    btn.insertBefore(spinner, btn.firstChild);
  }
  
  try {
    const rawContent = await acquireContent();
    if (!rawContent) {
      throw new Error("ファイルの内容を取得できませんでした。Driveプレビューにテキストが表示されていることを確認してください。");
    }
    
    // Parse Markdown
    let renderedHtml = '';
    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
      marked.setOptions({
        gfm: true,
        breaks: true
      });
      renderedHtml = marked.parse(rawContent);
    } else {
      console.warn("marked.js not available, utilizing basic fallback parser");
      renderedHtml = fallbackMarkdownParser(rawContent);
    }
    
    // Sanitize HTML
    if (typeof DOMPurify !== 'undefined' && typeof DOMPurify.sanitize === 'function') {
      renderedHtml = DOMPurify.sanitize(renderedHtml);
    } else {
      console.warn("DOMPurify not available, skipping HTML sanitization");
    }
    
    // Layout and Display Selection
    const contentArea = findContentArea();
    const fileName = acquireFileName();
    
    if (contentArea) {
      displayInline(contentArea, renderedHtml);
    } else {
      displayOverlay(fileName, renderedHtml);
    }
    
    // Highlight Code Syntax
    applySyntaxHighlighting();
    
    // Toggle active state on button
    btn.className = 'md-toggle-btn active';
    if (btnText) btnText.textContent = '元に戻す';
    const spinner = btn.querySelector('.md-btn-spinner');
    if (spinner) spinner.remove();
    
    isMarkdownActive = true;
    
  } catch (error) {
    console.error("Drive Markdown Viewer Toggle Error:", error);
    showErrorMessage(error.message);
    
    btn.className = 'md-toggle-btn';
    if (btnText) btnText.textContent = 'エラー';
    const spinner = btn.querySelector('.md-btn-spinner');
    if (spinner) spinner.remove();
    
    // Return button state after 4 seconds
    setTimeout(() => {
      if (btn.querySelector('.btn-text') && btn.querySelector('.btn-text').textContent === 'エラー') {
        restoreOriginalView();
      }
    }, 4000);
  }
}

function restoreOriginalView() {
  const btn = document.getElementById('md-toggle-button');
  if (btn) {
    btn.className = 'md-toggle-btn';
    const btnText = btn.querySelector('.btn-text');
    if (btnText) btnText.textContent = 'MD';
    const spinner = btn.querySelector('.md-btn-spinner');
    if (spinner) spinner.remove();
  }
  
  // 1. Re-display hidden children in contentArea
  if (originalChildrenStates.length > 0) {
    originalChildrenStates.forEach(state => {
      if (state.element) {
        state.element.style.display = state.originalDisplay;
      }
    });
    originalChildrenStates = [];
  }
  
  // 2. Remove inline viewer
  if (inlineViewerElement) {
    inlineViewerElement.remove();
    inlineViewerElement = null;
  }
  
  // 3. Remove overlay viewer
  if (overlayViewerElement) {
    overlayViewerElement.classList.remove('fade-in');
    setTimeout(() => {
      if (overlayViewerElement) {
        overlayViewerElement.remove();
        overlayViewerElement = null;
      }
    }, 300);
  }
  
  isMarkdownActive = false;
  document.removeEventListener('keydown', handleOverlayEsc);
}

// ==========================================
// Rendering Displays (Inline / Overlay)
// ==========================================
function displayInline(contentArea, renderedHtml) {
  originalChildrenStates = [];
  Array.from(contentArea.children).forEach(child => {
    if (child.classList.contains('md-viewer-inline')) return;
    
    originalChildrenStates.push({
      element: child,
      originalDisplay: child.style.display
    });
    child.style.display = 'none';
  });
  
  inlineViewerElement = document.createElement('div');
  inlineViewerElement.className = 'md-viewer-inline';
  
  const contentWrap = document.createElement('div');
  contentWrap.className = 'md-viewer-content md-rendered';
  contentWrap.innerHTML = renderedHtml;
  
  inlineViewerElement.appendChild(contentWrap);
  contentArea.appendChild(inlineViewerElement);
  
  requestAnimationFrame(() => {
    if (inlineViewerElement) inlineViewerElement.classList.add('fade-in');
  });
}

function displayOverlay(fileName, renderedHtml) {
  if (overlayViewerElement) {
    overlayViewerElement.remove();
  }
  
  overlayViewerElement = document.createElement('div');
  overlayViewerElement.className = 'md-viewer-overlay';
  
  overlayViewerElement.innerHTML = `
    <div class="md-viewer-overlay-card">
      <div class="md-viewer-overlay-header">
        <div class="md-viewer-overlay-title">${escapeHtml(fileName)}</div>
        <button class="md-viewer-overlay-close-btn" id="md-overlay-close">
          <svg viewBox="0 0 24 24">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
      <div class="md-viewer-overlay-body md-rendered">
        ${renderedHtml}
      </div>
    </div>
  `;
  
  document.body.appendChild(overlayViewerElement);
  
  document.getElementById('md-overlay-close').addEventListener('click', restoreOriginalView);
  document.addEventListener('keydown', handleOverlayEsc);
  
  requestAnimationFrame(() => {
    if (overlayViewerElement) overlayViewerElement.classList.add('fade-in');
  });
}

function handleOverlayEsc(e) {
  if (e.key === 'Escape') {
    restoreOriginalView();
  }
}

function showErrorMessage(message) {
  const contentArea = findContentArea();
  const errorHtml = `
    <div class="md-error-container">
      <svg class="md-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <div class="md-error-title">読み込みエラー</div>
      <div class="md-error-msg">${escapeHtml(message)}</div>
    </div>
  `;
  
  if (contentArea) {
    displayInline(contentArea, errorHtml);
  } else {
    const fileName = acquireFileName();
    displayOverlay(fileName, errorHtml);
  }
}

// ==========================================
// Syntax Highlighting & Utility Helpers
// ==========================================
function applySyntaxHighlighting() {
  if (typeof hljs !== 'undefined') {
    const codeBlocks = document.querySelectorAll('.md-rendered pre code');
    codeBlocks.forEach(block => {
      try {
        if (typeof hljs.highlightElement === 'function') {
          hljs.highlightElement(block);
        } else if (typeof hljs.highlightBlock === 'function') {
          hljs.highlightBlock(block);
        }
      } catch (err) {
        console.error("hljs highlighting block failed:", err);
      }
    });
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fallbackMarkdownParser(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  
  // Headers h1 - h6
  html = html.replace(/^###### (.*$)/gim, '<h6>$1</h6>');
  html = html.replace(/^##### (.*$)/gim, '<h5>$1</h5>');
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  
  // Bold, Italic
  html = html.replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>');
  html = html.replace(/\*(.*)\*/gim, '<em>$1</em>');
  
  // Links
  html = html.replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2" target="_blank">$1</a>');
  
  // Inline code
  html = html.replace(/`(.*?)`/gim, '<code>$1</code>');
  
  // Linebreaks and basic paragraphs
  html = html.split('\n\n').map(p => {
    if (p.trim().startsWith('<h') || p.trim().startsWith('<pre') || p.trim().startsWith('<ul') || p.trim().startsWith('<ol')) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  
  return html;
}

// ==========================================
// Button Injection Logic with Observer
// ==========================================
function injectButton() {
  if (isButtonInjected) return;
  
  // If button already exists in page (e.g. from previous checks), avoid duplicates
  if (document.getElementById('md-toggle-button')) {
    isButtonInjected = true;
    return;
  }

  const toolbar = findToolbar();
  if (!toolbar) return;
  
  const btn = document.createElement('button');
  btn.className = 'md-toggle-btn';
  btn.id = 'md-toggle-button';
  btn.innerHTML = `
    <svg viewBox="0 0 16 16">
      <path d="M14.85 3H1.15C.52 3 0 3.52 0 4.15v7.7c0 .63.52 1.15 1.15 1.15h13.7c.63 0 1.15-.52 1.15-1.15v-7.7C16 3.52 15.48 3 14.85 3zM9 10.5H7.5V7.87L6 9.38 4.5 7.87V10.5H3V5.5h1.5l1.5 1.5 1.5-1.5H9v5zm4-2.5h-1.5V5.5H10V8H8.5l2 2.5 2.5-2.5z"/>
    </svg>
    <span class="btn-text">MD</span>
  `;
  
  btn.addEventListener('click', toggleMarkdownView);
  
  // Attempt to insert near the "Open with" button, otherwise insert at the end
  const openWithBtn = toolbar.querySelector('[data-tooltip*="開く"], [data-tooltip*="Open with"], [data-tooltip*="アプリで開く"], [aria-label*="開く"], [aria-label*="Open with"]');
  if (openWithBtn) {
    toolbar.insertBefore(btn, openWithBtn.nextSibling);
  } else {
    toolbar.appendChild(btn);
  }
  
  isButtonInjected = true;
  console.log("Drive Markdown Viewer: Toggle button successfully injected.");
}

function startObserver() {
  if (!isPreviewPage()) return;
  
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
    
    const toolbar = findToolbar();
    if (toolbar) {
      injectButton();
      cleanupObserver();
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

function cleanupObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

// Initialize SPA listeners
setInterval(checkUrlChange, 1000);
window.addEventListener('popstate', checkUrlChange);

// Run initial execution if matched
if (isPreviewPage()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
}
