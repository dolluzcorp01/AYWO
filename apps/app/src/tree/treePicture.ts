// F6 'Family tree picture (PDF)': the classic line tree as a web page, which the phone or the browser turns into a PDF.
// Everything printed comes from names and dates people typed, so all of it is escaped. No contact details are used.
import { graphFromApi, layoutLineTree } from '@aywo/layout';
import type { TFunction } from 'i18next';
import type { TreeNode, TreeViewAnswer } from '@/tree/useTreeView';
import { colors } from '@/theme/tokens';

const CARD_WIDTH = 150;
const CARD_HEIGHT = 74;
const GAP_X = 24;
const ROW_HEIGHT = 136;
const MARGIN = 36;
const HEADER = 70;
const FOOTER = 40;
// PDF pages stop at 200 inches.
const LARGEST_PAGE = 14400;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Same rule as GEDCOM export (countsAsLiving in packages/gedcom): anyone not clearly dead counts as living. */
export function countsAsLiving(node: Pick<TreeNode, 'living' | 'deathDate' | 'birthDate'>, today: Date): boolean {
  if (node.living === 'deceased' || node.deathDate) return false;
  if (node.living === 'living') return true;
  if (node.birthDate) {
    const year = Number(node.birthDate.slice(0, 4));
    if (Number.isFinite(year) && today.getUTCFullYear() - year > 110) return false;
  }
  return true;
}

function factsOf(node: TreeNode): string[] {
  const born = node.birthDate?.slice(0, 4) ?? '';
  const died = node.deathDate?.slice(0, 4) ?? '';
  const years = born || died ? `${born} - ${died}`.trim() : '';
  return [years, node.birthPlace ?? ''].filter((line) => !!line);
}

export interface TreePicture {
  html: string;
  width: number;
  height: number;
}

export function treePicture(data: TreeViewAnswer, options: { includeLiving: boolean; dir: 'ltr' | 'rtl'; t: TFunction; today?: Date }): TreePicture {
  const { t, includeLiving, dir } = options;
  const today = options.today ?? new Date();
  const layout = layoutLineTree(graphFromApi(data), { cardWidth: CARD_WIDTH, gapX: GAP_X, rowHeight: ROW_HEIGHT });
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const top = MARGIN + HEADER + CARD_HEIGHT / 2;
  const left = MARGIN;
  const drawnHeight = layout.cards.length > 0 ? layout.height - ROW_HEIGHT + CARD_HEIGHT : 0;
  const width = Math.max(Math.ceil(layout.width + MARGIN * 2), 595);
  const height = Math.max(Math.ceil(drawnHeight + MARGIN * 2 + HEADER + FOOTER), 420);
  // A very wide family shrinks to fit one page rather than being cut off.
  const scale = Math.min(1, LARGEST_PAGE / width, LARGEST_PAGE / height);
  const pageWidth = Math.floor(width * scale);
  const pageHeight = Math.floor(height * scale);

  const lines = layout.lines
    .map((line) => {
      const points = line.points.map((p) => `${p.x + left},${p.y + top}`).join(' ');
      const dashed = line.kind === 'ghost' ? ' stroke-dasharray="5 5"' : '';
      const stroke = line.kind === 'partner' ? colors.logoOrange : colors.logoPurple;
      return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2"${dashed} />`;
    })
    .join('');

  const cards = layout.cards
    .map((card) => {
      const node = nodes.get(card.personId);
      if (!node) return '';
      const name = node.nameUnknown ? t('tree.nameNotKnown') : node.name;
      const facts = includeLiving || !countsAsLiving(node, today) ? factsOf(node) : [];
      const style = `left:${card.x + left - CARD_WIDTH / 2}px;top:${card.y + top - CARD_HEIGHT / 2}px`;
      return `<div class="card${card.ghost ? ' ghost' : ''}" style="${style}"><div class="name" dir="auto">${escapeHtml(name)}</div>${facts
        .map((fact) => `<div class="fact" dir="auto">${escapeHtml(fact)}</div>`)
        .join('')}</div>`;
    })
    .join('');

  const note = includeLiving ? '' : ` · ${t('export.pictureLivingNote')}`;
  const footer = `${t('export.pictureFooter', { date: today.toISOString().slice(0, 10) })}${note}`;

  const html = `<!doctype html>
<html dir="${dir}"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(data.tree.name)}</title>
<style>
  @page { size: ${pageWidth}px ${pageHeight}px; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: ${colors.white}; }
  body { font-family: -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif; color: ${colors.text}; }
  #page { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; transform: scale(${scale}); transform-origin: top left; }
  h1 { position: absolute; top: ${MARGIN}px; left: ${MARGIN}px; right: ${MARGIN}px; margin: 0; font-size: 26px; }
  svg { position: absolute; top: 0; left: 0; }
  .card { position: absolute; width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; overflow: hidden; padding: 8px; text-align: center;
          background: ${colors.white}; border: 2px solid ${colors.logoPurple}; border-radius: 12px; }
  .ghost { border-style: dashed; opacity: 0.7; }
  .name { font-size: 13px; font-weight: 700; line-height: 16px; max-height: 32px; overflow: hidden; }
  .fact { font-size: 10px; line-height: 13px; color: ${colors.muted}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  footer { position: absolute; bottom: 14px; left: ${MARGIN}px; right: ${MARGIN}px; font-size: 10px; color: ${colors.muted}; }
</style></head>
<body><div id="page">
  <h1 dir="auto">${escapeHtml(data.tree.name)}</h1>
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${lines}</svg>
  ${cards}
  <footer dir="auto">${escapeHtml(footer)}</footer>
</div></body></html>`;

  return { html, width: pageWidth, height: pageHeight };
}

/** The browser's own print window, from a frame nobody sees. The person chooses 'Save as PDF' there. */
export async function printOnWeb(html: string): Promise<void> {
  const frame = globalThis.document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.srcdoc = html;
  await new Promise<void>((resolve) => {
    frame.onload = () => resolve();
    globalThis.document.body.appendChild(frame);
  });
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  // Long enough for the print window to read the page. Printing blocks the page in most browsers anyway.
  setTimeout(() => frame.remove(), 60_000);
}
