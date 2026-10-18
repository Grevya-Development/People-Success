import Link from "next/link";
import { cn } from "cn";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";

/** Tints of the four Grevya brand hues, with AA-contrast initials in both themes. */
const HUES = [
  "bg-[#fde6df] text-[#a63414] dark:bg-[#4a1f12] dark:text-[#ffb8a3]",
  "bg-[#fff1cc] text-[#7a5600] dark:bg-[#43340a] dark:text-[#ffd97a]",
  "bg-[#ecf5d9] text-[#476800] dark:bg-[#2c3a0e] dark:text-[#c8e88a]",
  "bg-[#dcf0fb] text-[#035f8c] dark:bg-[#0c3348] dark:text-[#9ed8f7]",
];

/** Stable, brand-tinted avatar colour per person. */
function hueFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export function PersonAvatar({ name, id, className }: { name: string; id: string; className?: string }) {
  return (
    <Avatar className={cn("size-8", className)}>
      <AvatarFallback className={cn("text-[11px] font-semibold", hueFor(id))}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

export function PersonCell({ id, name, subtitle, href }: { id: string; name: string; subtitle?: string | null; href?: string }) {
  const body = (
    <span className="flex min-w-0 items-center gap-2.5">
      <PersonAvatar id={id} name={name} />
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground">{name}</span>
        {subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
      </span>
    </span>
  );
  return href ? (
    <Link href={href} className="rounded focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}
