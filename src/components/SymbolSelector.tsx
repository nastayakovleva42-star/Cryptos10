import { useState, useEffect, useRef } from 'react';
import { useChartStore } from '../store/chartStore';
import { getTopPairs } from '../services/binanceApi';

export function SymbolSelector() {
  const { 
    symbol, setSymbol, 
    interval, setInterval: setChartInterval, 
    trackedSymbols, toggleTrackedSymbol 
  } = useChartStore();
  
  const [isOpen, setIsOpen] = useState(false);
  const [isIntervalOpen, setIsIntervalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pairs, setPairs] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const intervalDropdownRef = useRef<HTMLDivElement>(null);

  const intervals = [
    '1m', '3m', '5m', '15m', '30m',
    '1h', '2h', '4h', '6h', '8h', '12h',
    '1d', '3d', '1w', '1M'
  ];

  useEffect(() => {
    getTopPairs().then(setPairs).catch(() => {
      setPairs(['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT']);
    });
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
      if (intervalDropdownRef.current && !intervalDropdownRef.current.contains(e.target as Node)) {
        setIsIntervalOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredPairs = pairs.filter(p => p.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex items-center gap-2">
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-1.5 bg-[#2a2e39] rounded hover:bg-[#363a45] transition-colors"
        >
          <span className="font-semibold text-sm">{symbol}</span>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-[#1e222d] border border-[#2a2e39] rounded-lg shadow-xl z-50">
            <div className="p-2">
              <input
                type="text"
                placeholder="Поиск пары..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-1.5 bg-[#2a2e39] rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filteredPairs.map(pair => (
                <div
                  key={pair}
                  className={`flex items-center justify-between px-3 py-1.5 text-sm hover:bg-[#2a2e39] transition-colors ${pair === symbol ? 'bg-blue-600/20 text-blue-400' : ''}`}
                >
                  <button
                    onClick={() => { setSymbol(pair); setIsOpen(false); setSearch(''); }}
                    className="flex-1 text-left font-medium"
                  >
                    {pair}
                  </button>
                  <input
                    type="checkbox"
                    checked={trackedSymbols.includes(pair)}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleTrackedSymbol(pair);
                    }}
                    className="w-4 h-4 cursor-pointer accent-blue-500 ml-2"
                    title="Собирать стакан 24/7"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="relative" ref={intervalDropdownRef}>
        <button
          onClick={() => setIsIntervalOpen(!isIntervalOpen)}
          className="flex items-center gap-2 px-3 py-1.5 bg-[#2a2e39] rounded hover:bg-[#363a45] transition-colors"
        >
          <span className="font-semibold text-sm">{interval}</span>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isIntervalOpen && (
          <div className="absolute top-full left-0 mt-1 w-32 bg-[#1e222d] border border-[#2a2e39] rounded-lg shadow-xl z-50">
            <div className="max-h-64 overflow-y-auto py-1">
              {intervals.map(i => (
                <button
                  key={i}
                  onClick={() => { setChartInterval(i); setIsIntervalOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-[#2a2e39] transition-colors ${i === interval ? 'bg-blue-600/20 text-blue-400' : ''}`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}