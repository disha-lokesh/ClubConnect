import Link from 'next/link';
import ApiForm from '@/components/ApiForm';

export default function RegisterPage() {
  return (
    <div className="container"><div className="authbox" style={{ maxWidth: 560 }}>
      <div className="card">
        <h1>Create a student account</h1><p className="muted">Only students can sign up here. Your password is stored as a salted hash, never as plain text.</p>
        <ApiForm action="/api/auth/register" submit="Create account" redirect="/login"
          fields={[
            { name: 'fullName', label: 'Full name', required: true, autoComplete: 'name' },
            { name: 'email', label: 'E-mail', type: 'email', required: true, autoComplete: 'email' },
            { name: 'srn', label: 'SRN', required: true, placeholder: 'PES2UG24CS001', hint: 'Letters and digits, 6–20 characters' },
            { name: 'department', label: 'Department', required: true, placeholder: 'CSE' },
            { name: 'yearOfStudy', label: 'Year of study', type: 'number', required: true, min: 1, max: 6 },
            { name: 'phone', label: 'Phone (optional)' },
            { name: 'password', label: 'Password', type: 'password', required: true, autoComplete: 'new-password', hint: '8+ characters with upper-case, lower-case and a digit' },
          ]} />
        <p className="small muted" style={{ marginTop: '1rem' }}>Already registered? <Link href="/login">Log in</Link></p>
      </div>
    </div></div>
  );
}
