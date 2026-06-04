// Shared builder for the /dig artist-lens URL. Centralised because the
// encoding is subtle: the `type:value` colon separator must stay
// literal while the artist name is percent-encoded (encodeURIComponent
// turns a stray colon in the name into %3A, which DigPage's
// parseLensParam then decodes back and ignores, since it splits on the
// FIRST colon — the separator). Getting this wrong in one of the three
// call sites (search row / album card / album header) would silently
// produce a lens that matches nothing.
export function artistLensTo(name: string): string {
  return `/dig?lens=artist:${encodeURIComponent(name)}`;
}
