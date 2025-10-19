import { pipeline, env as hgEnv } from "@huggingface/transformers";

hgEnv.allowRemoteModels = false;
hgEnv.allowLocalModels = true;
hgEnv.useBrowserCache = false; // not supported on chrome-extension:// scheme

/**
 * @param {string} modelPath
 * @returns
 */
export async function getModel(modelPath) {
  hgEnv.localModelPath = modelPath;
  hgEnv.backends.onnx.wasm.wasmPaths = modelPath;

  // pipeline is a higher level function that handles both tokenizer and output generation
  // pads inputs to same length as well :D
  return pipeline(
    "feature-extraction",
    "onnx-community/embeddinggemma-300m-ONNX",
    {
      // do not use webgpu with q8 until this gets fixed
      // https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/discussions/18
      // device: 'webgpu',
      // https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/discussions/19
      // fp32 crashes so can't use it :/
      dtype: "q8",  // fp32 or q8 or q4. Note: fp16 not supported
    }
  );
}
