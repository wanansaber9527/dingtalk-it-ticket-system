import { z } from "zod";
import {
  SATISFACTION_LEVELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES
} from "./constants.js";
import { AppError } from "./http.js";
import { parseShanghaiDateTime } from "./time.js";

const localDateTime = z
  .union([
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/),
    z.literal(""),
    z.null()
  ])
  .transform((value) => value || null);

const optionalText = (max) =>
  z
    .union([z.string().max(max), z.null()])
    .transform((value) => (typeof value === "string" && value.trim() ? value.trim() : null));

const fieldsSchema = z
  .object({
    title: z.string().trim().min(1, "工单标题不能为空").max(191),
    categoryName: z.string().trim().min(1, "工单分类不能为空").max(191),
    priority: z.enum(TICKET_PRIORITIES),
    status: z.enum(TICKET_STATUSES),
    applicantName: z.string().trim().min(1, "申请人不能为空").max(191),
    applicantDepartment: optionalText(191),
    applicantPosition: optionalText(191),
    handlerUserId: optionalText(191),
    handlerName: optionalText(191),
    description: z.string().trim().min(1, "问题描述不能为空").max(50_000),
    expectedResolveTime: localDateTime,
    firstResponseAt: localDateTime,
    resolvedAt: localDateTime,
    closedAt: localDateTime,
    slaFirstResponseDeadline: localDateTime,
    slaResolveDeadline: localDateTime,
    resultSummary: optionalText(50_000),
    satisfactionLevel: z.union([z.enum(SATISFACTION_LEVELS), z.null()]),
    satisfactionComment: optionalText(50_000),
    createdAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/)
  })
  .strict();

const correctionSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(4, "请填写至少 4 个字的更正原因").max(500),
    fields: fieldsSchema
  })
  .strict();

export function parseCorrectionPayload(payload) {
  const result = correctionSchema.safeParse(payload);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message
    }));
    throw new AppError(400, "VALIDATION_FAILED", details[0]?.message || "更正内容校验失败", details);
  }

  const { fields } = result.data;
  try {
    return {
      expectedUpdatedAt: new Date(result.data.expectedUpdatedAt),
      expectedFingerprint: result.data.expectedFingerprint,
      reason: result.data.reason,
      fields: {
        ...fields,
        createdAt: parseShanghaiDateTime(fields.createdAt),
        expectedResolveTime: parseShanghaiDateTime(fields.expectedResolveTime),
        firstResponseAt: parseShanghaiDateTime(fields.firstResponseAt),
        resolvedAt: parseShanghaiDateTime(fields.resolvedAt),
        closedAt: parseShanghaiDateTime(fields.closedAt),
        slaFirstResponseDeadline: parseShanghaiDateTime(fields.slaFirstResponseDeadline),
        slaResolveDeadline: parseShanghaiDateTime(fields.slaResolveDeadline)
      }
    };
  } catch {
    throw new AppError(400, "INVALID_DATETIME", "时间格式无效，请按北京时间重新选择");
  }
}
