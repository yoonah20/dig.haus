import { useEffect, useRef, useState } from 'react';

/**
 * Minimal IntersectionObserver hook. Returns a ref and a boolean that flips
 * to true once the observed element enters the viewport. Stays true once
 * triggered (so the gated query doesn't unmount/remount on scroll).
 */
export function useInView<T extends Element>(
  rootMargin = '200px'
): { ref: (node: T | null) => void; inView: boolean } {
  const [inView, setInView] = useState(false);
  const elRef = useRef<T | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  function setRef(node: T | null) {
    if (elRef.current === node) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    elRef.current = node;
    if (!node || inView) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(node);
    observerRef.current = observer;
  }

  return { ref: setRef, inView };
}
