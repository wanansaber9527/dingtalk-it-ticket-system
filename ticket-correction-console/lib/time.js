const SHANGHAI_OFFSET = "+08:00";
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function isValidLocalDateTime(match) {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);

  if (
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return false;
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

export function parseShanghaiDateTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = typeof value === "string" ? LOCAL_DATE_TIME_PATTERN.exec(value) : null;
  if (!match || !isValidLocalDateTime(match)) {
    throw new Error("时间格式无效");
  }

  const withSeconds = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${withSeconds}${SHANGHAI_OFFSET}`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("时间格式无效");
  }
  return date;
}

export function toShanghaiInputValue(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 23);
}

export function formatShanghai(value) {
  if (!value) return "未设置";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "时间无效";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

export function sameInstant(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return new Date(left).getTime() === new Date(right).getTime();
}
