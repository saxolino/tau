import type { SupabaseClient } from '@supabase/supabase-js';
import { readSinopiaConfig, sinopiaSession } from '#lib/sinopia-session.js';

/** Read the admitted account before and after refresh; a changed account cannot inherit an operation. */
export async function requireSinopiaUser(expectedUserId?: string): Promise<{ userId: string; token: string }> {
  const session = sinopiaSession();
  const before = session.getState();
  if (before.status !== 'signed-in' || (expectedUserId !== undefined && before.user.id !== expectedUserId)) {
    throw new Error('SINOPIA_SESSION_REQUIRED');
  }
  const token = await session.accessToken();
  const after = session.getState();
  if (token === undefined || after.status !== 'signed-in' || after.user.id !== before.user.id) {
    throw new Error('SINOPIA_SESSION_CHANGED');
  }
  return { userId: after.user.id, token };
}

/** Stateless data transport over the one admitted session: no second auth store, service key or stale JWT. */
export async function getSinopiaDataClient(): Promise<{ client: SupabaseClient; userId: string }> {
  const { userId } = await requireSinopiaUser();
  const config = readSinopiaConfig();
  if (config === undefined) {
    throw new Error('SINOPIA_SESSION_REQUIRED');
  }
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(config.url, config.publishableKey, {
    accessToken: async () => {
      const admitted = await requireSinopiaUser(userId);
      return admitted.token;
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { client, userId };
}
