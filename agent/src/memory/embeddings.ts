import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lazyImport } from "./lazy-install.js";
import type { MemoryConfig } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = resolve(__dirname, "..", "..");

export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

let sharedProvider: Promise<EmbeddingProvider> | null = null;

export async function getSharedEmbeddingProvider(config: MemoryConfig): Promise<EmbeddingProvider> {
  if (!sharedProvider) {
    sharedProvider = LocalEmbeddingProvider.create(config).catch((err) => {
      sharedProvider = null;
      throw err;
    });
  }
  return sharedProvider;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 384;
  private extractor: any;

  private constructor(extractor: any) {
    this.extractor = extractor;
  }

  static async create(config: MemoryConfig): Promise<LocalEmbeddingProvider> {
    const transformers = await lazyImport<any>("@huggingface/transformers", AGENT_DIR);

    // Set model cache directory
    transformers.env.cacheDir = config.modelsPath;

    const modelName = config.embeddingModel ?? "mixedbread-ai/mxbai-embed-xsmall-v1";
    console.log(`[memory] Loading embedding model: ${modelName}`);

    const extractor = await transformers.pipeline("feature-extraction", modelName, {
      dtype: "q8",
    });

    return new LocalEmbeddingProvider(extractor);
  }

  async embed(text: string): Promise<number[]> {
    const output = await this.extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}
