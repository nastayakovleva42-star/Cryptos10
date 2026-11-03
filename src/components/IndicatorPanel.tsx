import { useState } from 'react';
import { useChartStore } from '../store/chartStore';

export function IndicatorPanel() {
  const [isOpen, setIsOpen] = useState(false);
  
  // ✅ ДОБАВЛЕНО: isMacdVisible и toggleMacd
  const { isRsiVisible, toggleRsi, isMacdVisible, toggleMacd } = useChartStore();

  return (
    <div className="relative">
      {/* Button to open panel */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-[#2a2e39] hover:bg-[#363a45] rounded text-sm transition-colors"
      >
        <span>📊</span>
        <span>Индикаторы</span>
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-[#131722] border border-[#2a2e39] rounded-lg shadow-xl z-50">
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-300">Индикаторы</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-500 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Search input */}
            <div className="mb-4">
              <input
                type="text"
                placeholder="Поиск индикаторов..."
                className="w-full px-3 py-2 bg-[#1e222d] border border-[#2a2e39] rounded text-sm outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Categories */}
            <div className="space-y-3 max-h-96 overflow-y-auto">
              
              {/* ✅ ИСПРАВЛЕНО: Трендовые индикаторы */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                  Трендовые индикаторы
                </h4>
                <div className="space-y-1">
                  {/* КНОПКА ВКЛЮЧЕНИЯ MACD */}
                  <button
                    onClick={toggleMacd}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors flex items-center justify-between ${
                      isMacdVisible 
                        ? 'bg-orange-600/20 text-orange-400' 
                        : 'hover:bg-[#2a2e39] text-gray-300'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-lg">📈</span>
                      MACD (Схождение/расхождение)
                    </span>
                    {isMacdVisible && (
                      <span className="text-[10px] bg-orange-600 text-white px-1.5 py-0.5 rounded font-bold">ВКЛ</span>
                    )}
                  </button>
                </div>
              </div>

              {/* Oscillators */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                  Осцилляторы
                </h4>
                <div className="space-y-1">
                  <button
                    onClick={toggleRsi}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors flex items-center justify-between ${
                      isRsiVisible 
                        ? 'bg-blue-600/20 text-blue-400' 
                        : 'hover:bg-[#2a2e39] text-gray-300'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-lg">📉</span>
                      RSI (Индекс отн. силы)
                    </span>
                    {isRsiVisible && (
                      <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-bold">ВКЛ</span>
                    )}
                  </button>
                </div>
              </div>

              {/* Volume Indicators */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                  Индикаторы объёма
                </h4>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500 italic py-2">
                    Пусто - добавьте индикаторы
                  </div>
                </div>
              </div>

              {/* Volatility */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                  Волатильность
                </h4>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500 italic py-2">
                    Пусто - добавьте индикаторы
                  </div>
                </div>
              </div>

              {/* Custom */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                  Пользовательские
                </h4>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500 italic py-2">
                    Пусто - добавьте индикаторы
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-4 pt-4 border-t border-[#2a2e39]">
              <div className="text-xs text-gray-500 text-center">
                Индикаторы будут добавлены в следующих версиях
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}