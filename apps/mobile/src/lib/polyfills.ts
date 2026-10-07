// Hermes may lack structuredClone; shared packages only clone plain JSON entities.
const g = globalThis as { structuredClone?: <T>(v: T) => T };
if (typeof g.structuredClone !== 'function') {
  g.structuredClone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
}
export {};
