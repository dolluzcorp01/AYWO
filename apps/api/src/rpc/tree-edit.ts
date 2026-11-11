import type { RpcList } from './types.ts';

// Database functions the app may call. Each one checks the caller itself (db/migrations/0006_tree_edit.sql).
export const treeEditRpc: RpcList = {
  tree_create: { args: ['p_name'] },
  requests_decide: { args: ['p_request', 'p_decision', 'p_edited'] },
  request_access: { args: ['p_tree', 'p_kind', 'p_person', 'p_payload'] },
  request_change: { args: ['p_person', 'p_payload'] },
  share_create: {
    args: ['p_tree', 'p_role', 'p_edit_mode', 'p_contacts_visible', 'p_scope_person', 'p_grantee_person', 'p_grantee_phone', 'p_expires_at'],
  },
  history_revert: { args: ['p_history', 'p_batch'] },
  merge_scan: { args: ['p_tree'] },
  merge_apply: { args: ['p_request', 'p_keep'] },
  // account_delete is not here on purpose: only the account_deletions job runs it, 30 days after
  // POST /account/delete booked it (0014), so no call can skip the grace period.
  union_set_date: { args: ['p_union', 'p_version', 'p_date'] },
  tree_add_me: { args: ['p_tree', 'p_anchor', 'p_relation', 'p_name', 'p_gender'] },
};
