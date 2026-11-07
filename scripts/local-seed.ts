import { PrismaClient, TicketStatus, UserRole } from "@prisma/client";

const connection = new URL(process.env.DATABASE_URL || "");
if (connection.hostname !== "127.0.0.1" || connection.port !== "33427" || connection.pathname !== "/itdesk_local") {
  throw new Error("示例数据仅允许写入独立本地测试库");
}
const prisma = new PrismaClient();

async function seed() {
  const people: Array<[string, string, string, UserRole[]]> = [
    ["local-admin", "本地管理员", "信息技术部", ["EMPLOYEE", "SUPER_ADMIN", "IT_HANDLER"]],
    ["local-handler", "陈工 · 测试", "信息技术部", ["EMPLOYEE", "IT_HANDLER"]],
    ["local-handler-2", "林工 · 测试", "信息技术部", ["EMPLOYEE", "IT_HANDLER"]],
    ["local-employee", "许宁 · 测试", "运营部", ["EMPLOYEE"]],
    ["local-employee-2", "周然 · 测试", "仓储部", ["EMPLOYEE"]]
  ];
  for (const [id, name, department, roles] of people) {
    const user = await prisma.user.upsert({ where: { dingtalkUserId: id }, update: {}, create: { dingtalkUserId: id, name, departmentName: department, position: department === "信息技术部" ? "IT支持" : "业务专员" } });
    for (const role of roles) await prisma.userRoleAssignment.upsert({ where: { userId_role: { userId: user.id, role } }, update: {}, create: { userId: user.id, role } });
  }
  const categoryNames = ["电脑故障", "网络问题", "系统账号", "软件安装", "打印设备", "数据报表"];
  const categories = [];
  for (const [i, name] of categoryNames.entries()) {
    categories.push(await prisma.ticketCategory.upsert({ where: { name }, update: {}, create: { name, description: `${name}相关的 IT 支持`, defaultHandlerUserId: "local-handler", defaultHandlerName: "陈工 · 测试", firstResponseMinutes: 60, resolveMinutes: 480, sortOrder: i * 10 } }));
  }
  const titles = ["办公电脑启动后无法进入系统", "会议室无线网络连接不稳定", "申请开通新同事的业务系统账号", "安装设计软件与字体", "仓库打印机出现卡纸提示", "日报导出字段缺失", "电脑外接显示器无信号", "钉钉审批页面加载缓慢", "业务系统账号密码重置", "安装远程会议客户端", "打印颜色偏差需要调整", "周报数据核对与修复", "电脑存储空间不足", "办公区域网络延迟排查", "新员工入职账号配置", "文档编辑软件更新", "共享打印机无法连接", "运营报表无法刷新"];
  const statuses: TicketStatus[] = ["PROCESSING", "PENDING", "ASSIGNED", "RETURNED", "COMPLETED", "CLOSED", "PROCESSING", "ASSIGNED", "COMPLETED", "COMPLETED", "REJECTED", "CANCELLED", "PENDING", "PROCESSING", "COMPLETED", "COMPLETED", "RETURNED", "ASSIGNED"];
  const now = Date.now();
  for (let i = 0; i < titles.length; i += 1) {
    const status = statuses[i];
    const category = categories[i % categories.length];
    const createdAt = new Date(now - i * 3_600_000 - 30 * 60_000);
    const completed = ["COMPLETED", "CLOSED"].includes(status);
    const started = !["PENDING", "ASSIGNED"].includes(status);
    const firstResponseAt = started ? new Date(createdAt.getTime() + 20 * 60_000) : null;
    const resolvedAt = completed ? new Date(createdAt.getTime() + 100 * 60_000) : null;
    const handler = i % 4 === 3 ? people[2] : people[1];
    const applicant = i % 3 === 2 ? people[4] : people[3];
    const ticket = await prisma.ticket.upsert({
      where: { ticketNo: `LOCAL-DEMO-${String(i + 1).padStart(4, "0")}` }, update: {},
      create: { title: titles[i], ticketNo: `LOCAL-DEMO-${String(i + 1).padStart(4, "0")}`, categoryId: category.id, categoryName: category.name, priority: i % 7 === 0 ? "HIGH" : "NORMAL", status, applicantUserId: applicant[0], applicantName: applicant[1], applicantDepartment: applicant[2], handlerUserId: handler[0], handlerName: handler[1], description: `这是本地测试用的示例工单。\n问题现象：${titles[i]}。\n出现时间：今天上午，已尝试重启设备，问题仍然存在。希望协助检查并恢复正常使用。`, createdAt, firstResponseAt, resolvedAt, closedAt: status === "CLOSED" ? resolvedAt : null, slaFirstResponseDeadline: new Date(createdAt.getTime() + 60 * 60_000), slaResolveDeadline: new Date(createdAt.getTime() + 480 * 60_000), isFirstResponseOverdue: !started && now > createdAt.getTime() + 60 * 60_000, isResolveOverdue: ["PENDING", "ASSIGNED", "PROCESSING"].includes(status) && now > createdAt.getTime() + 480 * 60_000, resultSummary: completed ? "已完成排查和处理，功能恢复正常。请在使用后进行满意度评价。" : null, satisfactionLevel: completed && i % 2 === 0 ? "SATISFIED" : null }
    });
    if (await prisma.ticketLog.count({ where: { ticketId: ticket.id } }) === 0) {
      await prisma.ticketLog.create({ data: { ticketId: ticket.id, ticketNo: ticket.ticketNo, operatorUserId: applicant[0], operatorName: applicant[1], actionType: "CREATE", toStatus: "PENDING", remark: "员工提交工单（本地示例）", createdAt } });
      if (started) await prisma.ticketLog.create({ data: { ticketId: ticket.id, ticketNo: ticket.ticketNo, operatorUserId: handler[0], operatorName: handler[1], actionType: status === "RETURNED" ? "RETURN_TO_APPLICANT" : completed ? "RESOLVE" : "ACCEPT", fromStatus: "PENDING", toStatus: status, remark: status === "RETURNED" ? "请补充报错截图和设备编号，便于进一步排查。" : completed ? "问题已处理完成。" : "已接单，正在排查。", createdAt: firstResponseAt || createdAt } });
    }
  }
  for (const [i, title] of ["无线网络无法连接时如何排查", "打印机离线的常见处理方法", "业务系统账号与密码使用说明"].entries()) {
    await prisma.knowledgeBase.upsert({ where: { kbNo: `LOCAL-KB-${i}` }, update: {}, create: { kbNo: `LOCAL-KB-${i}`, title, categoryId: categories[i].id, categoryName: categories[i].name, problemDescription: title, solutionSteps: "1. 检查设备连接和网络状态。\n2. 保存当前工作，重新启动相关应用。\n3. 如果问题仍然存在，提交工单并附上报错截图。", maintainerUserId: "local-handler", maintainerName: "陈工 · 测试", enabled: true } });
  }
  console.log("本地示例数据已准备；再次执行不会覆盖已有测试操作。");
}
seed().finally(() => prisma.$disconnect()).catch((error) => { console.error(error.message); process.exitCode = 1; });
