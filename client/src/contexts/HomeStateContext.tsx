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

// Grid density — how tightly packed the album cards render. Each
// level maps to a grid-cols class at every breakpoint (see Home.tsx's
// GRID_COLS_BY_DENSITY). State lives here so the choice survives
// navigation between home and album pages without needing URL state.
export type DensityValue = 'comfortable' | 'dense' | 'ultra';
export const DEFAULT_DENSITY: DensityValue = 'comfortable';
const DENSITY_STORAGE_KEY = 'dig.haus:homeDensity';

function readStoredDensity(): DensityValue | null {
  try {
    const raw = localStorage.getItem(DENSITY_STORAGE_KEY);
    if (raw === 'comfortable' || raw === 'dense' || raw === 'ultra') return raw;
  } catch {
    /* private mode etc. */
  }
  return null;
}

interface HomeStateContextValue {
  sort: SortValue;
  setSort: (v: SortValue) => void;
  page: number;
  setPage: (p: number) => void;
  seed: number | undefined;
  density: DensityValue;
  setDensity: (v: DensityValue) => void;
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
  const [density, setDensityState] = useState<DensityValue>(
    () => readStoredDensity() ?? DEFAULT_DENSITY
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

  const setDensity = useCallback((v: DensityValue) => {
    setDensityState(v);
    try {
      if (v === DEFAULT_DENSITY) localStorage.removeItem(DENSITY_STORAGE_KEY);
      else localStorage.setItem(DENSITY_STORAGE_KEY, v);
    } catch {
      // private mode — choice still applies for this session
    }
  }, []);

  return (
    <HomeStateContext.Provider
      value={{ sort, setSort, page, setPage, seed, density, setDensity }}
    >
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
