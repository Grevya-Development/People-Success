import { differenceInCalendarDays, parseISO } from "date-fns";

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short type label from a MIME type, e.g. "PDF", "PNG", "Word". */
export function fileKind(mime: string) {
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return mime.slice(6).toUpperCase().replace("JPEG", "JPG");
  if (mime.includes("wordprocessingml")) return "Word";
  if (mime.includes("spreadsheetml")) return "Excel";
  if (mime === "text/csv") return "CSV";
  if (mime === "text/markdown") return "Markdown";
  return "Text";
}

export type ExpiryState = { tone: "danger" | "warning" | "neutral"; label: string } | null;

/** Expired = danger, under 30 days = warning. `today` is yyyy-MM-dd in the tenant's timezone. */
export function expiryState(expiresOn: string | null, today: string): ExpiryState {
  if (!expiresOn) return null;
  const days = differenceInCalendarDays(parseISO(expiresOn), parseISO(today));
  if (days < 0) return { tone: "danger", label: days === -1 ? "Expired yesterday" : `Expired ${-days} days ago` };
  if (days === 0) return { tone: "danger", label: "Expires today" };
  if (days < 30) return { tone: "warning", label: days === 1 ? "Expires tomorrow" : `Expires in ${days} days` };
  return { tone: "neutral", label: "Valid" };
}
