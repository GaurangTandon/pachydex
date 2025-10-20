import { checkCacheOrPending, gatherInfo, getCSTimeSpent, getNormalizedURL, INACCESSIBLE_REASON, isCSActive, resetBadge, setTitleTextAndColor } from "./bg.js";
import { initEmbeddingProcessor } from "./embedding-processor.js";

// Initialize embedding processor
initEmbeddingProcessor();

// Listen for language message from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getLanguage") {
    chrome.storage.local.get("language", (result) => {
      let lang = result.language;
      if (!lang) {
        // Determine preferred language: 'es' or 'ja', else default to 'en'
        const langNav = navigator.language;
        if (langNav.startsWith('es')) {
          lang = 'es';
        } else if (langNav.startsWith('ja')) {
          lang = 'ja';
        } else {
          lang = 'en';
        }
      }
      sendResponse({ language: lang });
    });
    // Return true to indicate async response
    return true;
  }
});

// Open home page on install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/summary_view/index.html')
    });
  }
});

let previousWait = null;
function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
async function getBlacklist() {
  const result = await chrome.storage.local.get("blacklist");
  return result.blacklist || [];
}
const MIN_TIME_SPENT_MS = 3_000;
const getActiveTab = async () =>
  (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
async function runner() {
  const tab = await getActiveTab();
  const data = { tabId: tab?.id, windowId: tab?.windowId, url: tab?.url, title: tab?.title, };
  const WAIT_TEXT = 'Waiting for you to spend over thirty seconds on this page, before we save this page.';
  // console.log(data);
  if (previousWait?.timeout) {
    if (data.tabId === previousWait.tabId) {
      // console.log('ignored');
      setTitleTextAndColor(data.tabId, 'waiting', WAIT_TEXT);
      // we got an event elsewhere while we're still waiting for the same active tab
      // ignore the event
      return;
    }
    // console.log('cleared');
    // clear the timer on the active tab as now we'll be looking at some other active tab
    clearTimeout(previousWait?.timeout);
    previousWait = null;
  }
  if (!data.tabId) {
    // show failed badge info
    setTitleTextAndColor(data.tabId, 'fail', INACCESSIBLE_REASON);
    return;
  }
  const tabNormalizedURL = getNormalizedURL(data.url);
  if (!tabNormalizedURL) {
    console.debug('Exit on invalid URL', data.url);
    setTitleTextAndColor(data.tabId, 'fail', INACCESSIBLE_REASON);
    return;
  }
  if (!(await isCSActive(data.tabId))) {
    // show failed badge info
    console.debug("Exit because CS inactive", data.url);
    if (data.url.startsWith('chrome-extension://') && data.url.endsWith('summary_view/index.html')) {
      // don't show badge on the extension's own page haha
      resetBadge(data.tabId);
    } else {
      setTitleTextAndColor(data.tabId, "fail", INACCESSIBLE_REASON);
    }
    return;
  }
  const blacklist = await getBlacklist();
  const origin = getOrigin(data.url);
  // console.log(blacklist, origin)
  if (blacklist.includes(origin)) {
    setTitleTextAndColor(data.tabId, "fail", 'you have disabled predictions on this webpage');
    return;
  }
  if (checkCacheOrPending(data.tabId, data.url)) {
    return;
  }
  const timeSpent = await getCSTimeSpent(data.tabId);
  const timeRemaining = -timeSpent + MIN_TIME_SPENT_MS;
  // console.log('time remaining', timeRemaining);
  if (timeRemaining <= 0) {
    // run immediately
    gatherInfo(data);
  } else {
    previousWait = {
      tabId: data.tabId,
      timeout: setTimeout(() => {
        previousWait = null;
        runner();
      }, timeRemaining),
    }
    setTitleTextAndColor(data.tabId, 'waiting', WAIT_TEXT);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    // Only fires for the root frame
    runner();
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  runner();
});

chrome.tabs.onActivated.addListener(() => {
  runner();
});

chrome.tabs.query({}).then(tabs => {
  tabs.forEach(async (tab) => {
    if (!(await isCSActive(tab.id))) {
      chrome.scripting.executeScript({
        target: {
          tabId: tab.id,
          allFrames: true,
        },
        files: ['src/content.js'],
      }).catch(() => { });
    }
  });

  // run once at start
  setTimeout(runner, 1000);
})