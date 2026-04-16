import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import {
  type SortValue,
  DEFAULT_SORT,
  SORT_STORAGE_KEY,
  readStoredSort,
} from '../lib/homeSort';

// Shared home-page state (sort / page / random seed) pulled off the
// URL. Previously these lived in `?sort=…&page=…&seed=…` so share
// links and back-nav worked, but the address bar churned on every
// sort click — not the UX the site wants. Now:
//
//   - sort persists across reloads via localStorage (same key the
//     SortMenu wrote to before)
//   - page resets to 1 on each mount (explicit re-entry = fresh start)
//   - seed regenerates when the user switches to/from the random sort
//
// Trade-off: no shareable "sort=X" URLs. The user said they'd rather
// have a clean bar.

interface HomeStateContextValue {
  sort: SortValue;
  setSort: (v: SortValue) => void;
  page: number;
  setPage: (p: number) => void;
  seed: number | undefined;
}

const HomeStateContext = createContext<HomeStateContextValue | undefined>(
  undefined
);

function freshSeed() {
  return Math.floor(Math.random() * 1_000_000);
}

export function HomeStateProvider({ children }: { children: ReactNode }) {
  const [sort, setSortState] = useState<SortValue>(
    () => readStoredSort() ?? DEFAULT_SORT
  );
  const [page, setPage] = useState(1);
  const [seed, setSeed] = useState<number | undefined>(() =>
    (readStoredSort() ?? DEFAULT_SORT) === 'random' ? freshSeed() : undefined
  );

  const setSort = useCallback((v: SortValue) => {
    setSortState(v);
    setPage(1);
    setSeed(v === 'random' ? freshSeed() : undefined);
    try {
      if (v === DEFAULT_SORT) localStorage.removeItem(SORT_STORAGE_KEY);
      else localStorage.setItem(SORT_STORAGE_KEY, v);
    } catch {
      // private mode etc. — sort still works, just doesn't persist
    }
  }, []);

  return (
    <HomeStateContext.Provider value={{ sort, setSort, page, setPage, seed }}>
      {children}
    </HomeStateContext.Provider>
  );
}

export function useHomeState(): HomeStateContextValue {
  const ctx = useContext(HomeStateContext);
  if (!ctx) {
    throw new Error('useHomeState must be used within HomeStateProvider');
  }
  return ctx;
}
