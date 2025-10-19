/**
 * Offscreen document that communicates with the sandbox iframe
 * to generate embeddings for summaries
 */

import { getBatchedEmbeddingsForSummaries } from "../utils/common.js";

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "generateEmbeddings") {
    const { summaries } = message;

    // Generate embeddings for all summaries
    getBatchedEmbeddingsForSummaries(summaries)
      .then((embeddings) => {
        sendResponse({ success: true, embeddings });
      })
      .catch((error) => {
        console.error("Error generating embeddings:", error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // Keep the message channel open for async response
  }

  if (message.type === "ping") {
    sendResponse({ success: true, pong: true });
    return false;
  }
});

console.log("Offscreen document ready for embeddings generation");
