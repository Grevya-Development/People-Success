"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Monthly summary CSV download (the route checks permission and audits the export). */
export function ExportLink({ month }: { month: string }) {
  const [m, setM] = useState(month);
  return (
    <div className="flex items-center gap-2">
      <Input type="month" value={m} onChange={(e) => setM(e.target.value)} className="h-8 w-auto" aria-label="Month to export" />
      <Button variant="outline" size="sm" asChild>
        <a href={`/attendance/export?month=${m}`} download>
          <Download /> Export CSV
        </a>
      </Button>
    </div>
  );
}
