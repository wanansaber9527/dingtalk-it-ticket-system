import { AppError } from "@/src/lib/http";

export function isDevelopmentAuthEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_ENABLED === "true";
}

export function isDingTalkMockEnabled() {
  if (process.env.NODE_ENV === "production" && process.env.DINGTALK_MOCK_ENABLED === "true") {
    throw new AppError(500, "UNSAFE_AUTH_CONFIGURATION", "正式环境禁止使用模拟钉钉身份");
  }
  return process.env.NODE_ENV !== "production" && process.env.DINGTALK_MOCK_ENABLED === "true";
}

export function assertSafeAuthMode() {
  if (process.env.NODE_ENV === "production" && process.env.DEV_AUTH_ENABLED === "true") {
    throw new AppError(500, "UNSAFE_AUTH_CONFIGURATION", "正式环境禁止使用开发身份");
  }
  isDingTalkMockEnabled();
}
