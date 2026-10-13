import { useEffect, useRef, useState } from 'react';
import type { Appearance } from '../../shared/types';
import { useApp } from '../state';
export function Background({ appearance: a }: { appearance: Appearance }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [reduce, setReduce] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [failed, setFailed] = useState(false);
  const [still, setStill] = useState<{ id: string; source: string } | null>(null);
  const report = useApp((state) => state.report);
  const freeze = a.backgroundType === 'gif' && (reduce || a.reducedMotion);
  useEffect(() => {
    if (!freeze || !a.background) return;
    const abort = new AbortController();
    const id = a.background;
    void (async () => {
      const response = await fetch(`media://assets/${id}`, { signal: abort.signal });
      if (!response.ok) throw new Error('Background image is unavailable.');
      const bitmap = await createImageBitmap(await response.blob());
      try {
        if (abort.signal.aborted) return;
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
        setStill({ id, source: canvas.toDataURL('image/png') });
      } finally {
        bitmap.close();
      }
    })().catch((error) => {
      if (!abort.signal.aborted) {
        report(error);
        setFailed(true);
      }
    });
    return () => abort.abort();
  }, [a.background, freeze]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduce(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    setFailed(false);
  }, [a.background]);
  useEffect(() => {
    const update = () => {
      if (!ref.current) return;
      if (document.hidden || reduce || a.reducedMotion) ref.current.pause();
      else
        void ref.current.play().catch((error) => {
          if (error.name === 'AbortError') return;
          report(`Background playback failed: ${error.message}`);
          setFailed(true);
        });
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [a.background, reduce, a.reducedMotion]);
  if (!a.background || failed) return null;
  const source = `media://assets/${a.background}`;
  return (
    <div className="background" aria-hidden="true">
      <div style={{ opacity: a.backgroundOpacity, filter: `blur(${a.blur}px)` }}>
        {a.backgroundType === 'video' ? (
          <video
            ref={ref}
            src={source}
            muted
            loop
            playsInline
            preload="metadata"
            onError={(event) => {
              report(
                `The video could not be loaded: ${event.currentTarget.error?.message ?? 'unsupported format'}`,
              );
              setFailed(true);
            }}
          />
        ) : (
          (!freeze || still?.id === a.background) && (
            <img
              src={freeze ? still!.source : source}
              onError={() => {
                report('The background image could not be decoded.');
                setFailed(true);
              }}
            />
          )
        )}
      </div>
      <div className="backgroundDim" style={{ opacity: a.dimming }} />
    </div>
  );
}
