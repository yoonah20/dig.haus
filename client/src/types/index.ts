export type PurchaseLinkStatus = 'upcoming' | 'sale' | 'soldout';

export interface PriceTagLink {
  id: number;
  url: string;
  storeName: string;
  storeFaviconUrl: string | null;
  price: number | null;
  currency: string;
  priceKrw: number | null;
  format: string | null;
  status: PurchaseLinkStatus | null;
}

export type OwnershipState = 'owned' | 'wanted' | null;
export type OwnershipFormat = 'Vinyl' | 'CD' | 'Cassette';
export const OWNERSHIP_FORMATS: readonly OwnershipFormat[] = [
  'Vinyl',
  'CD',
  'Cassette',
] as const;

export interface AlbumSearchResult {
  mbid: string;
  title: string;
  artist: string;
  year: number | null;
  /** Full ISO date (YYYY-MM-DD) when the album was released. Home
   *  grid uses this to flag releases from the last 30 days with a
   *  "NEW!" sticker; year alone is too coarse for a monthly window. */
  releaseDate?: string | null;
  format: string | null;
  label: string | null;
  coverArtUrl: string | null;
  coverArtFallbacks?: string[];
  averageScore?: number | null;
  reviewCount?: number;
  upvotes?: number;
  downvotes?: number;
  isVinylWall?: boolean;
  priceTagLinks?: PriceTagLink[];
  genres?: string[];
  /** NULL until admin approves the review-search crawl. Home grid
   *  dims cards with null; detail page swaps a placeholder into the
   *  review section. */
  reviewsCrawledAt?: string | null;
  /** How many users have this album in their 샀음 collection. */
  ownedCount?: number;
  /** How many users have this album on their 살거 wantlist. */
  wantedCount?: number;
  /** How many 50자 평 entries exist for this album. Surfaces on the
   *  card flip-back stat row next to 굿굿/별루. */
  userReviewCount?: number;
  /** Server-computed: true when the album is in the site-wide top 10
   *  by 굿굿 count (with a ≥3 floor). Drives the red HOT! sticker. */
  isHot?: boolean;
  /** Cover-sticker flags — true if at least one purchase link with
   *  the matching status exists for the album (any format, any
   *  store). Computed from the full link set server-side so a
   *  cheap "available" copy can't mask a soldout listing. */
  hasPreorderLink?: boolean;
  hasSaleLink?: boolean;
  hasSoldoutLink?: boolean;
}

export interface AuthUser {
  id: number;
  email: string;
  // Effective fields — custom override wins, Google value as fallback.
  name: string | null;
  avatarUrl: string | null;
  // Raw values so the profile editor can tell "no custom value set" from
  // "custom value happens to equal the Google default".
  googleName?: string | null;
  googleAvatarUrl?: string | null;
  displayName?: string | null;
  customAvatarUrl?: string | null;
  instagramHandle?: string | null;
  isAdmin: boolean;
}

export interface PurchaseLink {
  id: number;
  url: string;
  storeName: string;
  storeFaviconUrl: string | null;
  price: number | null;
  currency: string;
  priceKrw: number | null;
  format: string | null;
  note: string | null;
  status: PurchaseLinkStatus | null;
  userId: number;
  userName: string | null;
  userAvatar: string | null;
  createdAt: string;
}

export interface ArtistSearchResult {
  mbid: string;
  name: string;
  country: string | null;
  tags: string[];
}

export interface SearchResults {
  albums: AlbumSearchResult[];
  artists: ArtistSearchResult[];
}

export interface StreamingLinks {
  spotify: string | null;
  appleMusic: string | null;
  appleMusicEmbedUrl: string | null;
  youtube: string | null;
  bandcamp: string | null;
}

export interface FormatPrice {
  format: string;
  lowestPrice: number | null;
  lowestPriceKrw?: number | null;
  copiesForSale: number;
  sellUrl: string;
}

export interface BuyInfo {
  discogsUrl: string | null;
  formats: FormatPrice[];
  bandcampUrl: string | null;
}

export interface Review {
  id: number;
  source: string;
  score: number | null;
  scoreMax: number | null;
  excerpt: string | null;
  excerptKo: string | null;
  url: string | null;
  isManualScore: boolean;
}

export interface SimilarAlbum {
  title: string;
  artist: string;
  mbid: string | null;
  reason: string | null;
  imageUrl: string | null;
  discogsUrl: string | null;
  spotifyUrl: string | null;
  youtubeUrl: string | null;
  bandcampUrl: string | null;
}

export interface LabelInfo {
  name: string;
  foundingYear: number | null;
  country: string | null;
  genreFocus: string | null;
  notableReleases: Array<{ title: string; artist: string; year: number | null; mbid?: string }>;
}

export interface AlbumDetail {
  album: {
    mbid: string;
    slug: string | null;
    title: string;
    artist: string;
    artistMbid: string | null;
    releaseDate: string;
    releaseYear?: number | null;
    format?: string | null;
    discogsUrl?: string | null;
    label: string | null;
    genres: string[];
    coverArtUrl: string | null;
    coverArtFallbacks?: string[];
    artistKo?: string;
    titleKo?: string;
    titleMeaning?: string;
    upvotes?: number;
    downvotes?: number;
    userVote?: 'up' | 'down' | null;
    ownedCount?: number;
    wantedCount?: number;
    userOwnedFormats?: OwnershipFormat[];
    userWantedFormats?: OwnershipFormat[];
  };
  streaming: StreamingLinks;
  buy: BuyInfo;
  reviews: Review[];
  koreanSummary: string | null;
  averageScore: number | null;
  similarAlbums: SimilarAlbum[];
  label: LabelInfo | null;
  discography: Array<{
    mbid: string;
    title: string;
    year: string;
    primaryType: string;
    coverArtUrl: string;
  }>;
}

export interface ArtistDetail {
  artist: {
    mbid: string;
    name: string;
    bio: string | null;
    photoUrl: string | null;
    genres: string[];
    lastFmUrl: string | null;
  };
  discography: Array<{
    mbid: string;
    title: string;
    year: number | null;
    type: string;
    coverArtUrl: string | null;
  }>;
  similarArtists: Array<{
    name: string;
    mbid: string | null;
    imageUrl: string | null;
  }>;
}
