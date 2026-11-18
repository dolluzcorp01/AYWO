import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web', select: (options: Record<string, unknown>) => options.web ?? options.default } }));

import { columnWidth, fillWorkbook } from './sheet';

const sheet = {
  title: 'Orders',
  details: 'Downloaded 18 Nov 2026, 10:26 am · 2 rows',
  footer: 'From the AYWO admin panel.',
  headers: ['Order no.', 'Buyer', 'Amount'],
  rows: [
    ['A-1', 'Arun Kumar', '799'],
    ['A-2', '=HYPERLINK("http://bad.example","x")', '999'],
  ],
};

/** Writes the file and reads it back, the way Excel would open it. */
async function roundTrip(logo?: ArrayBuffer) {
  const made = new ExcelJS.Workbook();
  fillWorkbook(made, sheet, logo);
  const bytes = await made.xlsx.writeBuffer();
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(bytes);
  return read.worksheets[0];
}

describe('the branded Excel download', () => {
  it('opens again with the title, the heading row and every value in place', async () => {
    const page = await roundTrip();
    expect(page.name).toBe('Orders');
    expect(page.getCell('A2').value).toBe('Orders');
    expect(page.getCell('A3').value).toBe(sheet.details);
    expect(page.getRow(5).values).toEqual([undefined, 'Order no.', 'Buyer', 'Amount']);
    expect(page.getCell('B6').value).toBe('Arun Kumar');
    expect(page.getCell('A9').value).toBe(sheet.footer);
  });

  it('colours the heading row indigo with white words', async () => {
    const page = await roundTrip();
    const head = page.getCell('A5');
    expect(head.fill).toMatchObject({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F3379' } });
    expect(head.font).toMatchObject({ bold: true, color: { argb: 'FFFFFFFF' } });
  });

  it('keeps a value that starts with = as plain words, never a formula', async () => {
    const page = await roundTrip();
    const cell = page.getCell('B7');
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe('=HYPERLINK("http://bad.example","x")');
  });

  it('puts the logo picture in when one is given, and the name in words when not', async () => {
    // The smallest valid PNG: one clear dot.
    const dot = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    expect((await roundTrip(dot.buffer)).getImages()).toHaveLength(1);
    const plain = await roundTrip();
    expect(plain.getImages()).toHaveLength(0);
    expect(plain.getCell('A1').value).toBe('AYWO');
  });

  it('makes columns wide enough to read, within limits', () => {
    expect(columnWidth(['a'])).toBe(12);
    expect(columnWidth(['x'.repeat(30)])).toBe(34);
    expect(columnWidth(['x'.repeat(200)])).toBe(48);
  });
});
