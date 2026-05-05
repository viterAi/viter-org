'use client';

import { useState, useTransition } from 'react';
import { pairNewDevice, type PairResult } from './actions';

export function PairButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [result, setResult] = useState<PairResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!name.trim()) return;
    startTransition(async () => {
      const res = await pairNewDevice(name.trim());
      setResult(res);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + Pair new WhatsApp device
        </button>
      )}

      {open && !result && (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Device label
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mordechai personal phone"
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={pending || !name.trim()}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pending ? 'Asking GOWA…' : 'Generate QR'}
            </button>
            <button
              onClick={() => { setOpen(false); setName(''); setResult(null); }}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && result.ok && result.qr && (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Open WhatsApp on your phone → <strong>Settings → Linked Devices → Link a Device</strong>, then scan this QR:
          </p>
          {result.qr.startsWith('data:image') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={result.qr} alt="WhatsApp pair QR" className="rounded-md border border-zinc-200 dark:border-zinc-800" />
          ) : (
            <pre className="rounded-md bg-zinc-100 p-3 text-xs dark:bg-zinc-950">{result.qr}</pre>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Device id: <code className="font-mono">{result.device_id}</code>
            <br />
            QR expires in 60s. After scanning, refresh this page to confirm linked status.
          </p>
          <button
            onClick={() => { setOpen(false); setName(''); setResult(null); }}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700"
          >
            Done
          </button>
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {result.error}
          <button
            onClick={() => setResult(null)}
            className="ml-2 underline"
          >
            try again
          </button>
        </div>
      )}
    </div>
  );
}
