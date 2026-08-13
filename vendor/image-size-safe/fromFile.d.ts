import type { ImageDimensions } from "./index.mjs";

export declare function imageSizeFromFile(path: string): Promise<ImageDimensions>;
export declare function setConcurrency(value: number): void;
