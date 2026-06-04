// Chrome Extension Service Worker (background.js)

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchContent") {
    const { fileId } = request;
    if (!fileId) {
      sendResponse({ success: false, error: "No file ID provided" });
      return false;
    }

    // Google Drive direct download URL
    const url = `https://drive.google.com/uc?export=download&id=${fileId}`;

    fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP status ${response.status}`);
        }
        const text = await response.text();

        // Basic check to see if we hit a Google Drive HTML page (like login or error pages) instead of raw text.
        // Markdown files shouldn't be HTML.
        if (text.trim().startsWith("<!DOCTYPE html>") || text.includes("<html") || text.includes("Google Drive - Virus scan warning")) {
          throw new Error("Unable to retrieve raw content (received HTML page). The file might be too large or restricted.");
        }

        sendResponse({ success: true, content: text });
      })
      .catch((error) => {
        console.error(`Error fetching file ${fileId} in background:`, error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // Keep the message channel open for sendResponse asynchronously
  }
});
