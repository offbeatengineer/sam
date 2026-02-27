export interface MemoryConfig {
  enabled?: boolean;
  storagePath: string;
  modelsPath: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
}
