import { useEffect, useRef, useState, useCallback } from 'react';
import { useChartStore } from '../store/chartStore';

export interface Liquidation {
  id: string;
  symbol: string;
  exchange: 'Binance';
  side: 'long' | 'short';
  price: number;
  quantity: number;
  value: number;
  time: number;
}

// Нормализация стороны: Binance инвертирует (SELL = Long ликвидирован)
function normalizeSide(rawSide: string): 'long' | 'short' {
  return rawSide === 'SELL' ? 'long' : 'short';
}

export function useLiquidations() {
  const { trackedSymbols, liquidationSettings } = useChartStore();
  const [liquidations, setLiquidations] = useState<Liquidation[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  
  const wsRefs = useRef<Map<string, WebSocket>>(new Map());
  const reconnectTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const lastSoundTimeRef = useRef<number>(0);
  
  // Храним настройки в ref, чтобы не пересоздавать WebSocket
  const settingsRef = useRef(liquidationSettings);
  const trackedRef = useRef(trackedSymbols);
  const connectionTimeRef = useRef<Map<string, number>>(new Map());

  // Обновляем ref при изменении (без пересоздания эффекта)
  useEffect(() => {
    settingsRef.current = liquidationSettings;
  });

  useEffect(() => {
    trackedRef.current = trackedSymbols;
  });

  const playSound = useCallback((side: 'long' | 'short') => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      // Разный тон для Long и Short
      oscillator.frequency.value = side === 'long' ? 800 : 600;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.15);
    } catch (err) {
      console.error('Error playing sound:', err);
    }
  }, []);

  const addLiquidation = useCallback((liq: Liquidation) => {
    const currentSettings = settingsRef.current;
    
    // Проверяем дубликаты
    setLiquidations(prev => {
      const exists = prev.some(l => l.id === liq.id);
      if (exists) return prev;
      
      const newLiqs = [liq, ...prev];
      return newLiqs.slice(0, currentSettings.maxItems);
    });

    if (currentSettings.soundEnabled) {
      const now = Date.now();
      if (now - lastSoundTimeRef.current > 1000) {
        playSound(liq.side);
        lastSoundTimeRef.current = now;
      }
    }
  }, [playSound]);

  const connectToSymbol = useCallback((symbol: string) => {
    // Очищаем предыдущее подключение для этого символа
    const oldWs = wsRefs.current.get(symbol);
    if (oldWs) {
      oldWs.close();
      wsRefs.current.delete(symbol);
    }
    
    const oldTimeout = reconnectTimeoutsRef.current.get(symbol);
    if (oldTimeout) {
      clearTimeout(oldTimeout);
      reconnectTimeoutsRef.current.delete(symbol);
    }

    console.log(`🔌 Подключение к Binance WebSocket для ${symbol}...`);
    
    // Используем эндпоинт для конкретного символа (работает стабильно)
    const wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@forceOrder`;
    const ws = new WebSocket(wsUrl);
    wsRefs.current.set(symbol, ws);
    
    // Запоминаем время подключения (для фильтрации старых данных)
    connectionTimeRef.current.set(symbol, Date.now());

    ws.onopen = () => {
      console.log(`✅ Binance Liquidations WebSocket connected для ${symbol}`);
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Логируем сырые данные для отладки (первые 5 сообщений)
        if (!wsRefs.current.get(symbol)?.['logged']) {
          console.log(`📩 Raw data для ${symbol}:`, JSON.stringify(data));
          wsRefs.current.get(symbol)['logged'] = true;
        }
        
        const order = data.o || data;
        const sym = order.s || symbol;
        
        if (!trackedRef.current.includes(sym)) return;
        
        const currentSettings = settingsRef.current;
        const threshold = currentSettings.thresholds[sym] || 800000;
        
        // Парсим с защитой от NaN
        const price = parseFloat(order.p);
        const quantity = parseFloat(order.q);
        const time = order.T || Date.now();
        
        if (isNaN(price) || isNaN(quantity) || price <= 0 || quantity <= 0) {
          console.warn(`⚠️ Invalid data для ${symbol}:`, { price: order.p, quantity: order.q });
          return;
        }
        
        const value = price * quantity;
        
        if (value < threshold) return;
        
        // Фильтруем старые ликвидации (старше 30 секунд от момента подключения)
        const connectionTime = connectionTimeRef.current.get(symbol) || 0;
        if (time < connectionTime - 30000) {
          console.log(`⏭️ Пропущена старая ликвидация для ${symbol}:`, time);
          return;
        }
        
        addLiquidation({
          id: `binance-${time}-${sym}-${price}-${quantity}`,
          symbol: sym,
          exchange: 'Binance',
          side: normalizeSide(order.S),
          price,
          quantity,
          value,
          time,
        });
      } catch (err) {
        console.error(`Binance parse error для ${symbol}:`, err);
      }
    };

    ws.onclose = (event) => {
      console.log(`❌ Binance Liquidations WebSocket disconnected для ${symbol}`, {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      });
      setIsConnected(false);
      wsRefs.current.delete(symbol);
      
      // Переподключение через 5 секунд
      const timeout = setTimeout(() => {
        connectToSymbol(symbol);
      }, 5000);
      reconnectTimeoutsRef.current.set(symbol, timeout);
    };

    ws.onerror = (error) => {
      console.error(`❌ WebSocket error для ${symbol}:`, error);
    };
  }, [addLiquidation]);

  // Управление подключениями при изменении trackedSymbols
  useEffect(() => {
    // Закрываем подключения для символов, которые больше не отслеживаются
    wsRefs.current.forEach((ws, symbol) => {
      if (!trackedSymbols.includes(symbol)) {
        ws.close();
        wsRefs.current.delete(symbol);
        const timeout = reconnectTimeoutsRef.current.get(symbol);
        if (timeout) {
          clearTimeout(timeout);
          reconnectTimeoutsRef.current.delete(symbol);
        }
      }
    });
    
    // Подключаемся к новым символам
    trackedSymbols.forEach(symbol => {
      if (!wsRefs.current.has(symbol)) {
        connectToSymbol(symbol);
      }
    });
    
    // Если нет отслеживаемых символов
    if (trackedSymbols.length === 0) {
      setIsConnected(false);
    }

    return () => {
      // Очистка при размонтировании
      wsRefs.current.forEach((ws) => {
        ws.close();
      });
      wsRefs.current.clear();
      reconnectTimeoutsRef.current.forEach((timeout) => {
        clearTimeout(timeout);
      });
      reconnectTimeoutsRef.current.clear();
    };
  }, [trackedSymbols, connectToSymbol]);

  return {
    liquidations,
    isConnected,
  };
}