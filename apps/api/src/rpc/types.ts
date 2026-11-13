export interface RpcEntry {
  /** Allowed named arguments. Anything else is refused, and names never come from the caller unchecked. */
  args: string[];
  /** The function returns a table rather than one value. */
  rows?: boolean;
  /** Callable without signing in. */
  anonymous?: boolean;
  /** Arguments that are Postgres arrays (such as uuid[]): sent as a list of text, not as JSON. */
  arrays?: string[];
}
export type RpcList = Record<string, RpcEntry>;
