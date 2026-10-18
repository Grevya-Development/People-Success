import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { NoAccess, PageHeader, Reveal } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { can, requireContext } from "@/server/auth/context";
import { getRole, permissionGroups } from "@/server/services/settings/roles";
import { AppError } from "@/server/lib/errors";
import { RoleEditor } from "./role-editor";

export const metadata: Metadata = { title: "Edit role" };

export default function RolePage({ params }: PageProps<"/settings/roles/[id]">) {
  return (
    <>
      <Link href="/settings/roles" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Roles
      </Link>
      <Suspense fallback={<EditorSkeleton />}>
        <RoleData params={params} />
      </Suspense>
    </>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function RoleData({ params }: { params: PageProps<"/settings/roles/[id]">["params"] }) {
  const [ctx, { id }] = await Promise.all([requireContext(), params]);
  if (!can(ctx, "roles.manage", "all")) return <NoAccess />;
  if (!UUID.test(id)) return <NoAccess message="This role does not exist." />;
  let role: Awaited<ReturnType<typeof getRole>>;
  try {
    role = await getRole(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") return <NoAccess message="This role does not exist or was deleted." />;
    throw err;
  }
  return (
    <Reveal>
      <PageHeader
        title={role.name}
        eyebrow={role.isSystem ? "Built-in role" : "Custom role"}
        description={
          role.editable
            ? `${role.assignedCount} member${role.assignedCount === 1 ? "" : "s"} have this role. Changes apply to them immediately.`
            : "The Tenant Owner always has every permission. It cannot be edited."
        }
      />
      <RoleEditor
        role={{
          id: role.id,
          name: role.name,
          description: role.description ?? "",
          grants: role.grants,
          editable: role.editable,
          canRename: role.canRename,
        }}
        groups={permissionGroups()}
      />
    </Reveal>
  );
}

function EditorSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-32 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
