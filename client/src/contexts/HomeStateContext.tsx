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

// Activity rail open/closed — the 3:5 desktop layout splits the home
// page into an activity rail (snapshots + comments) on the left and
// the album grid on the right. Users who want a classic wall-of-
// covers experience can collapse the rail; the main grid returns to
// full width and the ultra-density tier lines up with its original
// column count again. Default on: mydig exposure is one of the main
// reasons the rail exists, and newcomers should see it first.
const RAIL_STORAGE_KEY = 'dig.haus:homeRailOpen';
export const DEFAULT_RAIL_OPEN = true;

function readStoredRailOpen(): boolean | null {
  try {
    const raw = localStorage.getItem(RAIL_STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
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
  railOpen: boolean;
  setRailOpen: (v: boolean) => void;
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
  const [railOpen, setRailOpenState] = useState<boolean>(
    () => readStoredRailOpen() ?? DEFAULT_RAIL_OPEN
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

  const setRailOpen = useCallback((v: boolean) => {
    setRailOpenState(v);
    try {
      if (v === DEFAULT_RAIL_OPEN) localStorage.removeItem(RAIL_STORAGE_KEY);
      else localStorage.setItem(RAIL_STORAGE_KEY, String(v));
    } catch {
      // private mode — choice still applies for this session
    }
  }, []);

  return (
    <HomeStateContext.Provider
      value={{
        sort,
        setSort,
        page,
        setPage,
        seed,
        density,
        setDensity,
        railOpen,
        setRailOpen,
      }}
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
