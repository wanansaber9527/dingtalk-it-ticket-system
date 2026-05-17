// 中文注释：数据库初始化脚本，写入演示用户、默认分类和系统配置。
import { PrismaClient, UserRole } from "@prisma/client";
import { ticketCategorySeeds } from "../src/lib/labels";

const prisma = new PrismaClient();

async function main() {
  // 中文注释：正式环境可关闭演示账号，避免上线后出现测试用户和测试处理人。
  const includeDemoData = process.env.INCLUDE_DEMO_DATA !== "false";
  const defaultHandlerUserId = process.env.DEFAULT_HANDLER_USER_ID || (includeDemoData ? "demo-handler" : null);
  const defaultHandlerName = process.env.DEFAULT_HANDLER_NAME || (includeDemoData ? "李四" : null);

  if (includeDemoData) {
    await prisma.user.upsert({
      where: { dingtalkUserId: "demo-employee" },
      update: {},
      create: {
        dingtalkUserId: "demo-employee",
        name: "张三",
        mobile: "13800000001",
        departmentId: "dept-rd",
        departmentName: "研发部",
        position: "产品经理",
        role: UserRole.EMPLOYEE
      }
    });

    await prisma.user.upsert({
      where: { dingtalkUserId: "demo-handler" },
      update: {},
      create: {
        dingtalkUserId: "demo-handler",
        name: "李四",
        mobile: "13800000002",
        departmentId: "dept-it",
        departmentName: "信息技术部",
        position: "IT工程师",
        role: UserRole.IT_HANDLER
      }
    });

    await prisma.user.upsert({
      where: { dingtalkUserId: "demo-admin" },
      update: {},
      create: {
        dingtalkUserId: "demo-admin",
        name: "王五",
        mobile: "13800000003",
        departmentId: "dept-it",
        departmentName: "信息技术部",
        position: "IT管理员",
        role: UserRole.IT_ADMIN
      }
    });
  }

  await prisma.user.upsert({
    where: { dingtalkUserId: process.env.DEV_DINGTALK_USER_ID || "demo-super" },
    update: {
      role: UserRole.SUPER_ADMIN
    },
    create: {
      dingtalkUserId: process.env.DEV_DINGTALK_USER_ID || "demo-super",
      name: process.env.DEV_USER_NAME || "超级管理员",
      mobile: process.env.DEV_USER_MOBILE || "13800000000",
      departmentId: process.env.DEV_USER_DEPARTMENT_ID || "dept-it",
      departmentName: process.env.DEV_USER_DEPARTMENT_NAME || "信息技术部",
      position: process.env.DEV_USER_POSITION || "IT负责人",
      role: UserRole.SUPER_ADMIN
    }
  });

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
    where: { configKey: "AUTO_CLOSE_WAITING_CONFIRM_HOURS" },
    update: { configValue: process.env.AUTO_CLOSE_WAITING_CONFIRM_HOURS || "48" },
    create: {
      configKey: "AUTO_CLOSE_WAITING_CONFIRM_HOURS",
      configValue: process.env.AUTO_CLOSE_WAITING_CONFIRM_HOURS || "48",
      description: "待申请人确认状态超过指定小时数后可自动关闭"
    }
  });

  await prisma.systemConfig.upsert({
    where: { configKey: "AUTO_CLOSE_AFTER_CONFIRM" },
    update: { configValue: process.env.AUTO_CLOSE_AFTER_CONFIRM || "true" },
    create: {
      configKey: "AUTO_CLOSE_AFTER_CONFIRM",
      configValue: process.env.AUTO_CLOSE_AFTER_CONFIRM || "true",
      description: "申请人确认完成后是否立即自动关闭"
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
