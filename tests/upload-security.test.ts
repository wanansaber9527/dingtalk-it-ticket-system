import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { AppError, fail, ok } from "../src/lib/http";
import { decodeUploadedImage } from "../src/server/upload-image";
import { loadSecuritySource } from "./helpers/security-source";

const owner = { id: "owner", dingtalkUserId: "owner", status: "ACTIVE", roleAssignments: [{ role: "EMPLOYEE" }] };
const handler = { id: "handler", dingtalkUserId: "handler", status: "ACTIVE", roleAssignments: [{ role: "IT_HANDLER" }] };
const outsider = { id: "outsider", dingtalkUserId: "outsider", status: "ACTIVE", roleAssignments: [{ role: "EMPLOYEE" }] };

async function fixture(t: any) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ticket-upload-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, ".owners"));
  await writeFile(path.join(directory, "asset.png"), "fixture bytes");
  await writeFile(path.join(directory, ".owners", "asset.png.json"), JSON.stringify({ uploadedBy: owner.dingtalkUserId }));
  return directory;
}

test("new uploaded files are private to their uploader until attached", async (t) => {
  const directory = await fixture(t);
  const uploads = loadSecuritySource("src/server/uploads.ts", { env: { UPLOAD_DIR: directory }, prisma: { ticket: { findMany: async () => [] } } });
  await uploads.requireCanReadUpload("asset.png", owner);
  await assert.rejects(uploads.requireCanReadUpload("asset.png", outsider), (e: any) => e.code === "UPLOAD_FORBIDDEN");
  const attachments = await uploads.validateOwnedAttachments([{ name: "image", url: "/uploads/asset.png", size: 999, type: "text/html" }], owner);
  assert.equal(attachments[0].url, "/api/uploads/asset.png");
  assert.equal(attachments[0].type, "image/png");
  assert.equal(attachments[0].size, Buffer.byteLength("fixture bytes"));
});

test("rehired owners can read their own unattached historical uploads through a scoped identity binding", async (t) => {
  const directory = await fixture(t);
  const rehired = { ...owner, dingtalkUserId: "new-dingtalk-id" };
  const queries: any[] = [];
  const historicalBinding = { id: "historical-binding", corpId: "company", userId: owner.id, externalUserId: owner.dingtalkUserId, active: false };
  const prisma = {
    ticket: { findMany: async () => [] },
    userIdentity: { findFirst: async ({ where }: any) => {
      queries.push(where);
      return where.corpId === historicalBinding.corpId && where.userId === historicalBinding.userId && where.externalUserId === historicalBinding.externalUserId ? historicalBinding : null;
    } }
  };
  const uploads = loadSecuritySource("src/server/uploads.ts", { env: { UPLOAD_DIR: directory, DINGTALK_CORP_ID: "company" }, prisma });
  await uploads.requireCanReadUpload("asset.png", rehired);
  const attachments = await uploads.validateOwnedAttachments([{ name: "历史图片", url: "/api/uploads/asset.png" }], rehired);
  assert.equal(attachments[0].url, "/api/uploads/asset.png");
  assert.equal(queries[0].userId, owner.id);
  assert.equal(queries[0].corpId, "company");
  assert.equal(queries[0].active, undefined);
  await assert.rejects(uploads.requireCanReadUpload("asset.png", outsider), (error: any) => error.code === "UPLOAD_FORBIDDEN");
  const differentCorp = loadSecuritySource("src/server/uploads.ts", { env: { UPLOAD_DIR: directory, DINGTALK_CORP_ID: "another-company" }, prisma });
  await assert.rejects(differentCorp.requireCanReadUpload("asset.png", rehired), (error: any) => error.code === "UPLOAD_FORBIDDEN");
  const missingScope = loadSecuritySource("src/server/uploads.ts", { env: { UPLOAD_DIR: directory }, prisma });
  await assert.rejects(missingScope.requireCanReadUpload("asset.png", rehired), (error: any) => error.code === "UPLOAD_FORBIDDEN");
  await assert.rejects(uploads.requireCanReadUpload("asset.png", { ...rehired, status: "DISABLED", employmentStatus: "DEPARTED" }), (error: any) => error.code === "USER_DISABLED");
});

test("historical uploader ownership does not override a linked ticket's current access", async (t) => {
  const directory = await fixture(t);
  let identityReads = 0;
  const uploads = loadSecuritySource("src/server/uploads.ts", { env: { UPLOAD_DIR: directory, DINGTALK_CORP_ID: "company" }, prisma: {
    ticket: { findMany: async () => [{ applicantId: outsider.id, applicantUserId: outsider.dingtalkUserId, handlerId: null, handlerUserId: null, attachments: JSON.stringify([{ url: "/api/uploads/asset.png" }]), logs: [] }] },
    userIdentity: { findFirst: async () => { identityReads++; return { userId: owner.id }; } }
  } });
  await assert.rejects(uploads.requireCanReadUpload("asset.png", { ...owner, dingtalkUserId: "new-dingtalk-id" }), (error: any) => error.code === "UPLOAD_FORBIDDEN");
  assert.equal(identityReads, 0);
});

test("attached files follow current ticket access, including legacy URLs and log attachments", async (t) => {
  const directory = await fixture(t);
  let tickets: any[] = [{ applicantUserId: "other", handlerUserId: "handler", attachments: JSON.stringify(["https://old.invalid/uploads/asset.png"]), logs: [] }];
  const uploads = loadSecuritySource("src/server/uploads.ts", { env: { UPLOAD_DIR: directory }, prisma: { ticket: { findMany: async () => tickets } } });
  await uploads.requireCanReadUpload("asset.png", handler);
  await assert.rejects(uploads.requireCanReadUpload("asset.png", owner), (e: any) => e.code === "UPLOAD_FORBIDDEN");
  await assert.rejects(uploads.validateOwnedAttachments([{ name: "stolen", url: "/api/uploads/asset.png" }], outsider), (e: any) => e.code === "UPLOAD_FORBIDDEN");
  tickets = [{ applicantUserId: "owner", handlerUserId: "different-handler", attachments: null, logs: [{ attachments: JSON.stringify([{ url: "/uploads/asset.png" }]) }] }];
  await uploads.requireCanReadUpload("asset.png", owner);
  await assert.rejects(uploads.requireCanReadUpload("asset.png", handler), (e: any) => e.code === "UPLOAD_FORBIDDEN");
});

test("attachment inputs reject external URLs, schemes, traversal and unrelated substring matches", async (t) => {
  const directory = await fixture(t);
  const uploads = loadSecuritySource("src/server/uploads.ts", { env: { UPLOAD_DIR: directory }, prisma: { ticket: { findMany: async () => [{ applicantUserId: "outsider", handlerUserId: null, attachments: JSON.stringify([{ url: "/uploads/notasset.png" }]), logs: [] }] } } });
  for (const url of ["https://evil.invalid/uploads/asset.png", "javascript:alert(1)", "data:image/png,abc", "//evil.invalid/uploads/asset.png", "/api/uploads/..%2Fasset.png"]) {
    await assert.rejects(uploads.validateOwnedAttachments([{ name: "image", url }], owner), (e: any) => e.code === "INVALID_ATTACHMENTS");
  }
  await assert.rejects(uploads.requireCanReadUpload("asset.png", outsider), (e: any) => e.code === "UPLOAD_FORBIDDEN");
  await assert.rejects(uploads.validateOwnedAttachments(Array.from({ length: 11 }, () => ({ name: "image", url: "/api/uploads/asset.png" })), owner), (e: any) => e.code === "INVALID_ATTACHMENTS");
});

test("anonymous upload and download fail before accessing file content", async () => {
  const modules = {
    "@/src/lib/http": { AppError, fail, ok },
    "@/src/server/auth": { getCurrentUser: async () => { throw new AppError(401, "UNAUTHORIZED", "Login required"); } },
    "@/src/server/upload-image": { decodeUploadedImage: async () => { throw new Error("Decoder must not be called"); } },
    "@/src/server/upload-storage": { storeOwnedUpload: async () => { throw new Error("Writer must not be called"); } }
  };
  const upload = loadSecuritySource("app/api/uploads/route.ts", { modules });
  assert.equal((await upload.POST(new Request("https://example.invalid/api/uploads", { method: "POST", body: "unused" }))).status, 401);
  for (const route of ["app/api/uploads/[fileName]/route.ts", "app/uploads/[fileName]/route.ts"]) {
    const download = loadSecuritySource(route, { modules });
    const request = new Request("https://localhost:3000/uploads/asset.png", { headers: { host: "example.invalid:38443", "x-forwarded-proto": "https", "x-forwarded-host": "example.invalid:38443" } });
    const response = await download.GET(request, { params: Promise.resolve({ fileName: "asset.png" }) });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
  }
});

test("current and legacy downloads enforce access without HTTPS proxy rewrites or public caching", async (t) => {
  const directory = await fixture(t);
  for (const route of ["app/api/uploads/[fileName]/route.ts", "app/uploads/[fileName]/route.ts"]) {
    let currentUser = owner;
    const download = loadSecuritySource(route, { env: { UPLOAD_DIR: directory }, prisma: { ticket: { findMany: async () => [] } }, modules: { "@/src/server/auth": { getCurrentUser: async () => currentUser } } });
    const request = new Request("https://localhost:3000/uploads/asset.png", { headers: { host: "example.invalid:38443", "x-forwarded-proto": "https", "x-forwarded-host": "example.invalid:38443" } });
    const response = await download.GET(request, { params: Promise.resolve({ fileName: "asset.png" }) });
    assert.equal(download.runtime, "nodejs");
    assert.equal(download.dynamic, "force-dynamic");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
    assert.equal(await response.text(), "fixture bytes");
    currentUser = outsider;
    assert.equal((await download.GET(request, { params: Promise.resolve({ fileName: "asset.png" }) })).status, 403);
  }
  const middleware = loadSecuritySource("middleware.ts", { env: { NODE_ENV: "production" } });
  assert.deepEqual(Array.from(middleware.config.matcher), ["/", "/ai-assistant", "/tickets/new"]);
  const response = middleware.middleware(new NextRequest("https://localhost:3000/uploads/asset.png", { headers: { host: "example.invalid:38443", "x-forwarded-proto": "https" } }));
  assert.equal(response.headers.get("x-middleware-rewrite"), null);
});

test("upload rate and request size limits apply before decoding", async () => {
  const limits = loadSecuritySource("src/server/upload-rate-limit.ts");
  for (let i = 0; i < 30; i++) limits.consumeUploadAllowance("u", 1000);
  assert.throws(() => limits.consumeUploadAllowance("u", 1000), (e: any) => e.code === "UPLOAD_RATE_LIMIT");
  limits.consumeUploadAllowance("u", 601000);
  await assert.rejects(limits.readUploadForm(new Request("https://example.invalid", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(12 * 1024 * 1024) }, body: "x" })), (e: any) => e.code === "UPLOAD_TOO_LARGE");
  const releases: (() => void)[] = [];
  const work = () => new Promise<void>((resolve) => releases.push(resolve));
  const first = limits.withUploadSlot(work); const second = limits.withUploadSlot(work);
  await assert.rejects(limits.withUploadSlot(work), (e: any) => e.code === "UPLOAD_BUSY");
  releases.forEach((release) => release()); await Promise.all([first, second]);
  await limits.withUploadSlot(async () => undefined);
});

test("claimed image types do not bypass decoding and oversized BMP dimensions are rejected", async () => {
  await assert.rejects(decodeUploadedImage(Buffer.from("not an image")), (e: any) => e.code === "UPLOAD_IMAGE_ONLY");
  await assert.rejects(decodeUploadedImage(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0])), (e: any) => e.code === "UPLOAD_INVALID_IMAGE");
  await assert.rejects(decodeUploadedImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), (e: any) => e.code === "UPLOAD_IMAGE_ONLY");
  const bmp = Buffer.alloc(54); bmp.write("BM"); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(100000, 18); bmp.writeInt32LE(100000, 22);
  await assert.rejects(decodeUploadedImage(bmp), (e: any) => e.code === "UPLOAD_DIMENSIONS");
});

test("real JPEG PNG GIF and WebP remain decodable after normalization", async () => {
  for (const format of ["jpeg", "png", "gif", "webp"] as const) {
    const source = await sharp({ create: { width: 4, height: 3, channels: 3, background: "red" } }).toFormat(format).toBuffer();
    const output = await decodeUploadedImage(source);
    const decoded = await sharp(output.bytes).metadata();
    assert.equal(decoded.width, 4); assert.equal(decoded.height, 3); assert.equal(decoded.format, format);
    assert.equal(output.contentType, `image/${format}`);
  }
});

test("BMP formats including palette and RLE retain image support", async () => {
  for (const filename of ["bit1.bmp", "bit4.bmp", "bit8.bmp", "bit24.bmp", "bit8_RLE.bmp", "bit16_565.bmp", "bit32_alpha.bmp"]) {
    const source = await readFile(path.join(process.cwd(), "node_modules/bmp-js/test", filename));
    const output = await decodeUploadedImage(source);
    assert.equal((await sharp(output.bytes).metadata()).format, "png");
    assert.equal(output.extension, ".png");
  }
});
