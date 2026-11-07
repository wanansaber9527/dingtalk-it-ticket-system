import test from "node:test";
import assert from "node:assert/strict";
import { loadSecuritySource } from "./helpers/security-source";

const { canViewTicket, canCommentTicket, requireCanViewTicket, requireCanCommentTicket, requireTicketOperator, ticketPermissions } = loadSecuritySource("src/server/permissions.ts");
const employee = { id: "cc", dingtalkUserId: "cc", name: "CC", status: "ACTIVE", roleAssignments: [{ role: "EMPLOYEE" }] };
const ticket = { applicantUserId: "applicant", handlerUserId: "handler", status: "RETURNED", ccRecipients: [{ userId: "cc" }] };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test("CC permission grants only current ticket reads and never comments or operator actions", () => {
  assert.equal(canViewTicket(employee, ticket), true);
  assert.doesNotThrow(() => requireCanViewTicket(employee, ticket));
  assert.equal(canCommentTicket(employee, ticket), false);
  assert.throws(() => requireCanCommentTicket(employee, ticket), { code: "FORBIDDEN" });
  assert.throws(() => requireTicketOperator(employee, ticket), { code: "FORBIDDEN" });
  assert.deepEqual(plain(ticketPermissions(employee, ticket)), { canComment: false, canSupplement: false, canRate: false, canOperate: false, isCcOnly: true });
  assert.equal(canViewTicket(employee, { ...ticket, ccRecipients: [] }), false);
  assert.equal(canViewTicket({ ...employee, dingtalkUserId: "other" }, ticket), false);
});

test("CC users who also own or handle the ticket keep their original permissions", () => {
  const ownTicket = { ...ticket, applicantUserId: "cc" };
  assert.equal(canCommentTicket(employee, ownTicket), true);
  assert.equal(ticketPermissions(employee, ownTicket).canSupplement, true);
  assert.equal(ticketPermissions(employee, { ...ownTicket, status: "PROCESSING" }).canSupplement, false);
  assert.equal(ticketPermissions(employee, { ...ownTicket, status: "COMPLETED" }).canRate, true);
  assert.equal(ticketPermissions(employee, ownTicket).isCcOnly, false);
  const handler = { ...employee, roleAssignments: [{ role: "IT_HANDLER" }] };
  assert.equal(ticketPermissions(handler, ticket).canOperate, false);
  assert.equal(ticketPermissions(handler, { ...ticket, handlerUserId: "cc" }).canOperate, true);
  assert.equal(canCommentTicket(handler, { ...ticket, handlerUserId: "cc" }), true);
  const admin = { ...employee, roleAssignments: [{ role: "SUPER_ADMIN" }] };
  assert.equal(ticketPermissions(admin, ticket).canOperate, true);
  assert.equal(ticketPermissions(admin, ticket).isCcOnly, false);
});

test("disabled identities cannot read through CC or any existing role", () => {
  for (const role of ["EMPLOYEE", "IT_HANDLER", "SUPER_ADMIN"]) {
    const disabled = { ...employee, status: "DISABLED", roleAssignments: [{ role }] };
    assert.equal(canViewTicket(disabled, ticket), false);
    assert.equal(canCommentTicket(disabled, ticket), false);
    assert.throws(() => requireCanViewTicket(disabled, ticket), { code: "USER_DISABLED" });
    assert.deepEqual(plain(ticketPermissions(disabled, ticket)), { canComment: false, canSupplement: false, canRate: false, canOperate: false, isCcOnly: false });
  }
});

test("CC attachment reads follow ticket and log relationships and do not authorize unrelated files", async () => {
  let linkedTicket = { ...ticket, attachments: JSON.stringify([{ url: "/api/uploads/asset.png" }]), logs: [] as any[] };
  let query: any;
  const uploads = loadSecuritySource("src/server/uploads.ts", { prisma: { ticket: { findMany: async (args: any) => { query = args; return [linkedTicket]; } } } });
  await uploads.requireCanReadUpload("asset.png", employee);
  assert.equal(query.select.ccRecipients.select.userId, true);
  linkedTicket = { ...linkedTicket, attachments: "[]", logs: [{ attachments: JSON.stringify([{ url: "/uploads/asset.png" }]) }] };
  await uploads.requireCanReadUpload("asset.png", employee);
  linkedTicket = { ...linkedTicket, ccRecipients: [] };
  await assert.rejects(uploads.requireCanReadUpload("asset.png", employee), { code: "UPLOAD_FORBIDDEN" });
});

test("ticket AI snapshot loads CC membership while the private conversation remains owner-only", async () => {
  let row = { ...ticket, aiContextSnapshot: JSON.stringify({ id: "conversation", messages: [{ role: "user", content: "Submitted snapshot" }] }) };
  let ticketQuery: any;
  let conversationQuery: any;
  const db = {
    ticket: { findUnique: async (args: any) => { ticketQuery = args; return row; } },
    aiConversation: { findFirst: async (args: any) => { conversationQuery = args; return null; } }
  };
  const { AiService } = loadSecuritySource("src/server/services/aiService.ts", { modules: {
    "node:crypto": { randomUUID: () => "test-id" },
    "./ticketService": { TicketService: class { constructor() { throw new Error("Ticket writes forbidden"); } } },
    "@/src/server/ai/config": { getPublicAiSettings: async () => ({ retentionDays: 30 }) },
    "@/src/server/ai/context": {},
    "@/src/server/ai/provider": {},
    "@/src/server/ai/database": {},
    "@/src/server/ai/followups": {},
    "@/src/server/uploads": {}
  } });
  const service = new AiService(db);
  assert.equal((await service.ticketContext("ticket-1", employee)).conversation.messages[0].content, "Submitted snapshot");
  assert.equal(ticketQuery.include.ccRecipients.select.userId, true);
  await assert.rejects(service.own("conversation", employee), { code: "AI_CONVERSATION_NOT_FOUND" });
  assert.equal(conversationQuery.where.userId, "cc");
  row = { ...row, ccRecipients: [] };
  await assert.rejects(service.ticketContext("ticket-1", employee), { code: "FORBIDDEN" });
});
