/**
 * Embedding processor that manages generating embeddings
 * for summaries that don't have them yet
 * Service worker context
 */

import { userSummariesDb } from "../utils/indexeddb.js";

const EMBEDDING_ALARM_NAME = "processEmbeddings";
const EMBEDDING_INTERVAL_MINUTES = 5; // Process every 5 minutes
const BATCH_SIZE = 10; // Process 10 summaries at a time to keep load low in the background

let isProcessing = false;

/**
 * Initialize the embedding processor
 */
export async function initEmbeddingProcessor() {
  // Set up periodic alarm for processing embeddings
  chrome.alarms.create(EMBEDDING_ALARM_NAME, {
    periodInMinutes: EMBEDDING_INTERVAL_MINUTES,
    delayInMinutes: 1, // Start after 1 minute
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === EMBEDDING_ALARM_NAME) {
      processUnembeddedSummaries();
    }
  });

  console.log("Embedding processor initialized");
}

/** @type {Promise<boolean>} */
let offscreenDocumentPromise = null;

/**
 * Create offscreen document if it doesn't exist
 */
async function ensureOffscreenDocument() {
  if (offscreenDocumentPromise) {
    await offscreenDocumentPromise;
    try {
      const response = await chrome.runtime.sendMessage({ type: "ping" });
      if (response?.pong) {
        return true;
      }
    } catch (e) {
      // Document is not alive, need to recreate
      offscreenDocumentPromise = null;
    }
  }

  offscreenDocumentPromise = chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen.html"),
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Generate embeddings for summaries using ML models",
  }).then(() => {
    console.log("Offscreen document created");
    // Wait a bit for the offscreen document to fully load
    return new Promise(resolve => setTimeout(() => resolve(true), 1000));
  });

  try {
    await offscreenDocumentPromise;
    return true;
  } catch (error) {
    if (!error.message.includes("Only a single offscreen")) {
      console.error("Error creating offscreen document:", error);
      return false;
    }
    return true;
  }
}

/**
 * Get summaries that don't have embeddings yet
 * @returns {Promise<Array>}
 */
async function getUnembeddedSummaries() {
  const allSummaries = await userSummariesDb.getAll();

  // Filter for summaries without embeddings
  const unembedded = allSummaries.filter(
    (summary) => !summary.embeddings || summary.embeddings.length === 0
  );

  return unembedded;
}

/**
 * Process unembedded summaries in batches
 */
async function processUnembeddedSummaries() {
  if (isProcessing) {
    console.log("Already processing embeddings, skipping this iteration...");
    return;
  }

  try {
    isProcessing = true;

    const unembeddedSummaries = await getUnembeddedSummaries();

    if (unembeddedSummaries.length === 0) {
      console.log("No summaries need embeddings");
      return;
    }

    console.log(
      `Found ${unembeddedSummaries.length} summaries without embeddings`
    );

    // Ensure offscreen document is available
    const ready = await ensureOffscreenDocument();
    if (!ready) {
      console.error("Failed to create offscreen document");
      return;
    }

    // Process in batches
    const batches = [];
    for (let i = 0; i < unembeddedSummaries.length; i += BATCH_SIZE) {
      batches.push(unembeddedSummaries.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
      await processBatch(batch);
    }

    console.log("Finished processing embeddings");
  } catch (error) {
    console.error("Error processing embeddings:", error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Process a batch of summaries
 * @param {Array} summaries
 */
async function processBatch(summaries) {
  try {
    console.log(`Processing batch of ${summaries.length} summaries`);

    // Generate embeddings via offscreen document
    const response = await chrome.runtime.sendMessage({
      type: "generateEmbeddings",
      summaries: summaries.map(s => ({
        timestamp: s.timestamp,
        title: s.title,
        takeaways: s.takeaways,
      })),
    });

    if (!response.success) {
      console.error("Failed to generate embeddings:", response.error);
      return;
    }

    const { embeddings } = response;
    const embeddingSize = embeddings.dims[1]; // Size of each embedding
    const embeddingsData = embeddings.data;

    // Update each summary with its embedding
    for (let i = 0; i < summaries.length; i++) {
      const summary = summaries[i];
      const start = i * embeddingSize;
      const end = start + embeddingSize;
      const embedding = Array.from(embeddingsData.slice(start, end));

      // Update the summary with the embedding
      await userSummariesDb.put({
        ...summary,
        embeddings: embedding,
      });
    }

    console.log(`Successfully embedded ${summaries.length} summaries`);
  } catch (error) {
    console.error("Error processing batch:", error);
  }
}

/**
 * Close offscreen document
 */
export async function closeOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
    console.log("Offscreen document closed");
  } catch (error) {
    console.error("Error closing offscreen document:", error);
  }
}
