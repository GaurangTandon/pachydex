import { userSummariesDb } from "../utils/indexeddb.js";
import {
  getPrediction,
} from "./ai.js";

const shouldLog = true;
function log(...args) {
  if (shouldLog) {
    console.log(...args);
  }
}

const getActiveTab = () =>
  chrome.tabs.query({ active: true, currentWindow: true });
let lastScreenshot = null;
/**
 * @param {string} imageString
 * @returns {Promise<Blob>}
 */
async function convertImageStringToResizedBlob(
  imageString,
  mimeType = "image/jpeg",
  width = 800,
  height = 600
) {
  // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
  const base64String = imageString.replace(/^data:image\/[a-z]+;base64,/, "");

  // Convert base64 to binary string
  const binaryString = atob(base64String);

  // Create array buffer
  const arrayBuffer = new ArrayBuffer(binaryString.length);
  const uint8Array = new Uint8Array(arrayBuffer);

  // Fill the array with binary data
  for (let i = 0; i < binaryString.length; i++) {
    uint8Array[i] = binaryString.charCodeAt(i);
  }

  // Create a blob from the array buffer
  const originalBlob = new Blob([arrayBuffer], { type: mimeType });
  return originalBlob;
}

/**
 *
 * @param {chrome.tabs.Tab} tab
 * @returns {Promise<Blob>}
 */
async function getTabScreenshot(tab) {
  if (tab) {
    const windowId = tab.windowId;
    const tabId = tab.id;
    if (
      lastScreenshot &&
      lastScreenshot.tabId === tabId &&
      Date.now() - lastScreenshot.time <= 200
    ) {
      return lastScreenshot.screenshot;
    }
    const image = await chrome.tabs.captureVisibleTab(windowId);
    const blob = await convertImageStringToResizedBlob(
      image,
      "image/jpeg",
      800,
      600
    );
    lastScreenshot = { tabId, time: Date.now(), screenshot: blob };
    return blob;
  }
  return null;
}

// default 0 in case service worker accidentally restarts
let activeFrameId = 0;
/** @type {Object<string, { controller: AbortController, timestamp: number, url: string, }>} */
let pendingRequests = {};
// Cache results in memory to avoid recomputing the summary in the same session for the same pages
const cachedResults = {};

/**
 *
 * @param {number} tabId
 * @param {'success'|'pending'|'fail'} status
 * @param {string} title
 */
function setTitleTextAndColor(tabId, status, title) {
  let text, color;
  if (status === "fail") {
    text = "x";
    color = "gray";
  } else if (status === "pending") {
    text = "⟳";
    color = "orange";
  } else {
    text = "✓";
    color = "green";
  }
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setTitle({ tabId, title: status === 'fail' ? 'Could not summarize page because: ' + title : title });
}
/**
 * @param {Number} tabId
 */
function resetBadge(tabId) {
  chrome.action.setBadgeText({ tabId, text: '' });
  chrome.action.setTitle({ tabId, title: '', });
}

/**
 * Normalizes a URL by adding "www." to the hostname if not already present
 * This is necessary to handle some websites that redirect from one version to another
 * @param {string} url
 * @returns {string} Normalized URL string
 */
function normalizeUrl(url) {
  if (!url) {
    return '';
  }
  let urlObject;
  try {
    urlObject = new URL(url);
  } catch (e) {
    return '';
  }
  // Remove hash because archive.ph page changes the hash
  // on each mouse selection which can cause multiple summaries
  // for basically the same page
  // Either way hash does not seem worth storing
  urlObject.hash = '';
  const hostname = urlObject.hostname;

  // Check if hostname doesn't start with "www." and is not an IP address or localhost
  if (!hostname.startsWith('www.') &&
    !hostname.match(/^\d+\.\d+\.\d+\.\d+$/) && // Not an IPv4
    hostname !== 'localhost' &&
    !hostname.startsWith('127.') &&
    hostname.split('.').length >= 2) { // Has at least domain.tld
    urlObject.hostname = 'www.' + hostname;
  }

  return urlObject.href;
}

const MAX_CONCURRENT_REQUESTS = 3;
export async function gatherInfo() {
  // log("Checking tab if needs prediction");
  const tab = (await getActiveTab())[0];
  if (!tab?.id) {
    log("Exit because invalid tab", tab?.url);
    return;
  }
  const tabId = tab.id,
    frameId = activeFrameId,
    key = tabId + "," + frameId;
  let tabNormalizedURL = '';
  const tabOriginalURL = tab.url;

  try {
    tabNormalizedURL = normalizeUrl(tabOriginalURL)
  } catch (e) {
    log('Exit on invalid URL', tabOriginalURL);
    return;
  }
  if (cachedResults[key]?.url === tabNormalizedURL) {
    const cacheResult = cachedResults[key];
    setTitleTextAndColor(tabId, cacheResult.success, cacheResult.success ? 'Web page saved successfully' : cacheResult.reason);
    log("Exit because already calculated", tabNormalizedURL);
    return;
  }
  if (pendingRequests[key]?.url === tabNormalizedURL) {
    log("Exit because already running with the same URL", tabNormalizedURL);
    return;
  }
  console.log(pendingRequests);
  const controller = new AbortController();
  pendingRequests[key] = { controller, timestamp: Date.now(), url: tabNormalizedURL };

  const isCsActive = await chrome.tabs
    .sendMessage(tab.id, { type: "isAlive" }, { frameId: activeFrameId })
    .then((x) => !!x?.isAlive)
    .catch(() => false);
  if (!isCsActive) {
    log("Exit because CS inactive", tabOriginalURL);
    if (tabOriginalURL.startsWith('chrome-extension://') && tabOriginalURL.endsWith('summary_view/index.html')) {
      // don't show badge on the extension's own page haha
      resetBadge(tab.id);
    } else {
      setTitleTextAndColor(tab.id, "fail", 'this webpage is inaccessible to Chrome extensions');
    }
    delete pendingRequests[key];
    return;
  }
  let screenshot = null, documentContent = ['', ''];
  try {
    [screenshot, documentContent] = await Promise.all([
      getTabScreenshot(tab),
      chrome.tabs
        .sendMessage(tabId, { type: "getContent" }, { frameId })
        .then((x) => x.content)
        .catch(() => ''),
    ]);
  } catch (e) {
    // this can fail if the page redirects after a few seconds like in the case of anubis
  }
  log("Got content from", tabOriginalURL, { screenshot, documentContent });
  if (!documentContent?.[0] || !screenshot) {
    setTitleTextAndColor(tabId, "fail", 'this webpage has no text or was unable to provide a screenshot');
    delete pendingRequests[key];
    return;
  }
  // Oldest request goes last
  const listOfRequests = Object.entries(pendingRequests).toSorted(
    (a, b) => b[1].timestamp - a[1].timestamp
  );
  const DISCARD_KEY = "DISCARD_OLD_REQUEST";
  while (listOfRequests.length >= MAX_CONCURRENT_REQUESTS) {
    const request = listOfRequests.pop()[1];
    request.controller.abort(DISCARD_KEY);
    log("🗑️", "Discarded request on", request.url);
  }
  try {
    setTitleTextAndColor(tabId, "pending", 'Saving this page...');
    const prediction = await getPrediction({
      screenshot,
      documentContent,
      controller,
    });
    if (prediction.tags) {
      const summaries = await userSummariesDb.getAll();
      const existingSummaries = summaries.filter((x) => normalizeUrl(x.url) === tabNormalizedURL);
      if (existingSummaries[0]) {
        // remove the existing summary for the same page
        // and then add the new one so the recency gets updated
        await userSummariesDb.delete(existingSummaries[0].timestamp);
      }
      log("✅", tabOriginalURL, "prediction", prediction);
      await userSummariesDb.put({
        timestamp: Date.now(),
        tags: prediction.tags,
        takeaways: prediction.takeaways,
        url: tabOriginalURL, // store the real URL as it would contain the original www. (or not) and the original hash
        title: tab.title,
      });
      setTitleTextAndColor(tabId, "success", 'Web page saved successfully');
    } else {
      log("❌", tabOriginalURL, "discard", prediction.status, prediction.reason);
      setTitleTextAndColor(tabId, "fail", prediction.reason);
    }
    cachedResults[key] = { url: tabNormalizedURL, success: !!prediction.tags, reason: prediction.reason };
  } catch (e) {
    if (e.toString().includes(DISCARD_KEY)) {
      // User is switching between too many tabs too quickly and this one got booted
    } else {
      console.error(e);
    }
  }
  delete pendingRequests[key];
}