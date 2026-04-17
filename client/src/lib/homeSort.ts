// Sort options for the homepage album list. Used by SortMenu (TopNav
// popover trigger) and consumed by HomeStateContext for the default
// value + isSortValue check.
//
// Previously had an admin-only [등록 요청작] entry that swapped the grid
// data source to pending album requests; moved to the admin dashboard
// where it's a proper per-section surface rather than a sort-dropdown
// hack. SortOption.adminOnly kept as a shape concept for any future
// admin-scoped sorts, but no options currently use it.

export interface SortOption {
  value: string;
  label: string;
  adminOnly?: boolean;
}

export const SORT_OPTIONS: readonly SortOption[] = [
  { value: 'registered_desc', label: '등록 최신순' },
  { value: 'release_date_desc', label: '발매 최신순' },
  { value: 'random', label: '랜덤 순서로' },
  { value: 'artist_az', label: '아티스트 A-Z' },
  { value: 'score_desc', label: '리뷰 평점순' },
  { value: 'price_asc', label: '가격 낮은순' },
  { value: 'user_review_count_desc', label: '50자평 많은순' },
  { value: 'upvotes_desc', label: '굿굿 많은순' },
  { value: 'downvotes_desc', label: '별루 많은순' },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]['value'];
export const DEFAULT_SORT: SortValue = 'registered_desc';
export const SORT_STORAGE_KEY = 'home:sort';

export function isSortValue(v: string): v is SortValue {
  return SORT_OPTIONS.some((o) => o.value === v);
}

export function readStoredSort(): SortValue | null {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY) || '';
    return isSortValue(raw) ? raw : null;
  } catch {
    return null;
  }
}
