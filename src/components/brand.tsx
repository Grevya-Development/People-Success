import Image from "next/image";
import { cn } from "cn";

export function BrandMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <Image
      src="/brand/grevya-mark.png"
      alt=""
      width={size}
      height={size}
      priority
      className={cn("shrink-0 select-none", className)}
    />
  );
}

/** "PeopleSuccess" wordmark with the Grevya mark. */
export function Wordmark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark size={size} />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-foreground">PeopleSuccess</span>
        <span className="mt-1 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">by Grevya</span>
      </span>
    </span>
  );
}
