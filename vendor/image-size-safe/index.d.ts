export type ImageDimensions = {
  width: number;
  height: number;
  type: "bmp" | "gif" | "ico" | "jpg" | "png" | "svg" | "webp";
};

export declare function imageSize(input: Uint8Array): ImageDimensions;
