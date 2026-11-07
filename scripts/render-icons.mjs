import { readFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("app/icon.svg");
mkdirSync("public/icons", { recursive: true });
for (const [size, path] of [
  [192, "public/icons/icon-192.png"],
  [512, "public/icons/icon-512.png"],
  [180, "public/apple-touch-icon.png"],
]) {
  await sharp(svg).resize(size, size).png().toFile(path);
}
console.log("PWA icons generated from app/icon.svg");
