import { getModel as getModelInner } from "./built/hugging.js";

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
  const start = performance.now();
  globalModelPromise = getModelInner(modelPath).then((model) => {
    console.log('Time taken to get model', performance.now() - start)
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
  console.log("Time taken", performance.now() - start, 'ms');
  return {
    data: embeddings.data,
    dims: embeddings.dims,
  };
}

async function onMessage(det) {
  if (det.type === "getBatchedEmbeddings") {
    return getBatchedEmbeddings(det.modelPath, det.documents);
  } else if (det.type === "getModel") {
    getModel(det.modelPath);
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
