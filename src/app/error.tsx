'use client';
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container"><div className="card authbox">
      <h1>Something went wrong</h1>
      <p className="muted">The page could not be loaded. This is usually a short database interruption; your data is safe. Please try again.</p>
      <button className="btn primary" onClick={() => reset()}>Try again</button>
    </div></div>
  );
}
