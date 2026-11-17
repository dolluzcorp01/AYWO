export interface DateTimeFieldProps {
  label?: string;
  /** "2026-12-25" for a date, "18:30" for a time, or "" when not picked. */
  value: string;
  onChange: (value: string) => void;
  /** Same format as value: the earliest and latest that can be picked. */
  min?: string;
  max?: string;
  invalid?: boolean;
  help?: string;
  error?: string;
  /** Shows a Clear button once something is picked. */
  optional?: boolean;
}
