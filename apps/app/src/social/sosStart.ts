// Holding the SOS bar on Home starts the SOS as soon as the SOS screen opens. That wish is kept here, in memory, and
// never in the page address: an address is replayed by a reload, the back button or a link someone sends, and each of
// those would start a new SOS and alarm the family again.
const GOOD_FOR_MS = 15_000;

let armedAt = 0;

/** Called at the end of the 2 second hold, just before the SOS screen opens. */
export function armSosStart(): void {
  armedAt = Date.now();
}

/** True once, and only shortly after the hold. */
export function takeSosStart(): boolean {
  const armed = armedAt > 0 && Date.now() - armedAt < GOOD_FOR_MS;
  armedAt = 0;
  return armed;
}
