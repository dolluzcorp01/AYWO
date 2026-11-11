import { describe, expect, it } from 'vitest';
import { escapeHtml, generations, previewTags, previewText, withPreview } from './link-preview.ts';

describe('link preview', () => {
  it('escapes a name that tries to become page code', () => {
    const tags = previewTags(previewText('<script>alert(1)</script>', 'Ravi "R" & co', 3, 2), 'https://aywo.in/link/x', 'https://api.aywo.in/link-card.png');
    expect(tags).not.toContain('<script>');
    expect(tags).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(tags).toContain('Ravi &quot;R&quot; &amp; co');
    expect(escapeHtml(`'`)).toBe('&#39;');
  });

  it('counts generations as the longest parent-to-child chain', () => {
    expect(generations([], [])).toBe(0);
    expect(generations(['me'], [])).toBe(1);
    const links = [
      { parent_id: 'grandma', child_id: 'amma' },
      { parent_id: 'amma', child_id: 'me' },
      { parent_id: 'me', child_id: 'son' },
      { parent_id: 'amma', child_id: 'sis' },
    ];
    expect(generations(['grandma', 'amma', 'me', 'son', 'sis'], links)).toBe(4);
  });

  it('does not hang on a loop in bad data', () => {
    expect(generations(['a', 'b'], [{ parent_id: 'a', child_id: 'b' }, { parent_id: 'b', child_id: 'a' }])).toBeGreaterThan(0);
  });

  it('writes the card text with the right plurals', () => {
    expect(previewText('Rao family', 'Asha', 9, 3)).toEqual({
      title: 'Asha invited you to Rao family',
      description: '9 people · 3 generations on AYWO. See the family and where you fit.',
    });
    expect(previewText('Rao family', null, 1, 1)).toEqual({
      title: "You're invited to Rao family",
      description: '1 person on AYWO. See the family and where you fit.',
    });
  });

  it('puts the card tags into the web page head and replaces its title', () => {
    const shell = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>AYWO</title></head><body><div id="root"></div><script src="/_expo/app.js"></script></body></html>';
    const page = withPreview(shell, previewTags(previewText('Rao family', 'Asha', 2, 2), 'https://aywo.in/link/x', 'https://api.aywo.in/link-card.png'));
    expect(page.match(/<title>/g)).toHaveLength(1);
    expect(page).toContain('<title>Asha invited you to Rao family</title>');
    expect(page).toContain('<meta property="og:image" content="https://api.aywo.in/link-card.png" />');
    expect(page).toContain('<script src="/_expo/app.js"></script>');
    expect(page.indexOf('og:title')).toBeLessThan(page.indexOf('</head>'));
  });
});
