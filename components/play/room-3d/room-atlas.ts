import { ClampToEdgeWrapping, NearestFilter, NearestMipmapNearestFilter, Texture } from "three";
import type { GLTFLoaderPlugin, GLTFParser } from "three/addons/loaders/GLTFLoader.js";

export function validateRoomAtlasBytes(bytes: ArrayBuffer): void {
  if (bytes.byteLength < 33 || bytes.byteLength > 100_000) throw new Error("Room atlas exceeds its byte budget");
  const view = new DataView(bytes);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a ||
      view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 ||
      view.getUint32(16) !== 512 || view.getUint32(20) !== 512) {
    throw new Error("Room atlas must be a 512×512 PNG");
  }
}

/** Decode the reviewed embedded atlas from bytes, not a blob: URL fetch.
 * This keeps the existing CSP intact. A bad image fails the room closed rather
 * than GLTFLoader's default silent, untextured white-material fallback.
 */
export function roomAtlasPlugin(parser: GLTFParser): GLTFLoaderPlugin {
  return {
    name: "ROOM_embedded_atlas",
    async loadTexture(index: number) {
      const definition = parser.json.textures?.[index];
      const source = parser.json.images?.[definition?.source];
      if (index !== 0 || parser.json.images?.length !== 1 || source?.uri !== undefined ||
          !Number.isSafeInteger(source?.bufferView) || source.mimeType !== "image/png") {
        throw new Error("Room atlas must be a single embedded PNG");
      }
      const bytes: ArrayBuffer = await parser.getDependency("bufferView", source.bufferView);
      validateRoomAtlasBytes(bytes);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
        // The reviewed PNG has no orientation metadata; preserve its pixels
        // using the current standard rather than the deprecated `none` option.
        colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "from-image",
      });
      if (bitmap.width !== 512 || bitmap.height !== 512) {
        bitmap.close();
        throw new Error("Room atlas has unexpected dimensions");
      }
      const texture = new Texture(bitmap);
      texture.name = "original-room-atlas";
      texture.flipY = false;
      texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
      texture.magFilter = NearestFilter;
      texture.minFilter = NearestMipmapNearestFilter;
      texture.needsUpdate = true;
      texture.addEventListener("dispose", () => bitmap.close());
      return texture;
    },
  };
}
