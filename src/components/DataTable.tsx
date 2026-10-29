import { Empty } from './ui';
const cell = (v: unknown) => v == null ? '—' : v instanceof Date ? v.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : typeof v === 'object' ? JSON.stringify(v) : String(v);
/** Generic read-only table for report rows. `cols` maps column key → heading (order preserved). */
export default function DataTable({ rows, cols, empty = 'No data.' }: { rows: Record<string, unknown>[]; cols: Record<string, string>; empty?: string }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return <div className="tablewrap"><table><thead><tr>{Object.values(cols).map(h => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{Object.keys(cols).map(k => <td key={k}>{cell(r[k])}</td>)}</tr>)}</tbody></table></div>;
}
