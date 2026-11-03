import { useState } from 'react';

export interface Drawing {
  id: string;
  type: string;
  points: { x: number; y: number }[];
  color: string;
  lineWidth: number;
  fixed?: boolean;
  interval?: string;
  symbol?: string;
  rulerType?: 'both' | 'price' | 'date';
}

interface DrawingToolsProps {
  activeTool: string;
  onToolSelect: (tool: string) => void;
  isDrawingMode: boolean;
  onToggleDrawingMode: () => void;
  color: string;
  onColorChange: (color: string) => void;
  lineWidth: number;
  onLineWidthChange: (width: number) => void;
  drawings: Drawing[];
  onDeleteDrawing: (id: string) => void;
  onClearAll: () => void;
  selectedDrawingId: string | null;
  onSelectDrawing: (id: string | null) => void;
}

const Icons = {
  MousePointer2: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>,
  Minus: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/></svg>,
  VLine: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 4v16"/></svg>,
  PenLine: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>,
  MoveUpRight: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 5h6v6M19 5L5 19"/></svg>,
  Hash: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/></svg>,
  Square: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>,
  Channel: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 18L20 6M4 22L20 10"/></svg>,
  Maximize: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>,
  MoveVertical: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M8 6l4-4 4 4M8 18l4 4 4-4"/></svg>,
  MoveHorizontal: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12h20M6 8l-4 4 4 4M18 8l4 4-4 4"/></svg>,
  Trash2: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>,
  Pencil: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>,
  MousePointer: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>,
  // 👇 НОВАЯ ИКОНКА МАЛЕНЬКОЙ СТРЕЛОЧКИ 👇
  ChevronDown: () => <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
};

const MAIN_TOOLS = [
  { id: 'hline', icon: <Icons.Minus />, label: 'Горизонтальная линия' },
  { id: 'vline', icon: <Icons.VLine />, label: 'Вертикальная линия' },
  { id: 'line', icon: <Icons.PenLine />, label: 'Произвольная линия' },
  { id: 'ray', icon: <Icons.MoveUpRight />, label: 'Луч' },
  { id: 'rect', icon: <Icons.Square />, label: 'Имбаланс' },
  { id: 'rect-clean', icon: <Icons.Square />, label: 'Прямоугольник' },
];

const ADVANCED_TOOLS = [
  { id: 'fib', icon: <Icons.Hash />, label: 'Уровни Фибоначчи' },
  { id: 'channel', icon: <Icons.Channel />, label: 'Параллельный канал' },
];

const RULER_TOOLS = [
  { id: 'ruler', icon: <Icons.Maximize />, label: 'Дата и Цена' },
  { id: 'price-ruler', icon: <Icons.MoveVertical />, label: 'Только Цена' },
  { id: 'date-ruler', icon: <Icons.MoveHorizontal />, label: 'Только Дата' },
];

const COLORS = ['#2962ff', '#e91e63', '#ff9800', '#4caf50', '#9c27b0', '#00bcd4', '#ff5722', '#ffffff'];

export function DrawingTools({
  activeTool, onToolSelect, isDrawingMode, onToggleDrawingMode,
  color, onColorChange, lineWidth, onLineWidthChange,
  drawings, onDeleteDrawing, onClearAll, selectedDrawingId, onSelectDrawing,
}: DrawingToolsProps) {
  const [isMainToolMenuOpen, setIsMainToolMenuOpen] = useState(false);
  const [isAdvToolMenuOpen, setIsAdvToolMenuOpen] = useState(false);
  const [isRulerMenuOpen, setIsRulerMenuOpen] = useState(false);
  const [isColorMenuOpen, setIsColorMenuOpen] = useState(false);

  const selectedMainTool = MAIN_TOOLS.find(t => t.id === activeTool);
  const selectedAdvTool = ADVANCED_TOOLS.find(t => t.id === activeTool);
  const selectedRulerTool = RULER_TOOLS.find(t => t.id === activeTool);
  
  const isMainToolActive = MAIN_TOOLS.some(t => t.id === activeTool);
  const isAdvToolActive = ADVANCED_TOOLS.some(t => t.id === activeTool);
  const isRulerActive = RULER_TOOLS.some(t => t.id === activeTool);

  return (
    <div className="w-12 bg-[#131722] border-r border-[#2a2e39] flex flex-col items-center py-2 gap-1 shrink-0">
      {/* Drawing Mode Toggle */}
      <button
        onClick={onToggleDrawingMode}
        className={`w-10 h-10 flex items-center justify-center rounded text-sm transition-colors mb-2 ${
          isDrawingMode ? 'bg-green-600 shadow-lg shadow-green-600/30 text-white' : 'bg-[#2a2e39] hover:bg-[#363a45] text-gray-400'
        }`}
        title={isDrawingMode ? 'Режим рисования ВКЛ' : 'Режим рисования ВЫКЛ'}
      >
        {isDrawingMode ? <Icons.Pencil /> : <Icons.MousePointer />}
      </button>

      {isDrawingMode && (
        <>
          <button
            onClick={() => { onToolSelect('cursor'); setIsMainToolMenuOpen(false); setIsAdvToolMenuOpen(false); setIsRulerMenuOpen(false); }}
            className={`w-10 h-10 flex items-center justify-center rounded text-sm transition-colors ${
              activeTool === 'cursor' ? 'bg-blue-600 shadow-lg shadow-blue-600/30 text-white' : 'bg-[#2a2e39] hover:bg-[#363a45] text-gray-400'
            }`}
            title="Курсор (выбор)"
          >
            <Icons.MousePointer2 />
          </button>

          {/* 👇 ДОБАВЛЕН RELATIVE И СТРЕЛОЧКА В УГОЛ 👇 */}
          <div className="relative w-full flex justify-center mt-1">
            <button
              onClick={() => { setIsMainToolMenuOpen(!isMainToolMenuOpen); setIsAdvToolMenuOpen(false); setIsRulerMenuOpen(false); }}
              className={`relative w-10 h-10 flex items-center justify-center rounded text-sm transition-colors ${
                isMainToolActive ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-[#2a2e39] hover:bg-[#363a45] text-gray-400'
              }`}
              title={selectedMainTool?.label || 'Основные инструменты'}
            >
              {selectedMainTool ? selectedMainTool.icon : <Icons.Minus />}
              <div className="absolute bottom-1 right-1 opacity-50">
                <Icons.ChevronDown />
              </div>
            </button>
            {isMainToolMenuOpen && (
              <div className="absolute left-full top-0 ml-2 bg-[#1e222d] border border-[#2a2e39] rounded-lg shadow-xl z-50 min-w-[180px]">
                <div className="py-1">
                  {MAIN_TOOLS.map(tool => (
                    <button
                      key={tool.id} onClick={() => { onToolSelect(tool.id); setIsMainToolMenuOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-[#2a2e39] transition-colors flex items-center gap-3 ${activeTool === tool.id ? 'bg-blue-600/20 text-blue-400' : 'text-gray-300'}`}
                    >
                      {tool.icon}<span>{tool.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative w-full flex justify-center mt-1">
            <button
              onClick={() => { setIsAdvToolMenuOpen(!isAdvToolMenuOpen); setIsMainToolMenuOpen(false); setIsRulerMenuOpen(false); }}
              className={`relative w-10 h-10 flex items-center justify-center rounded text-sm transition-colors ${
                isAdvToolActive ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-[#2a2e39] hover:bg-[#363a45] text-gray-400'
              }`}
              title={selectedAdvTool?.label || 'Продвинутые инструменты'}
            >
              {selectedAdvTool ? selectedAdvTool.icon : <Icons.Channel />}
              <div className="absolute bottom-1 right-1 opacity-50">
                <Icons.ChevronDown />
              </div>
            </button>
            {isAdvToolMenuOpen && (
              <div className="absolute left-full top-0 ml-2 bg-[#1e222d] border border-[#2a2e39] rounded-lg shadow-xl z-50 min-w-[180px]">
                <div className="py-1">
                  {ADVANCED_TOOLS.map(tool => (
                    <button
                      key={tool.id} onClick={() => { onToolSelect(tool.id); setIsAdvToolMenuOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-[#2a2e39] transition-colors flex items-center gap-3 ${activeTool === tool.id ? 'bg-purple-600/20 text-purple-400' : 'text-gray-300'}`}
                    >
                      {tool.icon}<span>{tool.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative w-full flex justify-center mt-1">
            <button
              onClick={() => { setIsRulerMenuOpen(!isRulerMenuOpen); setIsMainToolMenuOpen(false); setIsAdvToolMenuOpen(false); }}
              className={`relative w-10 h-10 flex items-center justify-center rounded text-sm transition-colors ${
                isRulerActive ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-[#2a2e39] hover:bg-[#363a45] text-gray-400'
              }`}
              title={selectedRulerTool?.label || 'Измеритель'}
            >
              {selectedRulerTool ? selectedRulerTool.icon : <Icons.Maximize />}
              <div className="absolute bottom-1 right-1 opacity-50">
                <Icons.ChevronDown />
              </div>
            </button>
            {isRulerMenuOpen && (
              <div className="absolute left-full top-0 ml-2 bg-[#1e222d] border border-[#2a2e39] rounded-lg shadow-xl z-50 min-w-[180px]">
                <div className="py-1">
                  {RULER_TOOLS.map(tool => (
                    <button
                      key={tool.id} onClick={() => { onToolSelect(tool.id); setIsRulerMenuOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-[#2a2e39] transition-colors flex items-center gap-3 ${activeTool === tool.id ? 'bg-orange-600/20 text-orange-400' : 'text-gray-300'}`}
                    >
                      {tool.icon}<span>{tool.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="w-8 h-px bg-[#2a2e39] my-2" />

          <div className="relative w-full flex justify-center">
            <button
              onClick={() => setIsColorMenuOpen(!isColorMenuOpen)}
              className="relative w-10 h-10 flex items-center justify-center rounded bg-[#2a2e39] hover:bg-[#363a45] transition-colors"
              title="Выбрать цвет"
            >
              <div className="w-5 h-5 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: color }} />
              <div className="absolute bottom-1 right-1 opacity-50 text-gray-400">
                <Icons.ChevronDown />
              </div>
            </button>
            {isColorMenuOpen && (
              <div className="absolute left-full top-0 ml-2 bg-[#1e222d] border border-[#2a2e39] rounded-lg shadow-xl z-50 p-2 grid grid-cols-4 gap-2 w-max">
                {COLORS.map(c => (
                  <button
                    key={c} onClick={() => { onColorChange(c); setIsColorMenuOpen(false); }}
                    className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-110' : 'border-transparent hover:scale-110'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="w-8 h-px bg-[#2a2e39] my-2" />

          <div className="flex flex-col items-center gap-1" title="Толщина линии">
            <input
              type="range" min={1} max={4} step={1} value={lineWidth}
              onChange={(e) => onLineWidthChange(Number(e.target.value))}
              className="w-10 accent-blue-500 cursor-pointer"
            />
            <span className="text-[10px] text-gray-400">{lineWidth}px</span>
          </div>

          <div className="w-8 h-px bg-[#2a2e39] my-2" />

          {drawings.length > 0 && (
            <>
              <div className="text-[10px] text-gray-400 mb-1">{drawings.length} рис.</div>
              <button
                onClick={onClearAll}
                className="w-10 h-8 flex items-center justify-center rounded text-xs hover:bg-red-600/20 hover:text-red-400 transition-colors mt-1 text-gray-400"
                title="Удалить все"
              >
                <Icons.Trash2 />
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}