import type { ReactNode } from 'react';
import { useSinopiaSession } from '#hooks/use-sinopia-session.js';
import { SinopiaLogin } from '#components/auth/sinopia/sinopia-login.js';

/**
 * SinopiaCAD: holds the workspace behind the Sinopia session. Signed out, the sign-in screen stands in for it; while
 * the stored session is read (the server render and the first client frames) the caller's placeholder does. Without a
 * Sinopia project configured nothing is gated.
 *
 * @param properties - The gated subtree and what to show while the session is read.
 * @returns The children, the placeholder, or the sign-in screen.
 */
export function SinopiaSessionGate({
  children,
  placeholder,
}: {
  readonly children: ReactNode;
  readonly placeholder?: ReactNode;
}): ReactNode {
  const session = useSinopiaSession();
  switch (session.status) {
    case 'disabled':
    case 'signed-in': {
      return children;
    }
    case 'checking': {
      return placeholder;
    }
    case 'signed-out': {
      return <SinopiaLogin />;
    }
  }
}
