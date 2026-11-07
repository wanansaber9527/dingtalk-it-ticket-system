import test from "node:test";
import assert from "node:assert/strict";
import { loadService, memoryDatabase, ticket, handler, applicant, admin } from "./helpers/service-harness";

const { TicketService } = loadService("src/server/services/ticketService.ts");
const { parsePagination, retryNumberConflict, businessDate } = loadService("src/server/services/serviceHelpers.ts");
function setup(rows?: any[]) {
  const memory = memoryDatabase(rows);
  const sent: any[] = [];
  const service = new TicketService(memory.db, { sendTicketEvent: async (ticket: unknown, targets: { target: unknown; notificationType: string; content: string }[]) => { for (const entry of targets) sent.push([ticket, entry.target, entry.notificationType, entry.content]); return targets.map(() => ({ sendStatus: "SUCCESS", delivery: "sent" })); } });
  return { ...memory, sent, service };
}

test("ticket detail exposes only the applicant avatar after verifying ticket visibility", async () => {
  const h = setup();
  let profileReads = 0;
  h.db.user.findUnique = async () => {
    profileReads++;
    return { avatar: "https://example.invalid/avatar.png", mobile: "private-field", name: "Updated profile" };
  };
  const result = await h.service.getTicketForUser("ticket-1", handler);
  assert.equal(result.applicant.avatar, "https://example.invalid/avatar.png");
  assert.deepEqual(Object.keys(result.applicant), ["avatar"]);
  assert.equal(result.applicantName, h.rows()[0].applicantName);
  assert.equal(profileReads, 1);
  await assert.rejects(h.service.getTicketForUser("ticket-1", { ...applicant, dingtalkUserId: "unrelated-employee" }), { status: 403 });
  assert.equal(profileReads, 1);
  h.db.user.findUnique = async () => null;
  assert.equal((await h.service.getTicketForUser("ticket-1", applicant)).applicant.avatar, null);
});

test("completed, closed, rejected and cancelled tickets cannot be assigned or transferred", async () => {
  for (const status of ["COMPLETED", "CLOSED", "REJECTED", "CANCELLED"]) {
    const h = setup([ticket({ status, resolvedAt: new Date() })]);
    await assert.rejects(h.service.transfer("ticket-1", "next", handler), { code: "INVALID_STATUS" });
    await assert.rejects(h.service.assign("ticket-1", "next", admin), { code: "INVALID_STATUS" });
    assert.equal(h.rows()[0].status, status);
    assert.equal(h.logs().length, 0);
    assert.equal(h.sent.length, 0);
  }
});

test("disabled handlers cannot receive assignments; stale defaults fall back to admins", async () => {
  const h = setup([]);
  h.users.find((user) => user.dingtalkUserId === "handler")!.status = "DISABLED";
  const created = await h.service.createTicket({ title: "Test", description: "Test issue", categoryId: "cat", priority: "NORMAL" }, applicant);
  assert.equal(created.ticket.handlerUserId, null);
  assert.equal(h.sent[1][1].dingtalkUserId, "admin");
  await assert.rejects(h.service.assign(created.ticket.id, "handler", admin), { code: "HANDLER_NOT_FOUND" });
});

test("late resolution records both overdue flags without needing a prior list refresh", async () => {
  const h = setup();
  await h.service.resolve("ticket-1", handler, "Repaired");
  assert.equal(h.rows()[0].status, "COMPLETED");
  assert.equal(h.rows()[0].isFirstResponseOverdue, true);
  assert.equal(h.rows()[0].isResolveOverdue, true);
  assert.equal(h.logs()[0].actionType, "RESOLVE");
});

test("on-time accept/resolve stays on-time; generic completion requires a result", async () => {
  const h = setup([ticket({ status: "ASSIGNED", slaFirstResponseDeadline: new Date(Date.now() + 60_000), slaResolveDeadline: new Date(Date.now() + 120_000) })]);
  await h.service.updateStatus("ticket-1", "PROCESSING", handler);
  await assert.rejects(h.service.updateStatus("ticket-1", "COMPLETED", handler), { code: "RESULT_REQUIRED" });
  await h.service.updateStatus("ticket-1", "COMPLETED", handler, "Repaired");
  assert.equal(h.rows()[0].resultSummary, "Repaired");
  assert.equal(h.rows()[0].isFirstResponseOverdue, false);
  assert.equal(h.rows()[0].isResolveOverdue, false);
});

test("two concurrent resolutions commit once and notify once", async () => {
  const h = setup();
  const result = await Promise.allSettled([
    h.service.resolve("ticket-1", handler, "Result A"),
    h.service.resolve("ticket-1", handler, "Result B")
  ]);
  assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal((result.find((item) => item.status === "rejected") as PromiseRejectedResult).reason.code, "TICKET_CHANGED");
  assert.equal(h.logs().length, 1);
  assert.equal(h.sent.length, 1);
});

test("log failure rolls back the state change and prevents notification", async () => {
  const h = setup();
  h.state.failLog = true;
  await assert.rejects(h.service.resolve("ticket-1", handler, "Done"), /Log storage failed/);
  assert.equal(h.rows()[0].status, "PROCESSING");
  assert.equal(h.rows()[0].resolvedAt, null);
  assert.equal(h.logs().length, 0);
  assert.equal(h.sent.length, 0);
});

test("completion no longer writes the retired knowledge archive", async () => {
  const h = setup();
  h.state.failKnowledge = true;
  await h.service.resolve("ticket-1", handler, "Done");
  assert.equal(h.rows()[0].status, "COMPLETED");
  assert.equal(h.logs().length, 1);
  assert.equal(h.sent.length, 1);
  assert.equal(h.knowledge().length, 0);
});

test("creation retries unique-number conflicts, but creation/log remain atomic", async () => {
  const h = setup([]);
  h.state.createConflicts = 1;
  const created = await h.service.createTicket({ title: "Test", description: "Test issue", categoryId: "cat", priority: "NORMAL" }, applicant);
  assert.equal(h.state.createAttempts, 2);
  assert.equal(h.rows().length, 1);
  assert.match(created.ticket.ticketNo, /^IT\d{12,}$/);
  assert.equal(h.logs().length, 1);
  const failure = setup([]);
  failure.state.failLog = true;
  await assert.rejects(failure.service.createTicket({ title: "Test", description: "Test issue", categoryId: "cat", priority: "NORMAL" }, applicant));
  assert.equal(failure.rows().length, 0);
  assert.equal(failure.sent.length, 0);
});

test("number retries are bounded and do not retry unrelated errors", async () => {
  let attempts = 0;
  await assert.rejects(retryNumberConflict(async () => { attempts++; throw { code: "P2002", meta: { target: ["ticketNo"] } }; }, "ticketNo"));
  assert.equal(attempts, 5);
  attempts = 0;
  await assert.rejects(retryNumberConflict(async () => { attempts++; throw new Error("Offline"); }, "ticketNo"), /Offline/);
  assert.equal(attempts, 1);
});

test("keyword and overdue filters intersect; pagination reaches records beyond the old cap", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ticket({ id: `ticket-${String(index).padStart(3, "0")}`, ticketNo: `T${index}`, status: "COMPLETED", isResolveOverdue: index % 2 === 0, title: index < 203 ? "Printer" : "Network", description: "Device issue" }));
  const h = setup(rows);
  const page = await h.service.listAdminTickets({ overdue: true, keyword: "Printer" }, admin, { page: 6, pageSize: 20 });
  assert.equal(page.total, 102);
  assert.equal(page.items.length, 2);
  assert.ok(page.items.every((row: any) => row.isResolveOverdue && row.title === "Printer"));
  const myPage = await h.service.listMyTickets(applicant, { page: 11, pageSize: 20 });
  assert.equal(myPage.total, 205);
  assert.equal(myPage.items.length, 5);
  assert.ok(Array.isArray(await h.service.listMyTickets(applicant)));
});

test("pagination rejects invalid ranges and date numbering uses Shanghai boundaries", () => {
  assert.equal(parsePagination(new URLSearchParams()), undefined);
  for (const query of ["page=0", "page=-1", "page=1.1", "pageSize=101", "pageSize=0", "page=x"]) assert.throws(() => parsePagination(new URLSearchParams(query)), { code: "INVALID_PAGINATION" });
  const day = businessDate(new Date("2026-11-07T16:01:00Z"));
  assert.equal(day.stamp, "20261108");
  assert.equal(day.start.toISOString(), "2026-11-07T16:00:00.000Z");
});

test("workbench groups filter all pages while counts stay scoped to the handler and keyword", async () => {
  const fixture = (id: string, patch: Record<string, unknown> = {}) => ticket({ id, ticketNo: id, title: "Printer", description: "Device issue", slaFirstResponseDeadline: null, slaResolveDeadline: null, ...patch });
  const rows = [
    ...Array.from({ length: 210 }, (_, index) => fixture(`todo-${index}`, { status: ["PENDING", "ASSIGNED", "PROCESSING"][index % 3], isResolveOverdue: index % 2 === 0 })),
    ...Array.from({ length: 7 }, (_, index) => fixture(`returned-${index}`, { status: "RETURNED", isFirstResponseOverdue: index < 3, isResolveOverdue: index === 2 })),
    ...Array.from({ length: 2 }, (_, index) => fixture(`completed-${index}`, { status: "COMPLETED", isResolveOverdue: true })),
    ...Array.from({ length: 5 }, (_, index) => fixture(`other-handler-${index}`, { status: "PENDING", handlerUserId: "next", isResolveOverdue: true })),
    fixture("unassigned", { status: "PENDING", handlerUserId: null }),
    ...Array.from({ length: 9 }, (_, index) => fixture(`other-keyword-${index}`, { title: "Network", status: "RETURNED" }))
  ];
  const h = setup(rows);
  const filters = { keyword: "Printer", includeStats: true };
  const page = await h.service.listAdminTickets({ ...filters, statusGroup: "todo", handlerUserId: "next" }, handler, { page: 11, pageSize: 20 });
  assert.equal(page.total, 210);
  assert.equal(page.items.length, 10);
  assert.ok(page.items.every((row: any) => ["PENDING", "ASSIGNED", "PROCESSING"].includes(row.status) && row.handlerUserId === handler.dingtalkUserId));
  assert.equal(JSON.stringify(page.stats), JSON.stringify({ todo: 210, returned: 7, overdue: 110 }));
  const returned = await h.service.listAdminTickets({ ...filters, statusGroup: "returned", overdue: true }, handler, { page: 1, pageSize: 20 });
  assert.equal(returned.total, 3);
  assert.ok(returned.items.every((row: any) => row.status === "RETURNED" && (row.isFirstResponseOverdue || row.isResolveOverdue)));
  assert.deepEqual(returned.stats, page.stats);
  const overdue = await h.service.listAdminTickets({ ...filters, overdue: true }, handler, { page: 1, pageSize: 100 });
  assert.equal(overdue.total, 110);
  assert.deepEqual(overdue.stats, page.stats);
  const completed = await h.service.listAdminTickets({ ...filters, status: "COMPLETED", overdue: true }, handler, { page: 1, pageSize: 20 });
  assert.equal(completed.total, 2);
  assert.deepEqual(completed.stats, page.stats);
  const otherKeyword = await h.service.listAdminTickets({ keyword: "Network", includeStats: true }, handler, { page: 1, pageSize: 20 });
  assert.equal(JSON.stringify(otherKeyword.stats), JSON.stringify({ todo: 0, returned: 9, overdue: 0 }));
  const adminFiltered = await h.service.listAdminTickets({ ...filters, handlerUserId: "next" }, admin, { page: 1, pageSize: 20 });
  assert.equal(adminFiltered.total, 5);
  assert.equal(adminFiltered.stats.todo, 5);
  const dualRole = { ...admin, roleAssignments: [...admin.roleAssignments, { role: "IT_HANDLER" }] };
  const adminAll = await h.service.listAdminTickets(filters, dualRole, { page: 1, pageSize: 20 });
  assert.equal(adminAll.total, 225);
  assert.equal(adminAll.stats.todo, 216);
});

test("workbench stats are opt-in, preserve legacy arrays and cannot bypass role or exact-state filters", async () => {
  const h = setup([ticket({ status: "RETURNED", slaFirstResponseDeadline: null, slaResolveDeadline: null })]);
  const legacy = await h.service.listAdminTickets({ includeStats: true }, handler);
  assert.ok(Array.isArray(legacy));
  const normalPage = await h.service.listAdminTickets({}, handler, { page: 1, pageSize: 20 });
  assert.equal("stats" in normalPage, false);
  const intersection = await h.service.listAdminTickets({ status: "PROCESSING", statusGroup: "returned", includeStats: true }, handler, { page: 1, pageSize: 20 });
  assert.equal(intersection.total, 0);
  assert.equal(intersection.stats.returned, 1);
  await assert.rejects(h.service.listAdminTickets({ statusGroup: "unsupported" }, handler, { page: 1, pageSize: 20 }), { code: "INVALID_STATUS_GROUP", status: 400 });
  await assert.rejects(h.service.listAdminTickets({ includeStats: true }, applicant, { page: 1, pageSize: 20 }), { code: "FORBIDDEN" });
  await assert.rejects(h.service.listAdminTickets({ includeStats: true }, { ...handler, status: "DISABLED" }, { page: 1, pageSize: 20 }), { code: "USER_DISABLED" });
});

test("return, applicant supplement and satisfaction keep the existing business flow", async () => {
  const h = setup();
  await h.service.returnToApplicant("ticket-1", handler, "Need details");
  assert.equal(h.rows()[0].status, "RETURNED");
  assert.equal(h.rows()[0].isResolveOverdue, false);
  await assert.rejects(h.service.supplementReturnedTicket("ticket-1", admin, "Details"), { code: "FORBIDDEN" });
  await h.service.supplementReturnedTicket("ticket-1", applicant, "More details");
  assert.equal(h.rows()[0].status, "PROCESSING");
  await h.service.resolve("ticket-1", handler, "Repaired");
  await h.service.satisfaction("ticket-1", applicant, "SATISFIED");
  assert.equal(h.rows()[0].satisfactionLevel, "SATISFIED");
  assert.deepEqual(h.logs().map((log) => log.actionType), ["RETURN_TO_APPLICANT", "APPLICANT_SUPPLEMENT", "RESOLVE", "SATISFACTION"]);
});


test("closing an already closed ticket is idempotent", async () => {
  const h = setup();
  await h.service.close("ticket-1", admin, "Closed by administrator");
  const closedAt = h.rows()[0].closedAt.getTime();
  await h.service.close("ticket-1", admin, "Repeated click");
  assert.equal(h.rows()[0].closedAt.getTime(), closedAt);
  assert.equal(h.logs().length, 1);
  assert.equal(h.sent.length, 1);
});
