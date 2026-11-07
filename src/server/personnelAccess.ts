import type { Prisma } from "@prisma/client";

type Identity = { id: string; dingtalkUserId: string };

// 有内部身份时绝不退回外部账号匹配；null 分支只兼容尚未回填的旧记录。
export function matchesPerson(user: Identity, personId: string | null | undefined, externalId: string | null | undefined) {
  return personId ? personId === user.id : externalId === user.dingtalkUserId;
}

export function applicantScope(user: Identity): Prisma.TicketWhereInput {
  return { OR: [{ applicantId: user.id }, { applicantId: null, applicantUserId: user.dingtalkUserId }] };
}

export function handlerScope(user: Identity): Prisma.TicketWhereInput {
  return { OR: [{ handlerId: user.id }, { handlerId: null, handlerUserId: user.dingtalkUserId }] };
}

export function ccScope(user: Identity): Prisma.TicketCcRecipientWhereInput {
  return { OR: [{ personId: user.id }, { personId: null, userId: user.dingtalkUserId }] };
}
