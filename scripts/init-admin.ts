// 中文注释：本地运维脚本，用于初始化超级管理员。
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function readArg(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function ensureRole(userId: string, role: "EMPLOYEE" | "SUPER_ADMIN") {
  await prisma.userRoleAssignment.upsert({
    where: { userId_role: { userId, role } },
    update: {},
    create: { userId, role }
  });
}

async function main() {
  const dingtalkUserId = readArg("userId") || readArg("dingtalkUserId");
  const name = readArg("name") || "系统管理员";

  if (!dingtalkUserId) {
    throw new Error("缺少参数：npm run init:admin -- --userId <钉钉userId> --name <姓名>");
  }

  const user = await prisma.user.upsert({
    where: { dingtalkUserId },
    update: {
      name,
      status: "ACTIVE"
    },
    create: {
      dingtalkUserId,
      name,
      status: "ACTIVE"
    }
  });
  await ensureRole(user.id, "EMPLOYEE");
  await ensureRole(user.id, "SUPER_ADMIN");

  console.log(`初始化超级管理员成功：${user.name} (${user.dingtalkUserId})`);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error.message);
    await prisma.$disconnect();
    process.exit(1);
  });
