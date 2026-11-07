import path from "node:path";
import { AppError } from "./http.js";

function required(name) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new AppError(500, "CONFIG_MISSING", `服务缺少必要配置：${name}`);
  }
  return value;
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(500, "CONFIG_INVALID", `${name} 必须是正整数`);
  }
  return value;
}

function correctionBasePath() {
  const configured =
    process.env.NEXT_PUBLIC_CORRECTION_BASE_PATH ||
    "/ticket-correction-console";
  if (configured === "/") return "/";
  return `/${configured.replace(/^\/+|\/+$/g, "")}`;
}

function secureCookieSetting() {
  const configured = process.env.CORRECTION_COOKIE_SECURE;
  if (
    configured !== undefined &&
    configured !== "true" &&
    configured !== "false"
  ) {
    throw new AppError(
      500,
      "CONFIG_INVALID",
      "CORRECTION_COOKIE_SECURE 必须为 true 或 false"
    );
  }
  if (process.env.NODE_ENV === "production" && configured !== "true") {
    throw new AppError(
      500,
      "CONFIG_INVALID",
      "生产环境必须设置 CORRECTION_COOKIE_SECURE=true"
    );
  }
  return configured === "true";
}

export function authConfig() {
  const sessionSecret = required("CORRECTION_SESSION_SECRET");
  if (Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new AppError(500, "CONFIG_INVALID", "CORRECTION_SESSION_SECRET 长度不足");
  }

  return {
    username: required("CORRECTION_USERNAME"),
    passwordHash: required("CORRECTION_PASSWORD_HASH").replaceAll("\\$", "$"),
    sessionSecret,
    sessionTtlMinutes: positiveInteger("CORRECTION_SESSION_TTL_MINUTES", 120),
    secureCookie: secureCookieSetting(),
    cookiePath: correctionBasePath()
  };
}

export function auditConfig() {
  const secret = required("CORRECTION_AUDIT_SECRET");
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new AppError(500, "CONFIG_INVALID", "CORRECTION_AUDIT_SECRET 长度不足");
  }

  const configuredPath = process.env.CORRECTION_AUDIT_PATH || "./var/audit/corrections.jsonl";
  const projectRoot = process.env.CORRECTION_PROJECT_ROOT || process.cwd();
  return {
    path: path.resolve(projectRoot, configuredPath),
    secret
  };
}
