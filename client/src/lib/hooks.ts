import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { serverNow } from '@/net/socket';

/** Milisegundos que faltan para `endsAt` (timestamp del servidor). */
export function useCountdown(endsAt: number | null | undefined, fps = 10): number {
  const [left, setLeft] = useState(() => (endsAt ? Math.max(0, endsAt - serverNow()) : 0));

  useEffect(() => {
    if (!endsAt) {
      setLeft(0);
      return;
    }
    const step = () => setLeft(Math.max(0, endsAt - serverNow()));
    step();
    const id = setInterval(step, Math.round(1000 / fps));
    return () => clearInterval(id);
  }, [endsAt, fps]);

  return left;
}

/** Bucle de animación con delta en segundos. Pasá `active: false` para pausarlo. */
export function useRaf(cb: (dt: number, t: number) => void, active = true): void {
  const ref = useRef(cb);
  useLayoutEffect(() => {
    ref.current = cb;
  });
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let prev = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - prev) / 1000);
      prev = t;
      ref.current(dt, t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

export function useInterval(cb: () => void, ms: number | null): void {
  const ref = useRef(cb);
  useLayoutEffect(() => {
    ref.current = cb;
  });
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Valor anterior de `value`, para detectar transiciones. */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

/** Dispara `cb` cuando `value` cambia (salteando el primer render). */
export function useOnChange<T>(value: T, cb: (current: T, previous: T) => void): void {
  const prev = useRef<T>(value);
  const fn = useRef(cb);
  useLayoutEffect(() => {
    fn.current = cb;
  });
  useEffect(() => {
    if (!Object.is(prev.current, value)) {
      const before = prev.current;
      prev.current = value;
      fn.current(value, before);
    }
  }, [value]);
}

/** Tamaño observado de un elemento. */
export function useSize<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Teclas presionadas en este momento (en minúscula / code). */
export function useKeys(
  handlers: Record<string, (down: boolean, e: KeyboardEvent) => void>,
  active = true,
): void {
  const ref = useRef(handlers);
  useLayoutEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => {
      const fn = ref.current[e.code] ?? ref.current[e.key.toLowerCase()];
      if (fn) {
        if (!e.repeat) fn(true, e);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      const fn = ref.current[e.code] ?? ref.current[e.key.toLowerCase()];
      if (fn) {
        fn(false, e);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [active]);
}

/** Número que se anima hasta `target` (para contadores de plata). */
export function useRollingNumber(target: number, speed = 6): number {
  const [value, setValue] = useState(target);
  const ref = useRef(target);
  useRaf((dt) => {
    const diff = target - ref.current;
    if (Math.abs(diff) < 0.6) {
      if (ref.current !== target) {
        ref.current = target;
        setValue(target);
      }
      return;
    }
    ref.current += diff * Math.min(1, dt * speed);
    setValue(Math.round(ref.current));
  });
  return value;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
