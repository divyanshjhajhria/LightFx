// Which optional files the server really has, from files.json (written at build time). Null if that list is missing,
// in which case callers ask for each file as they always did.
export interface PublicFiles {
  vo: string[];
  session: boolean;
}

let cache: Promise<PublicFiles | null> | null = null;

export function publicFiles(): Promise<PublicFiles | null> {
  cache ??= fetch('files.json')
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : null))
    .then((f: PublicFiles | null) => (f && Array.isArray(f.vo) && typeof f.session === 'boolean' ? f : null))
    .catch(() => null);
  return cache;
}
