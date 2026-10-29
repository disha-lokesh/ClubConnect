'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Props = { url: string; method?: 'POST' | 'DELETE' | 'PATCH' | 'PUT'; body?: unknown; label: string; variant?: 'primary' | 'danger' | 'good' | ''; confirm?: string; redirect?: string; small?: boolean; disabled?: boolean; title?: string };

export default function ApiButton({ url, method = 'POST', body, label, variant = '', confirm: confirmMsg, redirect, small, disabled, title }: Props) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(json.error ?? `Failed (${res.status})`); return; }
      if (redirect) router.push(redirect); router.refresh();
    } catch { setErr('Could not reach the server.'); } finally { setBusy(false); }
  }
  return (
    <span>
      <button type="button" className={`btn ${variant} ${small ? 'sm' : ''}`} onClick={go} disabled={busy || disabled} title={title}>{busy ? '…' : label}</button>
      {err && <span className="small" style={{ color: 'var(--bad)', marginLeft: '.5rem' }} role="alert">{err}</span>}
    </span>
  );
}
