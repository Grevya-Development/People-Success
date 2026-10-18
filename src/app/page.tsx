import { redirect } from "next/navigation";

// The proxy normally handles "/", this is a fallback.
export default function Home() {
  redirect("/overview");
}
