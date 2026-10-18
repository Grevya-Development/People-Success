"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { formatDateTime } from "@/lib/format";

/**
 * "3 minutes ago". The server and browser render at different instants, so the
 * text is allowed to differ during hydration (otherwise React discards the
 * tree and can drop the user's first click). Hover shows the exact time.
 */
export function RelativeTime({ value, suffix = true, className }: { value: string | Date; suffix?: boolean; className?: string }) {
  const date = new Date(value);
  return (
    <time dateTime={date.toISOString()} title={formatDateTime(date)} className={className} suppressHydrationWarning>
      {formatDistanceToNowStrict(date, { addSuffix: suffix })}
    </time>
  );
}
