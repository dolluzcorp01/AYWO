import { describe, expect, it } from 'vitest';
import { linkSuggestions } from './linkSuggestions';

const nodes = ['pavi', 'sathana', 'veera', 'ezhil', 'other'].map((id) => ({ id, nameUnknown: false }));
const unions = [{ id: 'u', partner1_id: 'veera', partner2_id: 'ezhil' }];
const links = [
  { parent_id: 'veera', child_id: 'pavi', union_id: 'u' },
  { parent_id: 'ezhil', child_id: 'pavi', union_id: 'u' },
  { parent_id: 'veera', child_id: 'sathana', union_id: null },
];

describe('linkSuggestions', () => {
  it("on Sathana's page: is Ezhilarasi also her parent", () => {
    expect(linkSuggestions({ nodes, unions, links } as never, 'sathana').map((s) => s.key)).toEqual(['ezhil:sathana']);
  });
  it("on Ezhilarasi's page: is she also Sathana's parent", () => {
    expect(linkSuggestions({ nodes, unions, links } as never, 'ezhil').map((s) => s.key)).toEqual(['ezhil:sathana']);
  });
  it('nothing to offer once everyone is linked, or for someone with no partner', () => {
    const done = [...links, { parent_id: 'ezhil', child_id: 'sathana', union_id: 'u' }];
    expect(linkSuggestions({ nodes, unions, links: done } as never, 'sathana')).toEqual([]);
    expect(linkSuggestions({ nodes, unions, links } as never, 'pavi')).toEqual([]);
    expect(linkSuggestions({ nodes, unions: [], links } as never, 'sathana')).toEqual([]);
  });
});
