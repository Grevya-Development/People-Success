"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Bell } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { getNotificationsAction, markNotificationsReadAction } from "@/app/(app)/shell-actions";
import type { NotificationItem } from "@/server/services/notifications";
import { RelativeTime } from "@/components/relative-time";

const POLL_MS = 60_000;

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [pending, start] = useTransition();

  const load = useCallback(() => {
    start(async () => {
      const res = await getNotificationsAction({});
      if (res.ok) {
        setItems(res.data.items);
        setUnread(res.data.unread);
      }
    });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const markAll = () =>
    start(async () => {
      const res = await markNotificationsReadAction({ ids: "all" });
      if (res.ok) {
        setUnread(0);
        setItems((list) => list?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
      }
    });

  const markOne = (id: string) => {
    setItems((list) => list?.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) ?? null);
    setUnread((u) => Math.max(0, u - 1));
    void markNotificationsReadAction({ ids: [id] });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) load();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative text-muted-foreground" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="size-4" />
          {unread ? (
            <span className="absolute top-1 right-1 flex size-2 rounded-full bg-grevya-orange ring-2 ring-background" />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unread ? (
            <Button variant="ghost" size="xs" onClick={markAll} disabled={pending}>
              Mark all read
            </Button>
          ) : null}
        </div>
        <ScrollArea className="max-h-[420px]">
          {items === null ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">You are all caught up.</p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const body = (
                  <div className="flex gap-3 px-4 py-3">
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand")} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm", n.readAt ? "text-muted-foreground" : "font-medium")}>{n.title}</p>
                      {n.body ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p> : null}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        <RelativeTime value={n.createdAt} />
                      </p>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id} className="hover:bg-muted/60">
                    {n.href ? (
                      <Link href={n.href} onClick={() => { if (!n.readAt) markOne(n.id); setOpen(false); }}>
                        {body}
                      </Link>
                    ) : (
                      <button type="button" className="w-full text-left" onClick={() => !n.readAt && markOne(n.id)}>
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
