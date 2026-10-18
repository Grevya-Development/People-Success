import Image from "next/image";
import Link from "next/link";
import { Wordmark } from "@/components/brand";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Link href="/login" className="w-fit rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <Wordmark />
        </Link>
        <main className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[360px] animate-enter">{children}</div>
        </main>
        <p className="text-xs text-muted-foreground">© Grevya. Employee data is encrypted in transit and at rest.</p>
      </div>
      <aside className="relative hidden overflow-hidden border-l bg-sidebar lg:block" aria-hidden>
        <Image
          src="/brand/grevya-mark.png"
          alt=""
          width={900}
          height={900}
          priority
          className="absolute -right-40 -bottom-40 size-[720px] opacity-[0.92]"
        />
        <div className="relative max-w-md p-14 pt-24">
          <p className="text-[28px] leading-tight font-semibold tracking-tight text-foreground text-balance">
            Hire, onboard, pay and grow your people from one record.
          </p>
          <p className="mt-4 text-[15px] text-muted-foreground">
            Recruitment, payroll, leave, performance and people success, connected by one employee database.
          </p>
        </div>
      </aside>
    </div>
  );
}
