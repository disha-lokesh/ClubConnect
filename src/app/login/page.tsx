import Link from 'next/link';
import ApiForm from '@/components/ApiForm';

export default function LoginPage() {
  const dev = process.env.NODE_ENV !== 'production';
  return (
    <div className="container"><div className="authbox">
      <div className="card">
        <h1>Log in</h1><p className="muted">Welcome back to ClubConnect.</p>
        <ApiForm action="/api/auth/login" submit="Log in" redirect="{redirect}"
          fields={[{ name: 'email', label: 'E-mail', type: 'email', required: true, autoComplete: 'username' }, { name: 'password', label: 'Password', type: 'password', required: true, autoComplete: 'current-password' }]} />
        <p className="small muted" style={{ marginTop: '1rem' }}>New student? <Link href="/register">Create an account</Link>. Club and campus administrator accounts are created by a campus administrator.</p>
      </div>
      {dev && (
        <div className="card"><h3>Demo accounts <span className="badge b-warn">development seed only</span></h3>
          <p className="small muted">Club passwords follow the club name (for example, <code>acmw123</code>).</p>
          <table className="small"><tbody>
            <tr><td>Campus admin</td><td><code>admin@pes.edu</code></td></tr>
            <tr><td>Club admin (ACMW)</td><td><code>acmw@pes.edu</code> / <code>acmw123</code></td></tr>
            <tr><td>Club admin (MCOP)</td><td><code>mcop@pes.edu</code> / <code>mcop123</code></td></tr>
            <tr><td>Club admin (Pixels)</td><td><code>pixels@pes.edu</code> / <code>pixels123</code></td></tr>
            <tr><td>Student</td><td><code>aarav.sharma1@stu.pes.edu</code></td></tr>
          </tbody></table></div>)}
    </div></div>
  );
}
