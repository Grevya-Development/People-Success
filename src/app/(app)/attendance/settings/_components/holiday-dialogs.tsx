"use client";

import { useTransition } from "react";
import { Copy, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, SwitchField, TextField } from "@/components/forms/fields";
import { copyCalendarSchema, holidayCalendarSchema, holidaySchema } from "@/lib/validation/time";
import { assignCalendarAction, copyHolidayCalendarAction, saveHolidayAction, saveHolidayCalendarAction } from "../../actions";

type CalendarValues = z.output<typeof holidayCalendarSchema>;
type HolidayValues = z.output<typeof holidaySchema>;

export function HolidayCalendarDialog({ values }: { values?: CalendarValues }) {
  const editing = !!values?.id;
  return (
    <FormDialog
      trigger={
        editing ? (
          <Button variant="ghost" size="sm">
            <Pencil /> Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> New calendar
          </Button>
        )
      }
      title={editing ? `Edit ${values?.name}` : "New holiday calendar"}
      description="One calendar per year. Assign it to locations; locations without one use the year's default calendar."
      schema={holidayCalendarSchema}
      defaultValues={values ?? { name: "", year: new Date().getFullYear(), isDefault: false }}
      action={saveHolidayCalendarAction}
      successMessage={editing ? "Calendar updated" : "Calendar created"}
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <TextField control={form.control} name="name" label="Name" required placeholder="Karnataka holidays" />
            <TextField control={form.control} name="year" label="Year" required inputMode="numeric" />
          </div>
          <SwitchField control={form.control} name="isDefault" label="Default for the year" description="Used for locations that have no calendar assigned." />
        </>
      )}
    </FormDialog>
  );
}

export function CopyCalendarDialog({ calendarId, name, year }: { calendarId: string; name: string; year: number }) {
  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="sm">
          <Copy /> Copy
        </Button>
      }
      title={`Copy ${name} to another year`}
      description="Copies every holiday onto the same day and month. Review the dates afterwards: festivals that follow the lunar calendar move every year."
      schema={copyCalendarSchema}
      defaultValues={{ calendarId, year: year + 1 }}
      action={copyHolidayCalendarAction}
      submitLabel="Copy"
      successMessage="Calendar copied"
    >
      {(form) => <TextField control={form.control} name="year" label="Target year" required inputMode="numeric" />}
    </FormDialog>
  );
}

export function HolidayDialog({ calendarId, year, values }: { calendarId: string; year: number; values?: HolidayValues }) {
  const editing = !!values?.id;
  return (
    <FormDialog
      trigger={
        editing ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${values?.name}`}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> Add holiday
          </Button>
        )
      }
      title={editing ? `Edit ${values?.name}` : "Add holiday"}
      description="Public holidays are days off for everyone on this calendar. Restricted holidays are optional and are not days off automatically."
      schema={holidaySchema}
      defaultValues={values ?? { calendarId, date: `${year}-01-26`, name: "", type: "public" }}
      action={saveHolidayAction}
      successMessage={editing ? "Holiday updated" : "Holiday added"}
    >
      {(form) => (
        <>
          <TextField control={form.control} name="name" label="Name" required placeholder="Republic Day" />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={form.control} name="date" label="Date" type="date" required />
            <SelectField
              control={form.control}
              name="type"
              label="Type"
              options={[
                { value: "public", label: "Public (day off)" },
                { value: "restricted", label: "Restricted (optional)" },
              ]}
            />
          </div>
        </>
      )}
    </FormDialog>
  );
}

const NONE = "__default__";

/** Inline calendar assignment for a location. */
export function LocationCalendarSelect({ locationId, value, calendars }: { locationId: string; value: string | null; calendars: { id: string; label: string }[] }) {
  const [pending, start] = useTransition();
  return (
    <Select
      value={value ?? NONE}
      disabled={pending}
      onValueChange={(v) =>
        start(async () => {
          const res = await assignCalendarAction({ locationId, calendarId: v === NONE ? null : v });
          if (res.ok) toast.success("Holiday calendar updated");
          else toast.error(res.error.message);
        })
      }
    >
      <SelectTrigger className="h-8 w-60" aria-label="Holiday calendar">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Year&apos;s default calendar</SelectItem>
        {calendars.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
