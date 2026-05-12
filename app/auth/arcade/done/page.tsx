"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function DoneInner() {
  const params = useSearchParams();
  const authId = params.get("auth_id") ?? "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "arcade_auth_done", auth_id: authId }, window.location.origin);
    }
    window.close();
  }, [authId]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        background: "var(--bg-primary, #fff)",
        color: "var(--ink-primary, #111)",
      }}
    >
      <p style={{ fontSize: 14, color: "var(--ink-secondary, #666)" }}>Connected — you can close this window.</p>
    </div>
  );
}

export default function ArcadeAuthDonePage() {
  return (
    <Suspense>
      <DoneInner />
    </Suspense>
  );
}
