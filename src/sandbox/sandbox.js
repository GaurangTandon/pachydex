import { getModel as getModelInner } from "./built/hugging.js";

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct; // Already normalized, so no need to divide by magnitudes
}

let globalModel;
let globalModelPromise;
/**
 * @param {string} modelPath
 */
async function getModel(modelPath) {
  if (globalModelPromise) {
    return globalModelPromise;
  }
  console.log("Getting model at path", modelPath);
  globalModelPromise = getModelInner(modelPath).then((model) => {
    globalModel = model;
    return model;
  });
  return globalModelPromise;
}

/**
 *
 * @param {string} modelPath
 * @param {string[]} documents
 * @returns
 */
async function getBatchedEmbeddings(modelPath, documents) {
  await getModel(modelPath);
  const start = performance.now();
  const embeddings = await globalModel(documents, {
    pooling: "mean",
    normalize: true,
  });
  console.log("Time taken", performance.now() - start);
  return {
    data: embeddings.data,
    dims: embeddings.dims,
  };
}

/**
 *
 * @param {string} modelPath
 * @param {{ data: Float32Array, dims: number[] }} embeddings
 * @param {string} query
 * @returns
 */
async function searchAcrossEmbeddings(modelPath, embeddings, query) {
  await getModel(modelPath);
  // Generate embedding for the query
  const queryEmbedding = await globalModel(query, {
    pooling: "mean",
    normalize: true,
  });
  console.log(queryEmbedding);

  const queryData = queryEmbedding.data; // Get Float32Array
  const embeddingsData = embeddings.data; // Get Float32Array
  const embeddingSize = queryData.length;
  const numDocs = embeddings.dims[0]; // Number of documents

  // Calculate similarities with all documents
  const similarities = [];
  for (let i = 0; i < numDocs; i++) {
    const start = i * embeddingSize;
    const end = start + embeddingSize;
    const docEmbedding = embeddingsData.slice(start, end);

    similarities.push(cosineSimilarity(queryData, docEmbedding));
  }
  return similarities;
}

async function onMessage(det) {
  if (det.type === "getModel") {
    sampleTest(det.modelPath);
  } else if (det.type === "getBatchedEmbeddings") {
    return getBatchedEmbeddings(det.modelPath, det.documents);
  } else if (det.type === "searchAcrossEmbeddings") {
    return searchAcrossEmbeddings(det.modelPath, det.embeddings, det.query);
  }
}

window.addEventListener("message", (e) => {
  if (!e.origin.startsWith("chrome-extension://")) {
    return;
  }
  const det = e.data;
  onMessage(det).then((response) => {
    if (response) {
      e.source.postMessage(
        { type: "response", key: det.requestKey, response },
        // @ts-ignore
        "*"
      );
    }
  });
});
