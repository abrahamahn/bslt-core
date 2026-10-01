import { Link } from '@bslt/react/router';
import type { ReactElement } from 'react';
export function LandingPage(): ReactElement {
  return (
    <section className="max-w-2xl mx-auto py-12">
      <h1>Welcome</h1>
      <p>Create an account to get started, or sign in to manage your account.</p>
      <div className="flex gap-4 mt-6">
        <Link to="/register">Create account</Link>
        <Link to="/login">Sign in</Link>
      </div>
    </section>
  );
}
