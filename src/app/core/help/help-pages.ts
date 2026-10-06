/**
 * Which help note belongs to which screen. A screen with no note of its own (the account page,
 * the patient file) gets the nearest one, and one with none at all is simply offered the full list.
 * Longest prefix wins, so `/finance/cheques` is a finance page and `/patients/12` a patients page.
 */
const PAGES: ReadonlyArray<readonly [string, string]> = [
  ['/schedule', 'agenda'],
  ['/front-desk', 'agenda'],
  ['/patients', 'patients'],
  ['/recalls', 'patients'],
  ['/billing', 'billing'],
  ['/finance', 'finance'],
  ['/retrocessions', 'retrocessions'],
  ['/analytics', 'analytics'],
  ['/lab-orders', 'lab-orders'],
  ['/sterilization', 'sterilization'],
  ['/stock', 'stock'],
  ['/settings', 'settings'],
];

export function helpPageKey(url: string): string | null {
  const path = url.split(/[?#]/)[0];
  const match = PAGES.filter(([prefix]) => path === prefix || path.startsWith(`${prefix}/`)).sort((a, b) => b[0].length - a[0].length)[0];
  return match ? match[1] : null;
}

export type Block = { kind: 'p'; text: string } | { kind: 'ul'; items: string[] };

/**
 * A note's body as paragraphs and bullet lists, from plain text: blank lines separate paragraphs,
 * lines starting with "- " or "• " are list items. Text only, never HTML, so a note edited by
 * anyone with the settings permission cannot put markup on a colleague's screen.
 */
export function noteBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of body.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      continue;
    }
    const bullet = (l: string) => /^[-•*]\s+/.test(l);
    if (lines.every(bullet)) {
      blocks.push({ kind: 'ul', items: lines.map(l => l.replace(/^[-•*]\s+/, '')) });
    } else {
      let paragraph: string[] = [];
      for (const line of lines) {
        if (bullet(line)) {
          if (paragraph.length) {
            blocks.push({ kind: 'p', text: paragraph.join(' ') });
            paragraph = [];
          }
          const last = blocks[blocks.length - 1];
          if (last?.kind === 'ul') {
            last.items.push(line.replace(/^[-•*]\s+/, ''));
          } else {
            blocks.push({ kind: 'ul', items: [line.replace(/^[-•*]\s+/, '')] });
          }
        } else {
          paragraph.push(line);
        }
      }
      if (paragraph.length) {
        blocks.push({ kind: 'p', text: paragraph.join(' ') });
      }
    }
  }
  return blocks;
}
