import axios from 'axios';

const BASE_URL = 'https://api.binance.com';
const WS_URL = 'wss://stream.binance.com:9443/ws';

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function getKlines(symbol: string, interval: string, limit = 500): Promise<Kline[]> {
  if (limit <= 1000) {
    const response = await axios.get(`${BASE_URL}/api/v3/klines`, {
      params: { symbol, interval, limit }
    });

    return response.data.map((k: any[]) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } else {
    const allKlines: Kline[] = [];
    let endTime = Date.now();
    const requestsNeeded = Math.ceil(limit / 1000);

    for (let i = 0; i < requestsNeeded; i++) {
      const response = await axios.get(`${BASE_URL}/api/v3/klines`, {
        params: { symbol, interval, limit: 1000, endTime }
      });

      const klines = response.data.map((k: any[]) => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));

      allKlines.unshift(...klines);

      if (klines.length > 0) {
        endTime = klines[0].time - 1;
      }

      if (klines.length < 1000) break;
    }

    return allKlines.slice(-limit);
  }
}

export function createKlineWebSocket(symbol: string, interval: string, callback: (kline: Kline) => void): WebSocket {
  const ws = new WebSocket(`${WS_URL}/${symbol.toLowerCase()}@kline_${interval}`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.k) {
      callback({
        time: data.k.t,
        open: parseFloat(data.k.o),
        high: parseFloat(data.k.h),
        low: parseFloat(data.k.l),
        close: parseFloat(data.k.c),
        volume: parseFloat(data.k.v),
      });
    }
  };

  return ws;
}

export async function getTopPairs(): Promise<string[]> {
  const response = await axios.get(`${BASE_URL}/api/v3/ticker/24hr`);
  const usdtPairs = response.data
    .filter((t: any) => t.symbol.endsWith('USDT'))
    .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
  return usdtPairs.slice(0, 100).map((t: any) => t.symbol);
}

export async function getOlderKlines(symbol: string, interval: string, endTime: number, limit = 1000): Promise<Kline[]> {
  const response = await axios.get(`${BASE_URL}/api/v3/klines`, {
    params: { symbol, interval, limit, endTime }
  });

  return response.data.map((k: any[]) => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}
