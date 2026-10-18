import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

/** Breadcrumb target: this section lives in a tab of its parent page. */
export default function Page() {
  return (
    <Suspense>
      <Go />
    </Suspense>
  );
}

async function Go(): Promise<null> {
  await connection();
  redirect("/attendance/settings?tab=holidays");
}
