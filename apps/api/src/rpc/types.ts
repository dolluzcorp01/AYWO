export interface RpcEntry {
  /** Allowed named arguments. Anything else is refused, and names never come from the caller unchecked. */
  args: string[];
  /** The function returns a table rather than one value. */
  rows?: boolean;
  /** Callable without signing in. */
  anonymous?: boolean;
}
export type RpcList = Record<string, RpcEntry>;
