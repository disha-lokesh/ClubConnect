import Link from 'next/link';
export default function NotFound() {
  return (<div className="container"><div className="card authbox"><h1>Not found</h1><p className="muted">That page or record does not exist, or you are not allowed to see it.</p><Link className="btn primary" href="/">Go home</Link></div></div>);
}
