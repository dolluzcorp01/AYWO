import type { RpcList } from './types.ts';

// LLD L5 no. 20. Each function checks the caller's staff permission itself.
// takedown_submit is deliberately not listed: it is only reachable through the rate-limited POST /takedown.
// Nothing that changes data is listed either. /rpc does not ask for the staff second step (the authenticator code), so
// every staff action goes through /admin/* in routes/admin.ts, which does. The dictionary decisions used to be here too:
// a stolen phone session could then approve or reject words without the code.
export const adminRpc: RpcList = {
  has_admin_permission: { args: ['p_permission'] },
  admin_me: { args: [] },
};
