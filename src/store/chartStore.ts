import { create } from 'zustand';

interface ChartState {
  symbol: string;
  interval: string;
  trackedSymbols: string[];
  isRsiVisible: boolean;
  isMacdVisible: boolean;
  
  // Настройки ликвидаций
  liquidationSettings: {
    soundEnabled: boolean;
    maxItems: number;
    thresholds: Record<string, number>;
  };
  
  setSymbol: (symbol: string) => void;
  setInterval: (interval: string) => void;
  toggleTrackedSymbol: (symbol: string) => void;
  toggleRsi: () => void;
  toggleMacd: () => void;
  setLiquidationSettings: (settings: Partial<ChartState['liquidationSettings']>) => void;
  setLiquidationThreshold: (symbol: string, threshold: number) => void;
  loadState: () => void;
}

export const useChartStore = create<ChartState>((set) => ({
  symbol: 'BTCUSDT',
  interval: '1h',
  trackedSymbols: ['BTCUSDT'],
  isRsiVisible: false,
  isMacdVisible: false,
  
  liquidationSettings: {
    soundEnabled: true,
    maxItems: 15,
    thresholds: {
      'BTCUSDT': 800000,
      'ETHUSDT': 200000,
      'SOLUSDT': 100000,
    },
  },
  
  setSymbol: (symbol) => set({ symbol }),
  setInterval: (interval) => set({ interval }),
  toggleTrackedSymbol: (symbol) => set((state) => ({
    trackedSymbols: state.trackedSymbols.includes(symbol)
      ? state.trackedSymbols.filter((s) => s !== symbol)
      : [...state.trackedSymbols, symbol]
  })),
  toggleRsi: () => set((state) => ({ isRsiVisible: !state.isRsiVisible })),
  toggleMacd: () => set((state) => ({ isMacdVisible: !state.isMacdVisible })),
  
  setLiquidationSettings: (settings) => set((state) => ({
    liquidationSettings: { ...state.liquidationSettings, ...settings }
  })),
  
  setLiquidationThreshold: (symbol, threshold) => set((state) => ({
    liquidationSettings: {
      ...state.liquidationSettings,
      thresholds: { ...state.liquidationSettings.thresholds, [symbol]: threshold }
    }
  })),
  
  loadState: () => {
    const savedSymbol = localStorage.getItem('chartSymbol');
    const savedInterval = localStorage.getItem('chartInterval');
    if (savedSymbol) set({ symbol: savedSymbol });
    if (savedInterval) set({ interval: savedInterval });
  },
}));