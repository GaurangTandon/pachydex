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
 * @param {{ tabId: number, windowId: number, }} tab
 * @returns {Promise<Blob>}
 */
async function getTabScreenshot({ windowId, tabId }) {
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

// default 0 in case service worker accidentally restarts
let activeFrameId = 0;
/** @type {Object<string, { controller: AbortController, timestamp: number, url: string, }>} */
let pendingRequests = {};
// Cache results in memory to avoid recomputing the summary in the same session for the same pages
const cachedResults = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'isFocused') {
    activeFrameId = sender.frameId;
  }
});

/**
 *
 * @param {number} tabId
 * @param {'success'|'pending'|'fail'|'waiting'} status
 * @param {string} title
 */
export function setTitleTextAndColor(tabId, status, title) {
  let text,
    /** @type {string|[number, number, number, number]} */
    color;
  if (status === "fail") {
    text = "x";
    color = "gray";
  } else if (status === "pending") {
    text = "⟳";
    color = "orange";
  } else if (status === 'waiting') {
    text = '⏳';
    color = [0, 0, 0, 0];
  } else if (status === 'success') {
    text = "✓";
    color = "green";
  } else {
    console.error('Unknown status: ' + status);
  }
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setTitle({ tabId, title: status === 'fail' ? 'Could not save this page because: ' + title : title });
}
/**
 * @param {Number} tabId
 */
export function resetBadge(tabId) {
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

/**
 * @param {number} tabId 
 * @returns {Promise<boolean>}
 */
export async function isCSActive(tabId) {
  return await chrome.tabs
    .sendMessage(tabId, { type: "isAlive" }, { frameId: activeFrameId })
    .then((x) => !!x?.isAlive)
    .catch(() => false);
}
/**
 * @param {number} tabId 
 * @returns {Promise<number>}
 */
export async function getCSTimeSpent(tabId) {
  return await chrome.tabs
    .sendMessage(tabId, { type: "getTimeSpent" }, { frameId: activeFrameId })
    .then((x) => x.duration);
}

export const INACCESSIBLE_REASON = 'this webpage is inaccessible to Chrome extensions';
const SAVING_REASON = 'Saving this page...';
const MAX_CONCURRENT_REQUESTS = 3;
/**
 * @param {string} url 
 * @returns 
 */
export function getNormalizedURL(url) {
  try {
    const tabNormalizedURL = normalizeUrl(url)
    return tabNormalizedURL;
  } catch (e) {
    return '';
  }
}
/**
 * @param {number} tabId
 */
function getKey(tabId) {
  return tabId + "," + activeFrameId;
}
/**
 * @param {number} tabId 
 * @param {string} url 
 * @returns 
 */
export function checkCacheOrPending(tabId, url) {
  const tabNormalizedURL = getNormalizedURL(url);
  const key = getKey(tabId);
  if (cachedResults[key]?.url === tabNormalizedURL) {
    const cacheResult = cachedResults[key];
    setTitleTextAndColor(tabId, cacheResult.success ? 'success' : 'fail', cacheResult.success ? 'Web page saved successfully' : cacheResult.reason);
    log("Exit because already calculated", tabNormalizedURL);
    return true;
  }
  if (pendingRequests[key]?.url === tabNormalizedURL) {
    log("Exit because already running with the same URL", tabNormalizedURL);
    setTitleTextAndColor(tabId, "pending", SAVING_REASON);
    return true;
  }
  return false;
}
export async function gatherInfo({ tabId, windowId, title, url: tabOriginalURL, }) {
  const frameId = activeFrameId, key = getKey(tabId);

  let tabNormalizedURL = getNormalizedURL(tabOriginalURL);
  const controller = new AbortController();
  pendingRequests[key] = { controller, timestamp: Date.now(), url: tabNormalizedURL };

  let screenshot = null, documentContent = ['', ''];
  try {
    [screenshot, documentContent] = await Promise.all([
      getTabScreenshot({ tabId, windowId }),
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
    setTitleTextAndColor(tabId, "pending", SAVING_REASON);
    const prediction = await getPrediction({
      url: tabOriginalURL,
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
        title,
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