import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

/** Breadcrumb target: runs and periods are listed on the payroll overview. */
export default function Page() {
  return (
    <Suspense>
      <Go />
    </Suspense>
  );
}

async function Go(): Promise<null> {
  await connection();
  redirect("/payroll");
}
