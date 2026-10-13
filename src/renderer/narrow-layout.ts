import { useEffect, useState } from 'react';

export const NARROW_VIEWPORT_QUERY = '(max-width: 600px)';

export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW_VIEWPORT_QUERY).matches);
  useEffect(() => {
    const media = matchMedia(NARROW_VIEWPORT_QUERY);
    let current = media.matches;
    const update = () => {
      if (media.matches === current) return;
      current = media.matches;
      setNarrow(current);
    };
    media.addEventListener('change', update);
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(document.documentElement);
    update();
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, []);
  return narrow;
}
