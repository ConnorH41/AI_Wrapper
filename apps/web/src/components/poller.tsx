"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const ACTIVE = new Set(["draft", "scripting", "stills", "rendering"]);

export function Poller({ status }: { status: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!ACTIVE.has(status)) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router, status]);

  return null;
}
