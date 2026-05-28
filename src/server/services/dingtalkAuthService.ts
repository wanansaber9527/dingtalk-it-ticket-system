// 中文注释：业务服务层，封装工单系统核心业务规则和数据操作。
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma";
import { DingTalkClient } from "@/src/server/dingtalk/DingTalkClient";

export class DingTalkAuthService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly dingtalkClient = new DingTalkClient()
  ) {}

  async loginByCode(code: string) {
    const userId = await this.dingtalkClient.getUserIdByAuthCode(code);
    const detail = await this.dingtalkClient.getUserDetail(userId);
    const department = await this.getSafeDepartmentInfo(detail);

    const user = await this.prisma.user.upsert({
      where: { dingtalkUserId: userId },
      update: {
        name: detail.name,
        mobile: detail.mobile || null,
        departmentId: department.departmentId || null,
        departmentName: department.departmentName || null,
        position: detail.position || detail.title || null,
        avatar: detail.avatar || null
      },
      create: {
        dingtalkUserId: userId,
        name: detail.name,
        mobile: detail.mobile || null,
        departmentId: department.departmentId || null,
        departmentName: department.departmentName || null,
        position: detail.position || detail.title || null,
        avatar: detail.avatar || null
      }
    });
    await this.prisma.userRoleAssignment.upsert({
      where: { userId_role: { userId: user.id, role: "EMPLOYEE" } },
      update: {},
      create: { userId: user.id, role: "EMPLOYEE" }
    });

    return this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { roleAssignments: true }
    });
  }

  private async getSafeDepartmentInfo(detail: Awaited<ReturnType<DingTalkClient["getUserDetail"]>>) {
    try {
      return await this.dingtalkClient.getUserDepartmentInfo(detail);
    } catch (error) {
      // 中文注释：部门详情权限未开通时不能阻断免登，先保留用户身份，后续开通权限后再补齐部门。
      console.error("钉钉部门信息获取失败，已降级为空部门：", error instanceof Error ? error.message : error);
      return {
        departmentId: detail.dept_id_list?.[0] ? String(detail.dept_id_list[0]) : "",
        departmentName: detail.department?.[0] || ""
      };
    }
  }
}
