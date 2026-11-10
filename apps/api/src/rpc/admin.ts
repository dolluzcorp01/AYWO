import type { RpcList } from './types.ts';

// LLD L5 no. 20. Each function checks the caller's staff permission itself.
// takedown_submit is deliberately not listed: it is only reachable through the rate-limited POST /takedown.
export const adminRpc: RpcList = {
  has_admin_permission: { args: ['p_permission'] },
  admin_me: { args: [] },
  admin_kin_review: { args: ['p_id', 'p_decision'] },
  admin_term_report_decide: { args: ['p_id', 'p_decision', 'p_new_term', 'p_new_native'] },
};
