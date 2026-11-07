import sharp from "sharp";
import { Worker } from "node:worker_threads";
import { AppError } from "@/src/lib/http";

const maxBytes = 10 * 1024 * 1024;
const maxPixels = 20_000_000;
const maxDimension = 10000;
const maxFrames = 100;
export const imageUploadTip = "仅支持 JPG、PNG、GIF、WebP、BMP、HEIC 图片";

type Kind = "jpeg" | "png" | "gif" | "webp" | "bmp" | "heic";

function identify(bytes: Buffer): Kind | null {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (bytes.subarray(0, 2).toString("ascii") === "BM") return "bmp";
  if (bytes.subarray(4, 8).toString("ascii") === "ftyp" && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(bytes.subarray(8, 12).toString("ascii"))) return "heic";
  return null;
}

function checkDimensions(width: number, height: number, frames = 1) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > maxDimension || height > maxDimension || !Number.isInteger(frames) || frames < 1 || frames > maxFrames || width * height * frames > maxPixels) {
    throw new AppError(400, "UPLOAD_DIMENSIONS", "图片尺寸过大，请压缩后上传（最多 2000 万像素）");
  }
}

// bmp-js 只理解标准 40-byte DIB 布局；先校验偏移、调色板和像素范围，再规范化头部。
function normalizeBmp(bytes: Buffer) {
  if (bytes.length < 54) throw new Error("Truncated BMP");
  const headerSize = bytes.readUInt32LE(14);
  const offset = bytes.readUInt32LE(10);
  const width = bytes.readInt32LE(18);
  const height = Math.abs(bytes.readInt32LE(22));
  const depth = bytes.readUInt16LE(28);
  const compression = bytes.readUInt32LE(30);
  checkDimensions(width, height);
  if (![40, 52, 56, 108, 124].includes(headerSize) || 14 + headerSize > bytes.length || bytes.readUInt16LE(26) !== 1 || ![1, 4, 8, 16, 24, 32].includes(depth)) throw new Error("Invalid BMP header");
  if (![0, 1, 2, 3].includes(compression) || (compression === 1 && depth !== 8) || (compression === 2 && depth !== 4) || (compression === 3 && ![16, 32].includes(depth))) throw new Error("Invalid BMP compression");
  const colors = depth < 16 ? (bytes.readUInt32LE(46) || 2 ** depth) : 0;
  if (colors > 2 ** Math.min(depth, 8)) throw new Error("Invalid BMP palette");
  const paletteEnd = 14 + headerSize + colors * 4;
  if (offset < paletteEnd || offset > bytes.length) throw new Error("Invalid BMP offset");
  const minimum = Math.ceil(width * depth / 32) * 4 * height;
  if ((compression === 0 || compression === 3) && bytes.length - offset < minimum) throw new Error("Truncated BMP pixels");
  const header = Buffer.from(bytes.subarray(0, 54));
  header.writeUInt32LE(40, 14);
  const palette = bytes.subarray(14 + headerSize, paletteEnd);
  const masks = compression === 3 ? Buffer.alloc(16) : Buffer.alloc(0);
  if (compression === 3) {
    const available = headerSize >= 56 ? 16 : 12;
    if (offset < 54 + available) throw new Error("Truncated BMP masks");
    bytes.copy(masks, 0, 54, 54 + available);
  }
  header.writeUInt32LE(54 + palette.length + masks.length, 10);
  return Buffer.concat([header, palette, masks, bytes.subarray(offset)]);
}

const decoderWorker = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const bytes = Buffer.from(workerData.bytes);
  const check = (w,h) => { if (!Number.isInteger(w) || !Number.isInteger(h) || w<1 || h<1 || w>10000 || h>10000 || w*h>20000000) throw new Error('Invalid image dimensions'); };
  let width, height, pixels;
  if (workerData.kind === 'heic') {
    const images = await require(workerData.decoderPath).all({buffer:bytes});
    try {
      if (!images.length || images.length>100) throw new Error('Invalid image count');
      for (const image of images) check(image.width,image.height);
      const first=images[0]; check(first.width,first.height);
      const decoded=await first.decode(); width=decoded.width; height=decoded.height;
      check(width,height); pixels=new Uint8Array(decoded.data);
    } finally { images.dispose(); }
  } else {
    const decoded=require(workerData.decoderPath).decode(bytes);
    width=decoded.width; height=decoded.height; check(width,height);
    if(decoded.data.length!==width*height*4) throw new Error('Invalid pixels');
    pixels=new Uint8Array(decoded.data.length);
    let hasAlpha=false;
    if(bytes.readUInt16LE(28)===32) for(let i=0;i<decoded.data.length;i+=4) if(decoded.data[i]) {hasAlpha=true;break;}
    for(let i=0;i<pixels.length;i+=4){pixels[i]=decoded.data[i+3];pixels[i+1]=decoded.data[i+2];pixels[i+2]=decoded.data[i+1];pixels[i+3]=hasAlpha?decoded.data[i]:255;}
  }
  if(pixels.length!==width*height*4) throw new Error('Invalid pixels');
  parentPort.postMessage({width,height,pixels},[pixels.buffer]);
})().catch(() => parentPort.postMessage({error:true}));
`;

async function decodeSpecial(bytes: Buffer, kind: "bmp" | "heic") {
  const decoderPath = kind === "bmp" ? require.resolve("bmp-js") : require.resolve("heic-decode");
  return new Promise<{ width: number; height: number; pixels: Uint8Array }>((resolve, reject) => {
    const worker = new Worker(decoderWorker, { eval: true, workerData: { bytes, kind, decoderPath }, resourceLimits: { maxOldGenerationSizeMb: 160, maxYoungGenerationSizeMb: 32, stackSizeMb: 8 } });
    let finished = false;
    const finish = (error?: Error, value?: { width: number; height: number; pixels: Uint8Array }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => finish(new Error("Image decoding timed out")), 8000);
    worker.once("message", (value) => value.error ? finish(new Error("Image decoding failed")) : finish(undefined, value));
    worker.once("error", (error) => finish(error));
    worker.once("exit", () => { if (!finished) finish(new Error("Image decoder exited")); });
  });
}

export async function decodeUploadedImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > maxBytes) throw new AppError(400, "UPLOAD_TOO_LARGE", "请选择不超过 10MB 的有效图片");
  const kind = identify(bytes);
  if (!kind) throw new AppError(400, "UPLOAD_IMAGE_ONLY", imageUploadTip);
  try {
    let output: Buffer;
    let extension: string;
    let contentType: string;
    if (kind === "bmp" || kind === "heic") {
      const raw = await decodeSpecial(kind === "bmp" ? normalizeBmp(bytes) : bytes, kind);
      checkDimensions(raw.width, raw.height);
      const pipeline = sharp(Buffer.from(raw.pixels), { raw: { width: raw.width, height: raw.height, channels: 4 }, limitInputPixels: maxPixels }).timeout({ seconds: 8 });
      output = kind === "heic" ? await pipeline.jpeg({ quality: 90 }).toBuffer() : await pipeline.png().toBuffer();
      extension = kind === "heic" ? ".jpg" : ".png";
      contentType = kind === "heic" ? "image/jpeg" : "image/png";
    } else {
      const pipeline = sharp(bytes, { animated: true, limitInputPixels: maxPixels, failOn: "warning" }).timeout({ seconds: 8 });
      const metadata = await pipeline.metadata();
      if (metadata.format !== kind) throw new Error("Image format mismatch");
      checkDimensions(metadata.width || 0, metadata.pageHeight || metadata.height || 0, metadata.pages || 1);
      output = await pipeline.rotate().toFormat(kind, kind === "jpeg" || kind === "webp" ? { quality: 90 } : {}).toBuffer();
      extension = kind === "jpeg" ? ".jpg" : `.${kind}`;
      contentType = `image/${kind}`;
    }
    if (output.length > maxBytes) throw new AppError(400, "UPLOAD_TOO_LARGE", "图片转换后超过 10MB，请压缩后上传");
    return { bytes: output, extension, contentType };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "UPLOAD_INVALID_IMAGE", "图片内容无效、损坏或处理超时，请重新选择图片");
  }
}
