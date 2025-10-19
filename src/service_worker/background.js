import { gatherInfo } from "./bg.js";
import { initEmbeddingProcessor } from "./embedding-processor.js";

// Initialize embedding processor
initEmbeddingProcessor();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    setTimeout(() => {
      gatherInfo();
    });
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  setTimeout(() => {
    gatherInfo();
  }, 1000);
});

chrome.tabs.onActivated.addListener(() => {
  setTimeout(() => {
    gatherInfo();
  }, 1000);
});