"use client";

import { useState, useTransition } from "react";
import { LogIn, LogOut, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { punchAction } from "../actions";
import { VERIFICATION } from "./status";

type Coords = { latitude: number; longitude: number; accuracyMeters: number };

function locate(): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracyMeters: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

/**
 * Check-in / check-out. When the employee's office has a geofence the
 * browser location is sent so the server can verify it; otherwise the punch
 * is honestly recorded as self-reported.
 */
export function PunchButton({ nextKind, geofence, requireGeofence }: { nextKind: "in" | "out"; geofence: { locationName: string; radiusMeters: number } | null; requireGeofence: boolean }) {
  const [pending, start] = useTransition();
  const [locating, setLocating] = useState(false);
  const busy = pending || locating;

  const run = () =>
    start(async () => {
      let coords: Coords | null = null;
      if (geofence) {
        setLocating(true);
        coords = await locate();
        setLocating(false);
        if (!coords && requireGeofence) {
          toast.error("Allow location access in your browser to check in at this office.");
          return;
        }
      }
      const res = await punchAction({ kind: nextKind, ...(coords ?? {}) });
      if (res.ok) {
        const v = VERIFICATION[res.data.verification]?.label ?? res.data.verification;
        toast.success(`Checked ${nextKind} · ${v}`);
      } else toast.error(res.error.message);
    });

  return (
    <div className="flex flex-col items-start gap-2">
      <Button size="lg" onClick={run} disabled={busy} variant={nextKind === "in" ? "default" : "outline"}>
        {busy ? <Spinner /> : nextKind === "in" ? <LogIn /> : <LogOut />}
        {locating ? "Checking location…" : nextKind === "in" ? "Check in" : "Check out"}
      </Button>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {geofence ? (
          <>
            <MapPin className="size-3.5" />
            Location is checked against {geofence.locationName} ({geofence.radiusMeters} m). Outside it, the punch is {requireGeofence ? "refused" : "recorded as self-reported"}.
          </>
        ) : (
          "Recorded as self-reported (no office geofence is set up for your location)."
        )}
      </p>
    </div>
  );
}
