'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type Field = {
  name: string; label: string; type?: 'text' | 'email' | 'password' | 'number' | 'textarea' | 'select' | 'checkbox' | 'datetime' | 'csv' | 'date';
  required?: boolean; options?: { value: string | number; label: string }[]; hint?: string; defaultValue?: string | number | boolean | null;
  step?: string; min?: number; max?: number; wide?: boolean; placeholder?: string; maxLength?: number; autoComplete?: string;
};
type Props = {
  action: string; method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; fields: Field[]; submit: string; extra?: Record<string, unknown>;
  redirect?: string;       // may contain {key}, replaced by the same key from the JSON response
  reset?: boolean; successMessage?: string; className?: string; secondary?: boolean;
};

// Campus time is fixed to Asia/Kolkata (IST, +05:30): datetime-local values are interpreted in that zone, whatever the browser's zone.
const toIso = (v: string) => new Date(`${v}:00+05:30`).toISOString();

export default function ApiForm({ action, method = 'POST', fields, submit, extra, redirect, reset, successMessage, className, secondary }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault(); setError(null); setOk(null);
    const fd = new FormData(ev.currentTarget); const body: Record<string, unknown> = { ...(extra ?? {}) };
    for (const f of fields) {
      const raw = fd.get(f.name);
      switch (f.type ?? 'text') {
        case 'checkbox': body[f.name] = raw === 'on'; break;
        case 'number': if (raw !== null && raw !== '') body[f.name] = Number(raw); break;
        case 'datetime': if (raw) body[f.name] = toIso(String(raw)); break;
        case 'csv': body[f.name] = String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean); break;
        case 'select': {
          const opt = f.options?.find(o => String(o.value) === String(raw));
          if (raw === '' || raw === null) { if (f.required) body[f.name] = null; } else body[f.name] = typeof opt?.value === 'number' ? Number(raw) : String(raw);
          break;
        }
        default: if (raw !== null && (raw !== '' || !f.required)) body[f.name] = String(raw).trim();
      }
    }
    setBusy(true);
    try {
      const res = await fetch(action, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? `Request failed (${res.status})`); return; }
      if (reset) (ev.target as HTMLFormElement).reset();
      if (redirect) { router.push(redirect.replace(/\{(\w+)\}/g, (_, k) => String(json[k] ?? ''))); router.refresh(); return; }
      setOk(successMessage ?? 'Saved.'); router.refresh();
    } catch { setError('Could not reach the server. Check your connection and try again.'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={onSubmit} className={className} noValidate={false}>
      {error && <div className="alert a-bad" role="alert">{error}</div>}
      {ok && <div className="alert a-ok" role="status">{ok}</div>}
      <div className="formgrid">
        {fields.map(f => {
          const id = `${action}-${f.name}`.replace(/\W+/g, '-'); const t = f.type ?? 'text';
          if (t === 'checkbox') return (
            <div key={f.name} className={`field check ${f.wide ? 'wide' : ''}`}><input id={id} name={f.name} type="checkbox" defaultChecked={!!f.defaultValue} /><label htmlFor={id}>{f.label}</label></div>);
          return (
            <div key={f.name} className={`field ${f.wide || t === 'textarea' ? 'wide' : ''}`}>
              <label htmlFor={id}>{f.label}{f.required ? ' *' : ''}</label>
              {t === 'textarea' ? <textarea id={id} name={f.name} rows={4} required={f.required} maxLength={f.maxLength} defaultValue={String(f.defaultValue ?? '')} placeholder={f.placeholder} />
               : t === 'select' ? (
                <select id={id} name={f.name} required={f.required} defaultValue={String(f.defaultValue ?? '')}>
                  {!f.required && <option value="">None</option>}
                  {f.required && f.defaultValue == null && <option value="" disabled>Select…</option>}
                  {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>)
               : <input id={id} name={f.name} required={f.required} maxLength={f.maxLength} placeholder={f.placeholder} autoComplete={f.autoComplete}
                        type={t === 'datetime' ? 'datetime-local' : t === 'csv' ? 'text' : t} step={f.step} min={f.min} max={f.max} defaultValue={f.defaultValue == null ? undefined : String(f.defaultValue)} />}
              {f.hint && <div className="hint">{f.hint}</div>}
            </div>);
        })}
      </div>
      <div className="row" style={{ marginTop: '.9rem' }}>
        <button className={`btn ${secondary ? '' : 'primary'}`} disabled={busy} type="submit">{busy ? 'Please wait…' : submit}</button>
      </div>
    </form>
  );
}
