// 中文注释：数据库初始化脚本，写入演示用户、默认分类和系统配置。
import { PrismaClient, UserRole } from "@prisma/client";
import { ticketCategorySeeds } from "../src/lib/labels";

const prisma = new PrismaClient();

type SeedUser = {
  dingtalkUserId: string;
  name: string;
  mobile?: string;
  departmentId?: string;
  departmentName?: string;
  position?: string;
};

async function assignRoles(userId: string, roles: UserRole[]) {
  for (const role of roles) {
    await prisma.userRoleAssignment.upsert({
      where: { userId_role: { userId, role } },
      update: {},
      create: { userId, role }
    });
  }
}

async function upsertSeedUser(input: SeedUser, roles: UserRole[]) {
  const user = await prisma.user.upsert({
    where: { dingtalkUserId: input.dingtalkUserId },
    update: {
      name: input.name,
      mobile: input.mobile || null,
      departmentId: input.departmentId || null,
      departmentName: input.departmentName || null,
      position: input.position || null,
      status: "ACTIVE"
    },
    create: {
      dingtalkUserId: input.dingtalkUserId,
      name: input.name,
      mobile: input.mobile || null,
      departmentId: input.departmentId || null,
      departmentName: input.departmentName || null,
      position: input.position || null,
      status: "ACTIVE"
    }
  });
  await assignRoles(user.id, [UserRole.EMPLOYEE, ...roles]);
  return user;
}

async function main() {
  // 中文注释：正式环境可关闭演示账号，避免上线后出现测试用户和测试处理人。
  const includeDemoData = process.env.INCLUDE_DEMO_DATA !== "false";
  const defaultHandlerUserId = process.env.DEFAULT_HANDLER_USER_ID || (includeDemoData ? "demo-handler" : null);
  const defaultHandlerName = process.env.DEFAULT_HANDLER_NAME || (includeDemoData ? "李四" : null);

  if (includeDemoData) {
    await upsertSeedUser(
      {
        dingtalkUserId: "demo-employee",
        name: "张三",
        mobile: "13800000001",
        departmentId: "dept-rd",
        departmentName: "研发部",
        position: "产品经理"
      },
      []
    );

    await upsertSeedUser(
      {
        dingtalkUserId: "demo-handler",
        name: "李四",
        mobile: "13800000002",
        departmentId: "dept-it",
        departmentName: "信息技术部",
        position: "IT工程师"
      },
      [UserRole.IT_HANDLER]
    );

    await upsertSeedUser(
      {
        dingtalkUserId: "demo-admin",
        name: "王五",
        mobile: "13800000003",
        departmentId: "dept-it",
        departmentName: "信息技术部",
        position: "超级管理员"
      },
      [UserRole.SUPER_ADMIN]
    );
  }

  await upsertSeedUser(
    {
      dingtalkUserId: process.env.DEV_DINGTALK_USER_ID || "demo-super",
      name: process.env.DEV_USER_NAME || "超级管理员",
      mobile: process.env.DEV_USER_MOBILE || "13800000000",
      departmentId: process.env.DEV_USER_DEPARTMENT_ID || "dept-it",
      departmentName: process.env.DEV_USER_DEPARTMENT_NAME || "信息技术部",
      position: process.env.DEV_USER_POSITION || "IT负责人"
    },
    [UserRole.SUPER_ADMIN]
  );

  for (const item of ticketCategorySeeds) {
    await prisma.ticketCategory.upsert({
      where: { name: item.name },
      update: {
        firstResponseMinutes: item.firstResponseMinutes,
        resolveMinutes: item.resolveMinutes,
        sortOrder: item.sortOrder,
        defaultHandlerUserId,
        defaultHandlerName
      },
      create: {
        ...item,
        description: `${item.name}相关 IT 支持工单`,
        defaultHandlerUserId,
        defaultHandlerName
      }
    });
  }

  await prisma.systemConfig.upsert({
    where: { configKey: "SLA_DUE_SOON_MINUTES" },
    update: { configValue: process.env.SLA_DUE_SOON_MINUTES || "120" },
    create: {
      configKey: "SLA_DUE_SOON_MINUTES",
      configValue: process.env.SLA_DUE_SOON_MINUTES || "120",
      description: "SLA 截止前多少分钟发送即将超时通知"
    }
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
