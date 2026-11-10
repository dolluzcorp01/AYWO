import type { RpcList } from './types.ts';

// Database functions the app may call. Each one checks the caller itself.
export const coreRpc: RpcList = {
  tree_role: { args: ['p_tree', 'p_person'] },
  claim_candidates: { args: [], rows: true },
  claim_confirm: { args: ['p_person'] },
  claim_undo: { args: ['p_person'] },
  add_relative: { args: ['p_anchor', 'p_relation', 'p_person', 'p_existing_person', 'p_union', 'p_link_kind'] },
  import_commit: { args: ['p_import', 'p_tree_name', 'p_fixes', 'p_me_temp'] },
  person_card: { args: ['p_person'] },
  request_contacts: { args: ['p_person'] },
  set_elder_younger: { args: ['p_person', 'p_than', 'p_elder'] },
  set_person_contact: { args: ['p_person', 'p_kind', 'p_value', 'p_value_normalized'] },
  delete_person_contact: { args: ['p_contact'] },
};
