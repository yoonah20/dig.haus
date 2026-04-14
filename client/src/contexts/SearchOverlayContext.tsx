import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface SearchOverlayValue {
  open: boolean;
  initialQuery: string;
  openOverlay: (query?: string) => void;
  closeOverlay: () => void;
}

const SearchOverlayContext = createContext<SearchOverlayValue | undefined>(undefined);

export function SearchOverlayProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState('');

  const openOverlay = useCallback((query = '') => {
    setInitialQuery(query);
    setOpen(true);
  }, []);

  const closeOverlay = useCallback(() => {
    setOpen(false);
    setInitialQuery('');
  }, []);

  return (
    <SearchOverlayContext.Provider value={{ open, initialQuery, openOverlay, closeOverlay }}>
      {children}
    </SearchOverlayContext.Provider>
  );
}

export function useSearchOverlay(): SearchOverlayValue {
  const ctx = useContext(SearchOverlayContext);
  if (!ctx) throw new Error('useSearchOverlay must be used within SearchOverlayProvider');
  return ctx;
}
