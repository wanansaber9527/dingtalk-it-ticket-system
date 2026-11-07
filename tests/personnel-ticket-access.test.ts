import test from "node:test";
import assert from "node:assert/strict";
import { loadService, memoryDatabase, ticket, applicant, handler, admin } from "./helpers/service-harness";

const { TicketService } = loadService("src/server/services/ticketService.ts");
const { canViewTicket, ticketPermissions } = loadService("src/server/permissions.ts");

test("internal ticket ownership overrides matching external snapshots, and rehire retains only original access", () => {
  const history = ticket({ applicantId: applicant.id, handlerId: handler.id, ccRecipients: [{ personId: "cc-person", userId: "old-cc" }] });
  const returned = { ...applicant, dingtalkUserId: "new-account" };
  assert.equal(canViewTicket(returned, history), true);
  assert.equal(canViewTicket({ ...applicant, id: "impostor" }, history), false);
  const cc = { ...applicant, id: "cc-person", dingtalkUserId: "new-cc" };
  assert.deepEqual(JSON.parse(JSON.stringify(ticketPermissions(cc, history))), { canComment: false, canSupplement: false, canRate: false, canOperate: false, isCcOnly: true });
  assert.equal(canViewTicket({ ...returned, employmentStatus: "DEPARTED" }, history), false);
});

test("revoked in-flight actor cannot create or mutate a ticket after archive", async () => {
  const h = memoryDatabase();
  const service = new TicketService(h.db, { sendTicketEvent: async () => [] });
  h.users.find((u) => u.id === applicant.id)!.sessionVersion = 1;
  await assert.rejects(service.createTicket({ title: "Late create", categoryId: "cat", description: "must not write", priority: "NORMAL" }, applicant), (e: any) => e.code === "SESSION_REVOKED");
  h.users.find((u) => u.id === handler.id)!.status = "DISABLED";
  await assert.rejects(service.addComment("ticket-1", "Late comment", handler), (e: any) => e.code === "SESSION_REVOKED");
  assert.equal(h.rows().length, 1); assert.equal(h.logs().length, 0);
});

test("current handler filter and personal history include prior external identity via permanent id", async () => {
  const h = memoryDatabase([ticket({ applicantId: applicant.id, handlerId: handler.id })]);
  const current = h.users.find((u) => u.id === handler.id)!; current.dingtalkUserId = "rehired-handler";
  const service = new TicketService(h.db, { sendTicketEvent: async () => [] });
  const selected = await service.listAdminTickets({ handlerUserId: current.dingtalkUserId }, admin, { page: 1, pageSize: 20 });
  assert.equal(selected.total, 1);
  const mine = await service.listMyTickets({ ...applicant, dingtalkUserId: "rehired-applicant" }, { page: 1, pageSize: 20 });
  assert.equal(mine.total, 1);
});

test("duplicate warning only considers the same permanent applicant", async () => {
  for (const owner of [applicant.id, "someone-else"]) {
    const h = memoryDatabase([ticket({ applicantId: owner, applicantUserId: "old-external", title: "Shared issue", createdAt: new Date() })]);
    const service = new TicketService(h.db, { sendTicketEvent: async () => [] });
    const result = await service.createTicket({ title: "Shared issue", categoryId: "cat", description: "Same generic description", priority: "NORMAL" }, applicant);
    assert.equal(result.duplicateWarning, owner === applicant.id);
  }
});


test("a default handler archived after lookup is not assigned and the new ticket goes to administrators", async () => {
  const h = memoryDatabase([]);
  const originalLookup = h.db.user.findUnique;
  h.db.user.findUnique = async (args: any) => {
    const result = await originalLookup(args);
    if (args.where.dingtalkUserId === handler.dingtalkUserId) {
      const current = h.users.find((user) => user.id === handler.id)!;
      current.status = "DISABLED";
      current.employmentStatus = "DEPARTED";
      current.sessionVersion++;
    }
    return result;
  };
  const recipients: string[] = [];
  const service = new TicketService(h.db, { sendTicketEvent: async (_ticket: unknown, targets: any[]) => { recipients.push(...targets.map((entry) => entry.target.dingtalkUserId)); return []; } });
  const result = await service.createTicket({ title: "Handler left during submission", categoryId: "cat", description: "Preserve the request", priority: "NORMAL" }, applicant);
  assert.equal(result.ticket.handlerId, null);
  assert.equal(result.ticket.handlerUserId, null);
  assert.equal(h.rows().length, 1);
  assert.ok(recipients.includes(admin.dingtalkUserId));
  assert.ok(!recipients.includes(handler.dingtalkUserId));
});

test("assignment and transfer recheck the selected handler inside the committing transaction", async () => {
  for (const action of ["assign", "transfer"]) {
    const h = memoryDatabase();
    const originalLookup = h.db.user.findUnique;
    h.db.user.findUnique = async (args: any) => {
      const result = await originalLookup(args);
      if (args.where.dingtalkUserId === "next") {
        const current = h.users.find((user) => user.dingtalkUserId === "next")!;
        current.status = "DISABLED";
        current.employmentStatus = "DEPARTED";
        current.sessionVersion++;
      }
      return result;
    };
    let deliveries = 0;
    const service = new TicketService(h.db, { sendTicketEvent: async () => { deliveries++; return []; } });
    await assert.rejects(service[action]("ticket-1", "next", action === "assign" ? admin : handler), (error: any) => error.code === "HANDLER_NOT_FOUND");
    assert.equal(h.rows()[0].handlerUserId, handler.dingtalkUserId);
    assert.equal(h.logs().length, 0);
    assert.equal(deliveries, 0);
  }
});

test("silent deletion rejects an archived or demoted administrator and permits a current administrator", async () => {
  for (const state of ["archived", "demoted", "active"]) {
    const h = memoryDatabase();
    let deletions = 0;
    h.db.ticket.deleteMany = async () => { deletions++; h.rows().splice(0, 1); return { count: 1 }; };
    const current = h.users.find((user) => user.id === admin.id)!;
    if (state === "archived") { current.status = "DISABLED"; current.employmentStatus = "DEPARTED"; current.sessionVersion++; }
    if (state === "demoted") current.roleAssignments = [{ role: "EMPLOYEE" }];
    const service = new TicketService(h.db, { sendTicketEvent: async () => [] });
    if (state === "active") {
      assert.equal((await service.silentDelete("ticket-1", admin)).deleted, true);
      assert.equal(deletions, 1);
      assert.equal(h.rows().length, 0);
    } else {
      await assert.rejects(service.silentDelete("ticket-1", admin), (error: any) => error.code === (state === "archived" ? "SESSION_REVOKED" : "FORBIDDEN"));
      assert.equal(deletions, 0);
      assert.equal(h.rows().length, 1);
    }
  }
});
