"use client";

import { useActionState } from "react";
import {
  submitAuditPassword,
  type AuditLoginState,
} from "./actions";

const initialState: AuditLoginState = {};

export default function AuditLogin() {
  const [state, formAction, pending] = useActionState(
    submitAuditPassword,
    initialState,
  );

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          vita · /audit · restricted
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Viter Engineering Audit
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Private deliverable. Enter the access password to read.
        </p>

        <form action={formAction} className="mt-8 space-y-4">
          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              Password
            </span>
            <input
              name="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              required
              className="mt-2 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>

          {state.error && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            {pending ? "Checking…" : "Enter"}
          </button>
        </form>

        <p className="mt-10 text-xs text-zinc-500 dark:text-zinc-500">
          Access restricted to Mordechai and Shaul. Password rotates if
          compromised. Not for general distribution.
        </p>
      </div>
    </main>
  );
}
