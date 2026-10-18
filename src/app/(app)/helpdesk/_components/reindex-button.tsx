"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useRunAction } from "@/components/documents/use-run-action";
import { reindexKnowledgeAction } from "../actions";

export function ReindexButton() {
  const { pending, run } = useRunAction();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        run(() => reindexKnowledgeAction({ force: false }), {
          success: (r) =>
            r.indexed || r.removed
              ? `Reindexed ${r.indexed} source(s), ${r.chunks} sections${r.removed ? `; removed ${r.removed} unpublished` : ""}`
              : `Index is up to date (${r.unchanged} source(s))`,
        })
      }
    >
      {pending ? <Spinner /> : <RefreshCw data-icon="inline-start" />} Reindex knowledge
    </Button>
  );
}
