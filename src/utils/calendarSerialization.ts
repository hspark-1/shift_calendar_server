export function formatDbDate(date: string | Date): string {
  return date instanceof Date ? date.toISOString().slice(0, 10) : String(date);
}

export function formatDbTime(
  time: string | null | undefined,
): string | null {
  if (!time) {
    return null;
  }

  const trimmed_time = String(time).trim();
  if (/^\d{2}:\d{2}$/.test(trimmed_time)) {
    return `${trimmed_time}:00`;
  }

  if (/^\d{2}:\d{2}:\d{2}/.test(trimmed_time)) {
    return trimmed_time.slice(0, 8);
  }

  return trimmed_time;
}

function colorNumberToArgbString(color: number): string {
  const unsigned_color = color >>> 0;
  return `#${unsigned_color.toString(16).toUpperCase().padStart(8, "0")}`;
}

export function formatShiftTypeColor(
  color: string | number | null | undefined,
): string | null {
  if (color === null || color === undefined) {
    return null;
  }

  if (typeof color === "number") {
    return colorNumberToArgbString(color);
  }

  const trimmed_color = color.trim();
  if (!trimmed_color) {
    return null;
  }

  let hex_color = trimmed_color.toUpperCase();
  if (hex_color.startsWith("#")) {
    hex_color = hex_color.slice(1);
  }

  if (/^[0-9A-F]{6}$/.test(hex_color)) {
    return `#FF${hex_color}`;
  }

  if (/^[0-9A-F]{8}$/.test(hex_color)) {
    return `#${hex_color}`;
  }

  if (/^\d+$/.test(trimmed_color)) {
    return colorNumberToArgbString(Number(trimmed_color));
  }

  return null;
}

export function toUtcIso(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
