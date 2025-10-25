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

/** @type {{ timeout: NodeJS.Timeout, tabId: number, url: string, }} */
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

// TODO: 30 seconds
const MIN_TIME_REQUIRED_MS = 3_000;
const getActiveTab = async () =>
  (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
async function runner() {
  const tab = await getActiveTab();
  const data = { tabId: tab?.id, windowId: tab?.windowId, url: tab?.url, title: tab?.title, };
  const WAIT_TEXT = 'Waiting for you to spend over thirty seconds on this page, before we save this page.';
  console.debug('Runner data', data);
  if (!data.tabId) {
    // show failed badge info - don't set any badge info because tab id is missing
    // setTitleTextAndColor(data.tabId, 'fail', INACCESSIBLE_REASON);
    clearTimeout(previousWait?.timeout);
    return;
  }
  const tabNormalizedURL = getNormalizedURL(data.url);
  if (!tabNormalizedURL) {
    console.debug('Runner exit on invalid URL', data.url);
    setTitleTextAndColor(data.tabId, 'fail', INACCESSIBLE_REASON);
    clearTimeout(previousWait?.timeout);
    return;
  }
  if (previousWait?.timeout) {
    if (data.tabId === previousWait.tabId && previousWait.url === tabNormalizedURL) {
      console.debug('Runner update ignored as already waiting on same tab');
      setTitleTextAndColor(data.tabId, 'waiting', WAIT_TEXT);
      // we got an event elsewhere while we're still waiting for the same active tab
      // ignore the event
      return;
    }
    console.debug('Runner cleared previous wait timeout, will check new');
    // clear the timer on the active tab as now we'll be looking at some other active tab
    clearTimeout(previousWait?.timeout);
    previousWait = null;
  }
  if (!(await isCSActive(data.tabId))) {
    // show failed badge info
    console.debug("Runner exit because CS inactive", data.url);
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
  if (blacklist.includes(origin)) {
    console.debug("Runner exit as origin is in blacklist", blacklist, origin)
    setTitleTextAndColor(data.tabId, "fail", 'you have disabled predictions on this webpage');
    return;
  }
  if (checkCacheOrPending(data.tabId, data.url)) {
    return;
  }
  const timeSpent = await getCSTimeSpent(data.tabId);
  const timeRemaining = MIN_TIME_REQUIRED_MS - timeSpent;
  // console.log('time remaining', timeRemaining);
  if (timeRemaining <= 0) {
    console.debug("Runner run immediately");
    // run immediately
    gatherInfo(data);
  } else {
    console.debug("Runner waiting for timeout", timeRemaining);
    previousWait = {
      tabId: data.tabId,
      timeout: setTimeout(() => {
        previousWait = null;
        runner();
      }, timeRemaining),
      url: tabNormalizedURL
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