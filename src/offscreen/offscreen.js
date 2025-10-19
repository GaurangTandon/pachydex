/**
 * Offscreen document that communicates with the sandbox iframe
 * to generate embeddings for summaries
 */

import { getBatchedEmbeddingsForSummaries } from "../utils/common.js";
import { userSummariesDb } from "../utils/indexeddb.js";

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "generateEmbeddingsForAll") {
    // Generate embeddings for all summaries
    processUnembeddedSummaries()
      .catch((error) => {
        console.error("Error generating embeddings:", error);
        sendResponse({ success: false, error: error.message });
      });
  }

  if (message.type === "ping") {
    sendResponse({ success: true, pong: true });
    return false;
  }
});

console.log("Offscreen document ready for embeddings generation");

const BATCH_SIZE = 10; // Process 10 summaries at a time to keep load low as this runs automatically in the background

let isProcessing = false;
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
 * Process a batch of summaries
 * @param {Array} summaries
 */
async function processBatch(summaries) {
  try {
    console.log(`Processing batch of ${summaries.length} summaries`);

    // Generate embeddings
    const embeddings = await getBatchedEmbeddingsForSummaries(summaries);

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