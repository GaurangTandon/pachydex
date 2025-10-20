import { gatherInfo } from "./bg.js";
import { initEmbeddingProcessor } from "./embedding-processor.js";

// Initialize embedding processor
initEmbeddingProcessor();

// Open home page on install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/summary_view/index.html')
    });
  }
});

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