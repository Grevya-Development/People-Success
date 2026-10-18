"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FormError } from "@/components/forms/fields";
import { respondToOfferAction } from "../actions";

export function ResponseForm({ token }: { token: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState<"accept" | "decline" | "">("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!decision || !confirm) return;
        setError(undefined);
        start(async () => {
          const r = await respondToOfferAction({ token, decision, note: note.trim() || null, confirm: true });
          if (r.ok) router.refresh();
          else setError(r.error.message);
        });
      }}
    >
      <FormError message={error} />
      <RadioGroup value={decision} onValueChange={(v) => setDecision(v as "accept" | "decline")} className="grid gap-2 sm:grid-cols-2" aria-label="Your decision">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm has-[[data-state=checked]]:border-foreground">
          <RadioGroupItem value="accept" /> Accept the offer
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm has-[[data-state=checked]]:border-foreground">
          <RadioGroupItem value="decline" /> Decline the offer
        </label>
      </RadioGroup>
      <Field>
        <FieldLabel htmlFor="offer-note">Note to the recruiter (optional)</FieldLabel>
        <Textarea id="offer-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>
      {decision ? (
        <Field orientation="horizontal">
          <Checkbox id="offer-confirm" checked={confirm} onCheckedChange={(v) => setConfirm(v === true)} />
          <FieldLabel htmlFor="offer-confirm" className="font-normal leading-relaxed">
            {decision === "accept"
              ? "I accept this offer on the terms above and in the offer letter. I understand this is recorded as an electronic click-through acceptance with the date, time and my IP address; it is not an electronic signature."
              : "I decline this offer. I understand this cannot be undone from this page."}
          </FieldLabel>
        </Field>
      ) : null}
      <Button type="submit" disabled={pending || !decision || !confirm} variant={decision === "decline" ? "destructive" : "default"}>
        {pending ? <Spinner /> : null}
        {decision === "decline" ? "Decline offer" : "Accept offer"}
      </Button>
    </form>
  );
}
