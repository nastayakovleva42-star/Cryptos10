import { useEffect } from 'react';
import { useChartStore } from './store/chartStore';
import { ChartComponent } from './components/ChartComponent';
import { SymbolSelector } from './components/SymbolSelector';
import { IndicatorPanel } from './components/IndicatorPanel';

function App() {
  const { loadState } = useChartStore();

  useEffect(() => {
    loadState();
  }, [loadState]);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0a0e17] text-white overflow-hidden">
      {/* Header */}
      <header className="h-12 bg-[#131722] border-b border-[#2a2e39] flex items-center px-4 gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-purple-600 rounded flex items-center justify-center text-xs font-bold">
            C
          </div>
          <span className="font-bold text-sm">CryptoChart Pro</span>
        </div>

        <SymbolSelector />

        <IndicatorPanel />

        <div className="flex-1" />

        <div className="text-xs text-gray-500">
          Базовая версия - график работает
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chart Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <ChartComponent />
        </div>
      </div>

      {/* Status Bar */}
      <footer className="h-6 bg-[#131722] border-t border-[#2a2e39] flex items-center px-3 text-[10px] text-gray-500 gap-4 shrink-0">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
          Binance Connected
        </span>
        <span>CryptoChart Pro v2.0 - Базовая версия</span>
      </footer>
    </div>
  );
}

export default App;
