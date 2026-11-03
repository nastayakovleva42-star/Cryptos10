import { useEffect, useState, useRef } from 'react';

export function useOrderBook(trackedSymbols: string[]) {
  const [ratios, setRatios] = useState<Record<string, { '2.5': number, '5': number, '10': number, '25': number }>>({});
  
  const statesRef = useRef<Record<string, {
    bids: Map<string, number>,
    asks: Map<string, number>,
    lastUpdateId: number,
    buffer: any[],
    isSynced: boolean
  }>>({});

  useEffect(() => {
    if (!trackedSymbols || !Array.isArray(trackedSymbols) || trackedSymbols.length === 0) return;

    let isCancelled = false;
    const streams = trackedSymbols.map(sym => `${sym.toLowerCase()}@depth@1000ms`).join('/');
    const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;
    let ws: WebSocket | null = null;

    const getPriceStep = (price: number) => {
      if (price > 10000) return 10;
      if (price > 1000) return 1;
      if (price > 100) return 0.1;
      if (price > 1) return 0.01;
      return 0.0001;
    };

    const calculateRatioForRange = (bids: any[], asks: any[], midPrice: number, rangePercent: number, priceStep: number) => {
      const aggregate = (levels: any[], isBids: boolean) => {
        const map = new Map<number, number>();
        levels.forEach(l => {
          const aggPrice = Math.floor(l.price / priceStep) * priceStep;
          map.set(aggPrice, (map.get(aggPrice) || 0) + l.qty);
        });
        return Array.from(map.entries()).map(([price, qty]) => ({ price, qty })).sort((a, b) => isBids ? b.price - a.price : a.price - b.price);
      };

      const aggBids = aggregate(bids, true);
      const aggAsks = aggregate(asks, false);

      const lowerBound = midPrice * (1 - rangePercent / 100);
      const upperBound = midPrice * (1 + rangePercent / 100);

      const totalBids = aggBids.filter(b => b.price >= lowerBound).reduce((s, b) => s + b.qty, 0);
      const totalAsks = aggAsks.filter(a => a.price <= upperBound).reduce((s, a) => s + a.qty, 0);

      if (totalBids + totalAsks === 0) return 0;
      return ((totalBids - totalAsks) / (totalBids + totalAsks)) * 100;
    };

    const calculateAndSetRatio = (sym: string) => {
      const state = statesRef.current[sym];
      if (!state || state.bids.size === 0 || state.asks.size === 0) return;

      const bids = Array.from(state.bids.entries()).map(([p, q]) => ({ price: parseFloat(p), qty: q }));
      const asks = Array.from(state.asks.entries()).map(([p, q]) => ({ price: parseFloat(p), qty: q }));

      if (bids.length === 0 || asks.length === 0) return;
      bids.sort((a, b) => b.price - a.price);
      asks.sort((a, b) => a.price - b.price);

      const midPrice = (bids[0].price + asks[0].price) / 2;
      const baseStep = getPriceStep(midPrice);

      // Считаем все 4 диапазона. Для глубоких используем более крупный шаг (чтобы не грузить браузер)
      const r25 = calculateRatioForRange(bids, asks, midPrice, 2.5, baseStep);
      const r5 = calculateRatioForRange(bids, asks, midPrice, 5.0, baseStep * 2);
      const r10 = calculateRatioForRange(bids, asks, midPrice, 10.0, baseStep * 5);
      const r25p = calculateRatioForRange(bids, asks, midPrice, 25.0, baseStep * 10);

      setRatios(prev => ({ 
        ...prev, 
        [sym]: { 
          '2.5': Math.round(r25 * 100) / 100, 
          '5': Math.round(r5 * 100) / 100,
          '10': Math.round(r10 * 100) / 100,
          '25': Math.round(r25p * 100) / 100
        } 
      }));
    };

    const applyUpdate = (sym: string, data: any) => {
      const state = statesRef.current[sym];
      if (!state) return;
      if (data.b) data.b.forEach(([p, q]: [string, string]) => {
        if (parseFloat(q) === 0) state.bids.delete(p); else state.bids.set(p, parseFloat(q));
      });
      if (data.a) data.a.forEach(([p, q]: [string, string]) => {
        if (parseFloat(q) === 0) state.asks.delete(p); else state.asks.set(p, parseFloat(q));
      });
      calculateAndSetRatio(sym);
    };

    const init = async () => {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          const sym = message.stream.split('@')[0].toUpperCase();
          const data = message.data;
          const state = statesRef.current[sym];
          if (!state) return;
          if (!state.isSynced) state.buffer.push(data);
          else applyUpdate(sym, data);
        };

        const snapshots = await Promise.all(trackedSymbols.map(async (sym) => {
          const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=5000`);
          return { sym, data: await res.json() };
        }));

        if (isCancelled) return;

        snapshots.forEach(({ sym, data }) => {
          if (!data.bids || !data.asks) return;
          const bids = new Map<string, number>();
          const asks = new Map<string, number>();
          data.bids.forEach(([p, q]: [string, string]) => bids.set(p, parseFloat(q)));
          data.asks.forEach(([p, q]: [string, string]) => asks.set(p, parseFloat(q)));
          statesRef.current[sym] = { bids, asks, lastUpdateId: data.lastUpdateId, buffer: [], isSynced: true };
        });

        trackedSymbols.forEach(sym => {
          const state = statesRef.current[sym];
          if (!state) return;
          state.buffer.forEach(update => applyUpdate(sym, update));
          state.buffer = [];
          calculateAndSetRatio(sym);
        });
      } catch (err) { console.error('Multi Order book error:', err); }
    };

    init();
    return () => { isCancelled = true; if (ws) ws.close(); };
  }, [trackedSymbols]);

  // Сохранение истории
  const latestRatiosRef = useRef<Record<string, { '2.5': number, '5': number, '10': number, '25': number }>>({});
  useEffect(() => { latestRatiosRef.current = ratios; }, [ratios]);

  useEffect(() => {
    const SAVE_INTERVAL = 300000; // 5 минут
    const saveHistory = () => {
      const dataToSave = latestRatiosRef.current;
      if (Object.keys(dataToSave).length === 0) return;

      const now = Math.floor(Date.now() / 1000);
      const savedHistoryStr = localStorage.getItem('obd_history');
      let savedHistory = savedHistoryStr ? JSON.parse(savedHistoryStr) : {};

      Object.keys(dataToSave).forEach(sym => {
        if (!savedHistory[sym]) savedHistory[sym] = { '2.5': [], '5': [], '10': [], '25': [] };
        if (Array.isArray(savedHistory[sym])) {
          savedHistory[sym] = { '2.5': savedHistory[sym], '5': [], '10': [], '25': [] };
        }

        ['2.5', '5', '10', '25'].forEach(range => {
          const val = dataToSave[sym][range as keyof typeof dataToSave[string]];
          if (typeof val === 'number' && !isNaN(val)) {
            if (!savedHistory[sym][range]) savedHistory[sym][range] = [];
            savedHistory[sym][range].push({ time: now, value: val });
            if (savedHistory[sym][range].length > 5000) {
              savedHistory[sym][range] = savedHistory[sym][range].slice(-5000);
            }
          }
        });
      });

      localStorage.setItem('obd_history', JSON.stringify(savedHistory));
    };

    const intervalId = setInterval(saveHistory, SAVE_INTERVAL);
    return () => clearInterval(intervalId);
  }, []);

  return { ratios };
}