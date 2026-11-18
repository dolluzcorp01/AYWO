// "Download this list" on admin lists: an Excel file that looks like AYWO. The logo and the list's name on top,
// an indigo heading row, soft stripes, and columns wide enough to read without dragging.
// Built in the browser from the rows already on the screen. Nothing new is asked of the server, so the file never
// holds more than the person was allowed to see.
import type { Workbook } from 'exceljs';
import { Platform } from 'react-native';
import { colors } from '../theme/tokens';

export interface Sheet {
  /** The big line under the logo, such as "Orders". */
  title: string;
  /** The quiet line under it: when it was downloaded and how many rows. */
  details: string;
  /** The last line: where the file came from and to keep it private. */
  footer: string;
  headers: string[];
  rows: string[][];
}

/** The logo is 749 x 240. Shown at this size in the file. */
const LOGO = { width: 137, height: 44 };
const HEAD_ROW = 5;

/** '#2F3379' as Excel wants it: FF2F3379. */
const paint = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;

/**
 * A plain amount or count ("799", "1,598" is not one, "12.5") goes in as a number, so Excel can add it up and sort it.
 * Anything else stays words. Leading zeros (PIN-like codes, "007") and very long digit runs (ids) stay words too, so
 * nothing is changed by the conversion. A number can never run as a formula.
 */
export function cellValue(value: string): string | number {
  return /^-?(0|[1-9]\d{0,11})(\.\d{1,4})?$/.test(value) ? Number(value) : value;
}

/** Wide enough for the longest value in the column, within reason. Tamil and other wide scripts get extra room. */
export function columnWidth(values: string[]): number {
  const longest = Math.max(0, ...values.map((value) => [...(value ?? '')].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2ff ? 1.6 : 1), 0)));
  return Math.min(48, Math.max(12, Math.ceil(longest) + 4));
}

/** Fills the workbook. Kept apart from the download so a test can read the result back. */
export function fillWorkbook(workbook: Workbook, sheet: Sheet, logo?: ArrayBuffer): void {
  const columns = Math.max(1, sheet.headers.length);
  const page = workbook.addWorksheet(sheet.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'AYWO', {
    views: [{ state: 'frozen', ySplit: HEAD_ROW, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  page.columns = sheet.headers.map((header, i) => ({ width: columnWidth([header, ...sheet.rows.map((row) => row[i] ?? '')]) }));

  // The top: logo, then the name of the list, then the quiet details line.
  page.getRow(1).height = 40;
  if (logo) {
    const picture = workbook.addImage({ buffer: logo, extension: 'png' });
    page.addImage(picture, { tl: { col: 0.15, row: 0.1 }, ext: LOGO, editAs: 'absolute' });
  } else {
    page.getCell(1, 1).value = 'AYWO';
    page.getCell(1, 1).font = { name: 'Calibri', size: 20, bold: true, color: { argb: paint(colors.logoIndigo) } };
  }
  const across = (row: number) => {
    if (columns > 1) page.mergeCells(row, 1, row, columns);
    return page.getCell(row, 1);
  };
  const title = across(2);
  title.value = sheet.title;
  title.font = { name: 'Calibri', size: 18, bold: true, color: { argb: paint(colors.text) } };
  title.alignment = { vertical: 'middle' };
  page.getRow(2).height = 28;
  const details = across(3);
  details.value = sheet.details;
  details.font = { name: 'Calibri', size: 11, color: { argb: paint(colors.muted) } };
  page.getRow(4).height = 8;

  // The heading row: indigo with white words, like the main button in the app.
  const head = page.getRow(HEAD_ROW);
  head.height = 24;
  sheet.headers.forEach((header, i) => {
    const cell = head.getCell(i + 1);
    cell.value = header;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: paint(colors.white) } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: paint(colors.logoIndigo) } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  // The rows. Words go in as plain words, so a name that starts with = can never run as a formula; plain amounts and
  // counts go in as numbers (cellValue).
  const edge = { style: 'thin' as const, color: { argb: paint(colors.line) } };
  sheet.rows.forEach((values, r) => {
    const row = page.getRow(HEAD_ROW + 1 + r);
    row.height = 20;
    for (let i = 0; i < columns; i += 1) {
      const cell = row.getCell(i + 1);
      cell.value = cellValue(values[i] ?? '');
      cell.font = { name: 'Calibri', size: 11, color: { argb: paint(colors.text) } };
      cell.alignment = { vertical: 'middle' };
      cell.border = { bottom: edge };
      if (r % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: paint(colors.tint) } };
    }
  });
  if (sheet.rows.length > 0) {
    page.autoFilter = { from: { row: HEAD_ROW, column: 1 }, to: { row: HEAD_ROW + sheet.rows.length, column: columns } };
  }

  const footer = across(HEAD_ROW + sheet.rows.length + 2);
  footer.value = sheet.footer;
  footer.font = { name: 'Calibri', size: 10, italic: true, color: { argb: paint(colors.muted) } };
}

/** The logo picture as bytes, or nothing if it cannot be read: the file is still made, with the name in words. */
async function logoBytes(): Promise<ArrayBuffer | undefined> {
  try {
    const { Asset } = await import('expo-asset');
    const asset = Asset.fromModule(require('../../assets/aywo_logo_app.png'));
    const response = await fetch(asset.uri);
    return response.ok ? await response.arrayBuffer() : undefined;
  } catch {
    return undefined;
  }
}

/** Saves the rows as an .xlsx file. Web only (the admin panel is a website); on a phone it does nothing. */
export async function downloadSheet(fileName: string, sheet: Sheet): Promise<void> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  // Loaded only when someone downloads, so the admin panel itself stays light.
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AYWO';
  workbook.created = new Date();
  fillWorkbook(workbook, sheet, await logoBytes());
  const bytes = await workbook.xlsx.writeBuffer();
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before the address is let go.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Today's date in India for a file name, as 2026-11-17. */
export function sheetDay(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
