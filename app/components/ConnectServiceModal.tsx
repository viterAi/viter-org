"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { REPO_KEY } from "@/lib/genui/repo-key";

type Provider = "github" | "google" | "microsoft";

interface Repo {
  full_name: string;
  description: string;
  private: boolean;
}

interface Mailbox {
  id: string;
  label: string;
  email: string;
}

type Step = "pick" | "auth" | "pick-target" | "confirm" | "done";

interface ConnectServiceModalProps {
  onClose: () => void;
  onConnected: () => void;
}

const SERVICES: { id: Provider; label: string; source: string; icon: string; hint: string }[] = [
  {
    id: "github",
    label: "GitHub",
    source: "github",
    icon: "GH",
    hint: "Ingest commits, PRs, and issues via webhook",
  },
  {
    id: "google",
    label: "Gmail",
    source: "gmail",
    icon: "GM",
    hint: "Ingest incoming email every 5 min",
  },
  {
    id: "microsoft",
    label: "Outlook",
    source: "outlook",
    icon: "OL",
    hint: "Ingest incoming email every 5 min",
  },
];

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  zIndex: 200,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const sheet: React.CSSProperties = {
  background: "var(--bg-surface)",
  borderRadius: "var(--r-zone)",
  border: "0.5px solid var(--line-thin)",
  boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
  width: 480,
  maxWidth: "calc(100vw - 32px)",
  maxHeight: "80vh",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const modalHeader: React.CSSProperties = {
  padding: "20px 20px 0",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
};

const body: React.CSSProperties = {
  padding: "16px 20px 20px",
  flex: 1,
  overflowY: "auto",
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 18px",
  fontSize: 13,
  fontWeight: 600,
  borderRadius: "var(--r-card)",
  border: "none",
  cursor: "pointer",
  background: "var(--good)",
  color: "#fff",
};

const btnGhost: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 13,
  borderRadius: "var(--r-card)",
  border: "0.5px solid var(--line-strong)",
  background: "transparent",
  color: "var(--ink-secondary)",
  cursor: "pointer",
};

export function ConnectServiceModal({ onClose, onConnected }: ConnectServiceModalProps) {
  const [step, setStep] = useState<Step>("pick");
  const [selectedService, setSelectedService] = useState<(typeof SERVICES)[0] | null>(null);
  const [authId, setAuthId] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [manualRepoSlug, setManualRepoSlug] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<string>("");
  const [selectedTargetMeta, setSelectedTargetMeta] = useState<{ description?: string; email?: string } | null>(null);
  const [agentGoal, setAgentGoal] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [manualWebhookSecret, setManualWebhookSecret] = useState("");
  const [webhookUrl, setWebhookUrl] = useState<string>("");
  const [installFailed, setInstallFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearError = () => setError(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function startPolling(service: (typeof SERVICES)[0], id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/auth/arcade/status?auth_id=${encodeURIComponent(id)}`, {
            credentials: "include",
          });
          const j = await res.json().catch(() => ({})) as { status?: string };
          if (j.status === "completed") {
            if (pollRef.current) clearInterval(pollRef.current);
            if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
            await fetchTargets(service, id);
          }
        } catch {
          // ignore transient errors — keep polling
        }
      })();
    }, 2000);
  }

  const fetchTargets = useCallback(async (service: (typeof SERVICES)[0], id: string) => {
    setStep("pick-target");
    setBusy(true);
    clearError();
    try {
      if (service.id === "github") {
        setManualRepoSlug("");
        const res = await fetch(`/api/auth/arcade/repos?auth_id=${encodeURIComponent(id)}`, {
          credentials: "include",
        });
        const j = await res.json().catch(() => ({})) as { repos?: Repo[]; error?: string };
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        setRepos(j.repos ?? []);
      } else {
        const res = await fetch(
          `/api/auth/arcade/mailboxes?auth_id=${encodeURIComponent(id)}&provider=${service.id}`,
          { credentials: "include" },
        );
        const j = await res.json().catch(() => ({})) as { mailboxes?: Mailbox[]; error?: string };
        if (!res.ok) throw new Error(j.error ?? res.statusText);
        setMailboxes(j.mailboxes ?? []);
        if (j.mailboxes?.length === 1) {
          const mb = j.mailboxes[0];
          setSelectedTarget(mb.id);
          setSelectedTargetMeta({ email: mb.email });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  async function startAuth(service: (typeof SERVICES)[0]) {
    setSelectedService(service);
    setStep("auth");
    clearError();

    // Open a blank popup immediately — must happen synchronously inside the click handler
    // so the browser treats it as user-initiated (avoids popup blocker).
    const popup = window.open("about:blank", "_blank", "width=600,height=700");
    popupRef.current = popup;
    if (!popup) {
      setError("Popup was blocked. Allow popups for this site, then try again.");
      setStep("pick");
      return;
    }

    try {
      const res = await fetch("/api/auth/arcade/start", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: service.id }),
      });
      const j = await res.json().catch(() => ({})) as {
        status?: string;
        auth_url?: string;
        auth_id?: string;
        error?: string;
      };
      if (!res.ok) {
        popup.close();
        throw new Error(j.error ?? res.statusText);
      }

      if (j.status === "already_authorized" && j.auth_id) {
        popup.close();
        setAuthId(j.auth_id);
        await fetchTargets(service, j.auth_id);
        return;
      }

      if (j.auth_url && j.auth_id) {
        setAuthId(j.auth_id);
        // Navigate the already-open popup to the real auth URL
        popup.location.href = j.auth_url;
        startPolling(service, j.auth_id);
      }
    } catch (e) {
      popup.close();
      setError(e instanceof Error ? e.message : String(e));
      setStep("pick");
    }
  }

  function selectRepo(repo: Repo) {
    setSelectedTarget(repo.full_name);
    setSelectedTargetMeta({ description: repo.description });
    const defaultGoal = repo.description
      ? `Summarize activity from ${repo.full_name}. ${repo.description}`
      : `Summarize commits, PRs, and issues from ${repo.full_name}.`;
    setAgentGoal(defaultGoal);
    setManualRepoSlug("");
    setStep("confirm");
  }

  function applyManualRepoSlug() {
    let s = manualRepoSlug.trim().toLowerCase();
    s = s.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/^\/+/, "");
    if (!REPO_KEY.test(s)) {
      setError("Use owner/repo (e.g. myorg/my-repo).");
      return;
    }
    clearError();
    selectRepo({ full_name: s, description: "", private: false });
  }

  function selectMailbox(mb: Mailbox) {
    setSelectedTarget(mb.id);
    setSelectedTargetMeta({ email: mb.email });
    const source = selectedService?.source ?? "email";
    setAgentGoal(`Summarize incoming emails to ${mb.email} and flag anything requiring a response.`);
    void source; // used in connect
    setStep("confirm");
  }

  async function connect() {
    if (!selectedService || !selectedTarget || !authId) return;
    setBusy(true);
    clearError();
    const isGithub = selectedService.id === "github";
    const manualSecret = manualWebhookSecret.trim();
    try {
      const res = await fetch("/api/genui/channels", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: selectedService.source,
          external_key: selectedTarget,
          agent_prompt: agentGoal,
          auth_id: authId,
          ...(isGithub && manualSecret ? { webhook_secret: manualSecret } : {}),
        }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string; code?: string };
      if (!res.ok) {
        if (isGithub && j.code === "webhook_install_failed") {
          setInstallFailed(true);
          setShowAdvanced(true);
          // Fetch the webhook URL the user needs to paste into GitHub.
          try {
            const cfg = await fetch("/api/genui/config", { credentials: "include" });
            const cj = await cfg.json().catch(() => ({})) as { webhookUrl?: string };
            if (cj.webhookUrl) setWebhookUrl(cj.webhookUrl);
          } catch { /* non-fatal */ }
        }
        throw new Error(j.error ?? res.statusText);
      }
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleDone() {
    onConnected();
    onClose();
  }

  const filteredRepos = repos.filter((r) => r.full_name.toLowerCase().includes(repoSearch.toLowerCase()));

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-tertiary)" }}>
              {step === "pick" && "Connect a service"}
              {step === "auth" && `Connecting ${selectedService?.label ?? ""}…`}
              {step === "pick-target" && (selectedService?.id === "github" ? "Select a repository" : "Select a mailbox")}
              {step === "confirm" && "Review & connect"}
              {step === "done" && "Connected"}
            </p>
          </div>
          <button onClick={onClose} style={{ ...btnGhost, padding: "4px 10px", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        <div style={body}>
          {error && (
            <p style={{ fontSize: 12, color: "var(--danger)", marginBottom: 14, padding: "8px 12px", background: "var(--danger-tint, #fff0f0)", borderRadius: "var(--r-card)" }}>
              {error}
            </p>
          )}

          {/* Step: pick */}
          {step === "pick" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {SERVICES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => void startAuth(s)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 16px",
                    borderRadius: "var(--r-card)",
                    border: "0.5px solid var(--line-strong)",
                    background: "var(--bg-secondary)",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: "var(--bg-surface)",
                    border: "0.5px solid var(--line-thin)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--ink-secondary)",
                    flexShrink: 0,
                  }}>
                    {s.icon}
                  </span>
                  <span>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--ink-primary)" }}>{s.label}</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--ink-tertiary)", marginTop: 2 }}>{s.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Step: auth */}
          {step === "auth" && (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
              <p style={{ fontSize: 14, color: "var(--ink-secondary)", margin: "0 0 8px" }}>
                A login window has opened. Sign in to {selectedService?.label} and authorize access.
              </p>
              <p style={{ fontSize: 12, color: "var(--ink-tertiary)", margin: 0 }}>
                This window will advance automatically once authorized.
              </p>
              <button
                onClick={() => {
                  if (pollRef.current) clearInterval(pollRef.current);
                  popupRef.current?.close();
                  setStep("pick");
                }}
                style={{ ...btnGhost, marginTop: 20, fontSize: 12 }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Step: pick-target (repos) */}
          {step === "pick-target" && selectedService?.id === "github" && (
            <div>
              {busy ? (
                <p style={{ fontSize: 13, color: "var(--ink-tertiary)" }}>Loading repositories…</p>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: "var(--ink-tertiary)", margin: "0 0 10px", lineHeight: 1.45 }}>
                    Includes your repos, collaborations, and <strong style={{ fontWeight: 600 }}>organization</strong> repos you can access (up to 500, newest first).
                  </p>
                  <input
                    autoFocus
                    placeholder="Search repositories…"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "9px 12px",
                      fontSize: 13,
                      borderRadius: "var(--r-card)",
                      border: "0.5px solid var(--line-strong)",
                      background: "var(--bg-surface)",
                      color: "var(--ink-primary)",
                      marginBottom: 12,
                    }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                    {filteredRepos.length === 0 && (
                      <p style={{ fontSize: 13, color: "var(--ink-tertiary)" }}>No repositories match your search.</p>
                    )}
                    {filteredRepos.map((r) => (
                      <button
                        key={r.full_name}
                        onClick={() => selectRepo(r)}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 2,
                          padding: "10px 12px",
                          borderRadius: "var(--r-card)",
                          border: "0.5px solid var(--line-thin)",
                          background: "var(--bg-secondary)",
                          cursor: "pointer",
                          textAlign: "left",
                          width: "100%",
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-primary)", fontFamily: "ui-monospace, monospace" }}>{r.full_name}</span>
                        {r.description && (
                          <span style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>{r.description}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: "0.5px solid var(--line-thin)" }}>
                    <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-tertiary)", margin: "0 0 8px" }}>
                      Not in the list?
                    </p>
                    <p style={{ fontSize: 12, color: "var(--ink-tertiary)", margin: "0 0 8px", lineHeight: 1.45 }}>
                      Paste <span style={{ fontFamily: "ui-monospace, monospace" }}>org/repo</span> or a GitHub URL. You still need access to install the webhook.
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        placeholder="myorg/my-repo"
                        value={manualRepoSlug}
                        onChange={(e) => setManualRepoSlug(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") applyManualRepoSlug(); }}
                        style={{
                          flex: 1,
                          boxSizing: "border-box",
                          padding: "9px 12px",
                          fontSize: 13,
                          borderRadius: "var(--r-card)",
                          border: "0.5px solid var(--line-strong)",
                          background: "var(--bg-surface)",
                          color: "var(--ink-primary)",
                          fontFamily: "ui-monospace, monospace",
                        }}
                      />
                      <button type="button" onClick={applyManualRepoSlug} style={btnGhost}>
                        Use repo
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step: pick-target (mailboxes) */}
          {step === "pick-target" && selectedService?.id !== "github" && (
            <div>
              {busy ? (
                <p style={{ fontSize: 13, color: "var(--ink-tertiary)" }}>Loading mailbox…</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {mailboxes.map((mb) => (
                    <button
                      key={mb.id}
                      onClick={() => selectMailbox(mb)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 2,
                        padding: "12px 14px",
                        borderRadius: "var(--r-card)",
                        border: "0.5px solid var(--line-thin)",
                        background: "var(--bg-secondary)",
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-primary)" }}>{mb.label}</span>
                      {mb.email !== mb.label && (
                        <span style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>{mb.email}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step: confirm */}
          {step === "confirm" && selectedService && (
            <div>
              <div style={{
                padding: "12px 14px",
                borderRadius: "var(--r-card)",
                border: "0.5px solid var(--line-thin)",
                background: "var(--bg-secondary)",
                marginBottom: 16,
              }}>
                <p style={{ margin: 0, fontSize: 12, color: "var(--ink-tertiary)" }}>{selectedService.label}</p>
                <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 600, color: "var(--ink-primary)", fontFamily: selectedService.id === "github" ? "ui-monospace, monospace" : undefined }}>
                  {selectedTarget}
                </p>
              </div>

              <div style={{ marginBottom: 16 }}>
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  style={{ ...btnGhost, fontSize: 12, padding: "5px 10px", marginBottom: showAdvanced ? 10 : 0 }}
                >
                  {showAdvanced ? "▾ Advanced" : "▸ Advanced"}
                </button>
                {showAdvanced && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-tertiary)", margin: "0 0 6px" }}>
                        Agent goal
                      </p>
                      <textarea
                        rows={4}
                        value={agentGoal}
                        onChange={(e) => setAgentGoal(e.target.value)}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          padding: "9px 12px",
                          fontSize: 13,
                          borderRadius: "var(--r-card)",
                          border: "0.5px solid var(--line-strong)",
                          background: "var(--bg-surface)",
                          color: "var(--ink-primary)",
                          resize: "vertical",
                          minHeight: 80,
                        }}
                      />
                    </div>

                    {selectedService.id === "github" && (
                      <div style={{ borderTop: "0.5px solid var(--line-thin)", paddingTop: 12 }}>
                        <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-tertiary)", margin: "0 0 6px" }}>
                          Webhook signing secret (manual install)
                        </p>
                        <p style={{ fontSize: 12, color: "var(--ink-tertiary)", margin: "0 0 8px", lineHeight: 1.5 }}>
                          {installFailed
                            ? "Auto-install failed (org SSO, missing admin permission, or a non-public app URL). You can still connect by adding the webhook in GitHub manually:"
                            : "Optional fallback if auto-install fails (org SSO / no admin / private app URL). Add a webhook in GitHub manually:"}
                        </p>
                        <ol style={{ fontSize: 12, color: "var(--ink-secondary)", margin: "0 0 8px 18px", padding: 0, lineHeight: 1.55 }}>
                          <li>
                            Open <code style={{ fontFamily: "ui-monospace, monospace" }}>github.com/{selectedTarget}/settings/hooks/new</code>
                          </li>
                          <li>
                            Paste this Payload URL: {webhookUrl ? (
                              <code style={{ fontFamily: "ui-monospace, monospace", background: "var(--bg-secondary)", padding: "1px 4px", borderRadius: 3 }}>
                                {webhookUrl}?t=&lt;tenant-id&gt;
                              </code>
                            ) : (
                              <em>(saving will reveal the exact URL)</em>
                            )}
                          </li>
                          <li>Content type: <code>application/json</code>. Generate a random secret, paste it here:</li>
                        </ol>
                        <input
                          type="text"
                          placeholder="webhook signing secret (≥ 8 chars)"
                          value={manualWebhookSecret}
                          onChange={(e) => setManualWebhookSecret(e.target.value)}
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            padding: "9px 12px",
                            fontSize: 13,
                            borderRadius: "var(--r-card)",
                            border: "0.5px solid var(--line-strong)",
                            background: "var(--bg-surface)",
                            color: "var(--ink-primary)",
                            fontFamily: "ui-monospace, monospace",
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => void connect()}
                  disabled={busy || !agentGoal.trim()}
                  style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? "Connecting…" : "Connect"}
                </button>
                <button onClick={() => setStep("pick-target")} style={btnGhost}>Back</button>
              </div>
            </div>
          )}

          {/* Step: done */}
          {step === "done" && selectedService && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
              <p style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-primary)", margin: "0 0 6px" }}>
                {selectedTarget} connected
              </p>
              <p style={{ fontSize: 13, color: "var(--ink-secondary)", margin: "0 0 20px" }}>
                {selectedService.id === "github"
                  ? "Webhook installed. Events will be synthesized as they arrive."
                  : `Inbox will be polled every 5 minutes.`}
              </p>
              <button onClick={handleDone} style={btnPrimary}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
