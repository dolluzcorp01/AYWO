// "Download this list" on admin lists: a spreadsheet file built in the browser from the rows already on the screen.
// Nothing new is asked of the server, so the file never holds more than the person was allowed to see.
import { Platform } from 'react-native';

/** One cell. Quotes go around anything that would break a row, and a quote inside is doubled. */
function cell(value: string): string {
  // A cell that starts with = + - or @ is run as a formula by Excel. A leading apostrophe makes it plain text,
  // so a name typed by a member can never run anything on a staff computer.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The whole file as text: the heading row, then one line per row. */
export function buildCsv(headerLabels: string[], rows: string[][]): string {
  return [headerLabels, ...rows].map((row) => row.map((value) => cell(value ?? '')).join(',')).join('\r\n') + '\r\n';
}

/**
 * Saves the rows as a .csv file. Web only (the admin panel is a website); on a phone it does nothing.
 * The file starts with a byte-order mark, which is how Excel knows it is UTF-8 and shows Tamil correctly.
 */
export function downloadCsv(fileName: string, headerLabels: string[], rows: string[][]): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const blob = new Blob(['﻿', buildCsv(headerLabels, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the address is let go.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Today's date in India for a file name, as 2026-11-17. */
export function csvDay(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
