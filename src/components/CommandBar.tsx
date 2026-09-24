'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { searchInstruments, type Instrument } from '@/lib/market/universe';
import { TradeButton } from '@/components/TradeButton';

const NAV = [
  { key: 'F1', label: 'MARKETS', href: '/' },
  { key: 'F2', label: 'TRADE', href: '/trade/BTC-USD' },
  { key: 'F3', label: 'SIGNAL', href: '/ticker/BTC-USD' },
  { key: 'F4', label: 'SCREEN', href: '/screener' },
  { key: 'F5', label: 'BACKTEST', href: '/backtest' },
  { key: 'F6', label: 'BLOTTER', href: '/paper' },
];

export function CommandBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Instrument[]>([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setResults(query.trim() ? searchInstruments(query, 9) : []);
    setCursor(0);
  }, [query]);

  // Keyboard-first, the way a terminal should be: "/" focuses search from
  // anywhere, Escape dismisses, function keys jump between screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
      const fnIndex = NAV.findIndex((n) => n.key === e.key);
      if (fnIndex >= 0) {
        e.preventDefault();
        router.push(NAV[fnIndex].href);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = useCallback((symbol: string) => {
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    router.push(`/ticker/${encodeURIComponent(symbol)}`);
  }, [router]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = results[cursor];
      const symbol = pick ? pick.symbol : query.trim().toUpperCase();
      if (!symbol) return;
      // Shift+Enter skips the dossier and goes straight to the trade call.
      if (e.shiftKey) {
        setOpen(false);
        setQuery('');
        inputRef.current?.blur();
        router.push(`/trade/${encodeURIComponent(symbol)}`);
      } else {
        go(symbol);
      }
    }
  };

  return (
    <header className="h-11 border-b border-hairline bg-terminal flex items-center gap-0 px-3 shrink-0 relative z-50">
      {/* --- brand --- */}
      <Link href="/" className="flex items-center gap-2.5 pr-4 shrink-0 group">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M2 20 L8 8 L12 15 L16 5 L22 20" stroke="var(--color-amber)" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="leading-none">
          <div className="text-[13px] font-bold tracking-[0.2em] text-ink group-hover:text-amber transition-colors">
            MERIDIAN
          </div>
          <div className="label-xs mt-[3px]">TERMINAL</div>
        </div>
      </Link>

      {/* --- search --- */}
      <div ref={boxRef} className="relative flex-1 max-w-lg">
        <div className="flex items-center gap-2 bg-panel border border-hairline-bright focus-within:border-amber/60 h-7 px-2.5 transition-colors">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="var(--color-ink-3)" strokeWidth="2.5" />
            <path d="M20 20 L16 16" stroke="var(--color-ink-3)" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Enter ticker — AAPL, BTC, GOLD, SPX…"
            spellCheck={false}
            autoComplete="off"
            aria-label="Instrument search"
            className="flex-1 bg-transparent text-[11.5px] text-ink placeholder:text-ink-4 outline-none num tracking-wide"
          />
          <kbd
            className="label-xs border border-hairline px-1 py-0.5 hidden sm:block"
            title="Press / to focus. Enter opens the dossier; Shift+Enter goes straight to the trade call."
          >
            /
          </kbd>
        </div>

        {open && results.length > 0 && (
          <ul className="absolute top-full left-0 right-0 mt-1 bg-overlay border border-hairline-bright shadow-2xl shadow-black/60 max-h-80 overflow-y-auto">
            {results.map((r, i) => (
              <li
                key={r.symbol}
                onMouseEnter={() => setCursor(i)}
                className={`flex items-center gap-2 pr-2 transition-colors ${
                  i === cursor ? 'bg-raised' : 'hover:bg-raised/60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => go(r.symbol)}
                  className="flex-1 min-w-0 flex items-center gap-3 px-2.5 py-1.5 text-left"
                >
                  <span className="num text-[11.5px] font-bold text-amber w-24 shrink-0 truncate">{r.symbol}</span>
                  <span className="text-[11px] text-ink-2 flex-1 truncate">{r.name}</span>
                  <span className="label-xs shrink-0">{r.assetClass}</span>
                </button>
                <TradeButton symbol={r.symbol} size="xs" />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- function nav --- */}
      <nav className="hidden md:flex items-center gap-0 ml-4">
        {NAV.map((n) => {
          const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href.split('/').slice(0, 2).join('/'));
          return (
            <Link
              key={n.key}
              href={n.href}
              className={`flex items-baseline gap-1.5 px-2.5 h-11 border-b-2 transition-colors ${
                active
                  ? 'border-amber text-amber'
                  : 'border-transparent text-ink-3 hover:text-ink-2 hover:border-hairline-bright'
              }`}
            >
              <span className="label-xs opacity-70">{n.key}</span>
              <span className="text-[10px] font-bold tracking-[0.13em]">{n.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />
      <Clock />
    </header>
  );
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Render nothing until mounted — a server-rendered clock would hydrate
  // mismatched, and a terminal clock that flickers looks broken.
  if (!now) return <div className="w-[132px]" aria-hidden="true" />;

  const ny = now.toLocaleTimeString('en-US', {
    hour12: false, timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const status = sessionStatus(now);

  return (
    <div className="flex items-center gap-3 shrink-0 pl-3">
      <div className="text-right leading-none hidden sm:block">
        <div className="num text-[12px] text-ink tracking-wider">{ny}</div>
        <div className="label-xs mt-[3px]">NEW YORK</div>
      </div>
      <div
        className="flex items-center gap-1.5 px-2 py-1 border border-hairline bg-panel"
        title={status.detail}
      >
        <span className={`live-dot ${status.dot}`} />
        <span className="label-xs" style={{ color: status.colour }}>{status.label}</span>
      </div>
    </div>
  );
}

function sessionStatus(now: Date): { label: string; dot: string; colour: string; detail: string } {
  const nyString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const ny = new Date(nyString);
  const day = ny.getDay();
  const minutes = ny.getHours() * 60 + ny.getMinutes();

  if (day === 0 || day === 6) {
    return {
      label: 'WEEKEND', dot: 'cold', colour: 'var(--color-ink-3)',
      detail: 'US equity markets are closed. Crypto trades continuously.',
    };
  }
  if (minutes >= 240 && minutes < 570) {
    return {
      label: 'PRE-MKT', dot: 'sim', colour: 'var(--color-amber)',
      detail: 'Pre-market session (04:00-09:30 ET). Thin liquidity, wide spreads.',
    };
  }
  if (minutes >= 570 && minutes < 960) {
    return {
      label: 'OPEN', dot: '', colour: 'var(--color-long)',
      detail: 'Regular trading hours (09:30-16:00 ET).',
    };
  }
  if (minutes >= 960 && minutes < 1200) {
    return {
      label: 'AFTER', dot: 'sim', colour: 'var(--color-amber)',
      detail: 'After-hours session (16:00-20:00 ET). Thin liquidity.',
    };
  }
  return {
    label: 'CLOSED', dot: 'cold', colour: 'var(--color-ink-3)',
    detail: 'US equity markets are closed. Crypto trades continuously.',
  };
}
