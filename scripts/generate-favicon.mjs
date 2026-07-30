import sharp from "sharp";
import { fileURLToPath } from "node:url";

const size = 96;
const svg = `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#17223B"/>
  <circle cx="82" cy="14" r="6" fill="#295DFF"/>
  <text x="10" y="68" fill="#F4F7F8" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700" letter-spacing="-4">AS</text>
</svg>`;

await sharp(Buffer.from(svg))
  .png()
  .toFile(fileURLToPath(new URL("../public/favicon.png", import.meta.url)));
