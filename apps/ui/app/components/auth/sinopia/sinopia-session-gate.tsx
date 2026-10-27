import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useHref, useNavigate } from 'react-router';
import { useSinopiaReturn, useSinopiaSession } from '#hooks/use-sinopia-session.js';
import { SinopiaAccessRetry } from '#components/auth/sinopia/sinopia-access-retry.js';
import { SinopiaNotConfigured, SinopiaReserved } from '#components/auth/sinopia/sinopia-reserved.js';
import { SinopiaLogin } from '#components/auth/sinopia/sinopia-login.js';
import { SinopiaSecondFactor } from '#components/auth/sinopia/sinopia-second-factor.js';
import { sinopiaSession } from '#lib/sinopia-session.js';
import { stripBasename } from '#lib/base-path.js';
import { isDesktopTarget } from '#lib/build-target.js';

/**
 * Whether a missing Sinopia project may open the workspace: only the desktop build and the local dev server. A web build
 * without it stays closed, so a deploy that forgot the two variables never opens the workspace to anyone.
 *
 * @returns True when nothing needs gating.
 */
export const openWithoutSinopiaProject = (): boolean => isDesktopTarget() || import.meta.env.DEV;

/**
 * SinopiaCAD: holds the workspace behind the Sinopia session. Only an account sinopialab.com would let into its app
 * opens it; before that the sign-in screen, the second-factor step or «Riprova» stands in, and while the stored session
 * is read or the account checked (the server render and the first client frames too) the caller's placeholder does.
 * Back from Google, the router first goes back to where the person was, so the workspace never renders on the address
 * with the code in it. Without a Sinopia project configured only the desktop build and the dev server open; the web
 * build stays closed.
 *
 * @param properties - The gated subtree and what to show while the session is read.
 * @returns The children, the placeholder, or a screen of the sign-in.
 */
export function SinopiaSessionGate({
  children,
  placeholder,
}: {
  readonly children: ReactNode;
  readonly placeholder?: ReactNode;
}): ReactNode {
  const session = useSinopiaSession();
  const returnTo = useSinopiaReturn();
  const navigate = useNavigate();
  const basename = useHref('/').replace(/\/$/u, '');

  useEffect(() => {
    if (returnTo === undefined) {
      return;
    }
    // async-iife: bootstrap -- the workspace waits for the router to stand on the clean address, whatever the outcome.
    void (async (): Promise<void> => {
      try {
        // `returnTo` was read from `location` (`/cad/w/…`); `navigate` adds the basename itself.
        await navigate(stripBasename(returnTo, basename), { replace: true });
      } finally {
        sinopiaSession().settleReturn(returnTo);
      }
    })();
  }, [navigate, returnTo, basename]);

  if (returnTo !== undefined) {
    return placeholder;
  }
  switch (session.status) {
    case 'disabled': {
      return openWithoutSinopiaProject() ? children : <SinopiaNotConfigured />;
    }
    case 'signed-in': {
      return children;
    }
    case 'checking': {
      return placeholder;
    }
    case 'signed-out': {
      return <SinopiaLogin notice={session.notice} />;
    }
    case 'second-factor': {
      return <SinopiaSecondFactor user={session.user} />;
    }
    case 'unverified': {
      return <SinopiaAccessRetry user={session.user} />;
    }
    case 'reserved': {
      return <SinopiaReserved user={session.user} />;
    }
  }
}
