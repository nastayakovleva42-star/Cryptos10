import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, IChartApi, ISeriesApi, Time, MismatchDirection, Logical, LineStyle } from 'lightweight-charts';
import { getKlines, getOlderKlines, createKlineWebSocket } from '../services/binanceApi';
import { useChartStore } from '../store/chartStore';
import { DrawingTools, Drawing } from './DrawingTools';
import { useOrderBook } from '../hooks/useOrderBook';
import { LiquidationsPanel } from './LiquidationsPanel';

const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600,
  '4h': 14400, '1d': 86400, '1w': 604800,
};

function intervalToSeconds(interval: string): number {
  return INTERVAL_SECONDS[interval] ?? 3600;
}

function snapTimeToKlines(time: number, newKlines: { time: number }[]) {
  const firstTime = newKlines[0].time / 1000;
  const lastTime = newKlines[newKlines.length - 1].time / 1000;
  if (time < firstTime || time > lastTime) return time;

  let closestCandle = newKlines[0];
  let minDistance = Math.abs(time - firstTime);

  for (const candle of newKlines) {
    const candleTime = candle.time / 1000;
    const distance = Math.abs(time - candleTime);
    if (distance < minDistance) {
      minDistance = distance;
      closestCandle = candle;
    }
  }
  return closestCandle.time / 1000;
}

function remapTimeForIntervalChange(
  time: number, newKlines: { time: number }[], oldLastTime: number | null, oldInterval: string | undefined, newInterval: string,
): number {
  const lastTime = newKlines[newKlines.length - 1].time / 1000;
  const firstTime = newKlines[0].time / 1000;
  const isFuture = time > lastTime || (oldLastTime !== null && time > oldLastTime);

  if (isFuture && oldInterval && oldInterval !== newInterval) {
    const oldDur = intervalToSeconds(oldInterval);
    const newDur = intervalToSeconds(newInterval);
    const basis = oldLastTime ?? lastTime;
    const offsetBars = (time - basis) / oldDur;
    return lastTime + offsetBars * newDur;
  }
  if (time < firstTime || time > lastTime) return time;
  return snapTimeToKlines(time, newKlines);
}

// ЗАМЕНИТЕ старую функцию calculateRSI на эту:
function calculateRSI(data: any[], period: number = 14) {
  const rsiData: { time: any; value: number }[] = [];
  
  if (data.length < period + 1) {
    for (let i = 0; i < data.length; i++) {
      rsiData.push({ time: data[i].time, value: 50 });
    }
    return rsiData;
  }

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  let rs = avgGain / (avgLoss || 1);
  let rsi = 100 - 100 / (1 + rs);

  // ГЛАВНОЕ ИСПРАВЛЕНИЕ: заполняем начальные периоды, чтобы длина 
  // массива rsiData ТОЧНО совпадала с длиной массива data.
  for (let i = 0; i <= period; i++) {
    rsiData.push({ time: data[i].time, value: rsi });
  }

  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgGain / (avgLoss || 1);
    rsi = 100 - 100 / (1 + rs);
    rsiData.push({ time: data[i].time, value: rsi });
  }
  return rsiData;
}

function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  let prevEma = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      ema.push(prevEma);
    } else if (i === period - 1) {
      ema.push(prevEma);
    } else {
      prevEma = (data[i] - prevEma) * multiplier + prevEma;
      ema.push(prevEma);
    }
  }
  return ema;
}

function calculateMACD(data: any[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9) {
  const macdData: { time: any; value: number }[] = [];
  const signalData: { time: any; value: number }[] = [];
  const histogramData: { time: any; value: number; color: string }[] = [];

  if (data.length < slowPeriod + signalPeriod) {
    for (let i = 0; i < data.length; i++) {
      macdData.push({ time: data[i].time, value: 0 });
      signalData.push({ time: data[i].time, value: 0 });
      histogramData.push({ time: data[i].time, value: 0, color: '#26a69a' });
    }
    return { macdData, signalData, histogramData };
  }

  const closes = data.map(d => d.close);
  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);
  const macdLine = emaFast.map((fast, i) => fast - emaSlow[i]);
  const signalLine = calculateEMA(macdLine, signalPeriod);

  for (let i = 0; i < data.length; i++) {
    const macd = macdLine[i];
    const signal = signalLine[i];
    const histogram = macd - signal;
    macdData.push({ time: data[i].time, value: macd });
    signalData.push({ time: data[i].time, value: signal });
    histogramData.push({ 
      time: data[i].time, 
      value: histogram, 
      color: histogram >= 0 ? '#26a69a' : '#ef5350' 
    });
  }

  return { macdData, signalData, histogramData };
}


export function ChartComponent() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const obdContainerRef = useRef<HTMLDivElement>(null);
  
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const macdContainerRef = useRef<HTMLDivElement>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const macdSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSignalSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistogramSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [activeTool, setActiveTool] = useState('hline');
  const [color, setColor] = useState('#2962ff');
  const [lineWidth, setLineWidth] = useState(2);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [candlesLoaded, setCandlesLoaded] = useState(false);
  const isRulerMode = ['ruler', 'price-ruler', 'date-ruler'].includes(activeTool);
  
  const [obdHeight, setObdHeight] = useState(110);
  const [rsiHeight, setRsiHeight] = useState(150);

  const [macdHeight, setMacdHeight] = useState(180);
  const isMacdResizingRef = useRef(false);
  const macdStartYRef = useRef(0);
  const macdStartHeightRef = useRef(0);


  
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  
  const isRsiResizingRef = useRef(false);
  const rsiStartYRef = useRef(0);
  const rsiStartHeightRef = useRef(0);

  const isDrawingRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const middlePointRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const draggingPointIndexRef = useRef<number | null>(null);
  const selectedDrawingIdRef = useRef<string | null>(null);
  const drawingsRef = useRef<Drawing[]>([]);
  const isMovingDrawingRef = useRef(false);
  const moveStartPosRef = useRef<{ x: number, y: number } | null>(null);
  const moveInitialPointsRef = useRef<{ x: number, y: number }[] | null>(null);
  
  useEffect(() => { selectedDrawingIdRef.current = selectedDrawingId; }, [selectedDrawingId]);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);

  const { symbol, interval, trackedSymbols, isRsiVisible, isMacdVisible } = useChartStore();
  const { ratios } = useOrderBook(trackedSymbols || [symbol]);
  const currentRatio25 = ratios[symbol]?.['2.5'] || 0;
  const currentRatio5 = ratios[symbol]?.['5'] || 0;
  const currentRatio10 = ratios[symbol]?.['10'] || 0;
  const currentRatio25p = ratios[symbol]?.['25'] || 0;

  const symbolRef = useRef(symbol);
  const intervalRef = useRef(interval);
  const colorRef = useRef(color);
  const lineWidthRef = useRef(lineWidth);
  const isObdInitialized = useRef(false);
  const lastBarTimeRef = useRef<number | null>(null);
  const candleDataRef = useRef<any[]>([]);
  const volumeDataRef = useRef<any[]>([]);
  const obdData25Ref = useRef<any[]>([]);
  const obdData5Ref = useRef<any[]>([]);
  const obdData10Ref = useRef<any[]>([]);
  const obdData25pRef = useRef<any[]>([]);
  const oldestCandleTimeRef = useRef<number | null>(null);
  const isLoadingMoreRef = useRef<boolean>(false);
  const loadMoreDataRef = useRef<() => Promise<void>>(async () => {});
  
  useEffect(() => { symbolRef.current = symbol; isObdInitialized.current = false; }, [symbol]);
  useEffect(() => { intervalRef.current = interval; }, [interval]);
  useEffect(() => { colorRef.current = color; }, [color]);

  useEffect(() => {
    if (obdContainerRef.current) {
      const s25 = (obdContainerRef.current as any).__series25;
      const s5 = (obdContainerRef.current as any).__series5;
      const s10 = (obdContainerRef.current as any).__series10;
      const s25p = (obdContainerRef.current as any).__series25p;
      const time = lastBarTimeRef.current;
      
      if (s25 && s5 && s10 && s25p && typeof time === 'number') {
        try {
          if (currentRatio25 !== 0 && !isNaN(currentRatio25)) s25.update({ time: time as Time, value: currentRatio25 });
          if (currentRatio5 !== 0 && !isNaN(currentRatio5)) s5.update({ time: time as Time, value: currentRatio5 });
          if (currentRatio10 !== 0 && !isNaN(currentRatio10)) s10.update({ time: time as Time, value: currentRatio10 });
          if (currentRatio25p !== 0 && !isNaN(currentRatio25p)) s25p.update({ time: time as Time, value: currentRatio25p });
        } catch (err) { console.warn("Ошибка обновления:", err); }
      }
    }
  }, [currentRatio25, currentRatio5, currentRatio10, currentRatio25p]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isResizingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = obdHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handleRsiMouseDown = (e: React.MouseEvent) => {
    isRsiResizingRef.current = true;
    rsiStartYRef.current = e.clientY;
    rsiStartHeightRef.current = rsiHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMacdMouseDown = (e: React.MouseEvent) => {
  isMacdResizingRef.current = true;
  macdStartYRef.current = e.clientY;
  macdStartHeightRef.current = macdHeight;
  document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingRef.current) {
        const deltaY = startYRef.current - e.clientY; 
        setObdHeight(Math.max(50, Math.min(500, startHeightRef.current + deltaY)));
      }
      if (isRsiResizingRef.current) {
        const deltaY = rsiStartYRef.current - e.clientY;
        setRsiHeight(Math.max(100, Math.min(400, rsiStartHeightRef.current + deltaY)));
      }

      if (isMacdResizingRef.current) {
        const deltaY = macdStartYRef.current - e.clientY;  
        setMacdHeight(Math.max(100, Math.min(400, macdStartHeightRef.current + deltaY)));
      }
    };

    
    const handleMouseUp = () => {
      isResizingRef.current = false;
      isRsiResizingRef.current = false;
      isMacdResizingRef.current = false;
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const redrawTimerRef = useRef<number | null>(null);
  const debouncedRedraw = () => {
    if (redrawTimerRef.current) clearTimeout(redrawTimerRef.current);
    redrawTimerRef.current = window.setTimeout(() => { redrawAll(); redrawTimerRef.current = null; }, 16);
  };

  const getTimeScaleAnchor = () => {
    if (!chartRef.current || !candleSeriesRef.current) return null;
    const series = candleSeriesRef.current;
    const timeScale = chartRef.current.timeScale();
    const firstBar = series.dataByIndex(0, MismatchDirection.NearestRight);
    const lastBar = series.dataByIndex(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft);
    if (!firstBar || !lastBar) return null;

    const firstIndex = timeScale.timeToIndex(firstBar.time as Time, false);
    const lastIndex = timeScale.timeToIndex(lastBar.time as Time, false);
    if (firstIndex === null || lastIndex === null) return null;

    return { timeScale, firstTime: firstBar.time as number, lastTime: lastBar.time as number, firstIndex, lastIndex, duration: intervalToSeconds(intervalRef.current) };
  };

  const logicalToUnixTime = (logical: number): number | null => {
    const anchor = getTimeScaleAnchor();
    if (!anchor) return null;
    if (logical >= anchor.lastIndex) return anchor.lastTime + (logical - anchor.lastIndex) * anchor.duration;
    return anchor.firstTime + (logical - anchor.firstIndex) * anchor.duration;
  };

  const unixTimeToLogical = (time: number): number | null => {
    const anchor = getTimeScaleAnchor();
    if (!anchor) return null;
    if (time >= anchor.lastTime) return anchor.lastIndex + (time - anchor.lastTime) / anchor.duration;
    return anchor.firstIndex + (time - anchor.firstTime) / anchor.duration;
  };

  const pixelToChart = (x: number, y: number): { time: number; price: number } | null => {
    if (!chartRef.current || !candleSeriesRef.current) return null;
    const timeScale = chartRef.current.timeScale();
    const price = candleSeriesRef.current.coordinateToPrice(y);
    if (price === null) return null;
    const mappedTime = timeScale.coordinateToTime(x);
    if (mappedTime !== null) return { time: mappedTime as number, price };
    const logical = timeScale.coordinateToLogical(x);
    if (logical === null) return null;
    const time = logicalToUnixTime(logical);
    if (time === null) return null;
    return { time, price };
  };

  const chartToPixel = (time: number, price: number): { x: number; y: number } | null => {
    if (!chartRef.current || !candleSeriesRef.current) return null;
    const timeScale = chartRef.current.timeScale();
    const y = candleSeriesRef.current.priceToCoordinate(price);
    if (y === null) return null;
    const mappedX = timeScale.timeToCoordinate(time as Time);
    if (mappedX !== null) return { x: mappedX, y };
    const logical = unixTimeToLogical(time);
    if (logical === null) return null;
    const x = timeScale.logicalToCoordinate(logical as Logical);
    if (x === null) return null;
    return { x, y };
  };

  // Инициализация главного графика и OBD
  useEffect(() => {
    if (!chartContainerRef.current) return;

    let isSyncingZoom = false;
    let isSyncingCrosshair = false;

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: '#0a0e17' }, textColor: '#d1d4dc' },
      grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#2a2e39', minimumWidth: 120 }, // 👈 ЖЕСТКАЯ ШИРИНА
      timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, rightOffset: 15, lockVisibleTimeRangeOnResize: true },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    });
    
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350', borderDownColor: '#ef5350', borderUpColor: '#26a69a', wickDownColor: '#ef5350', wickUpColor: '#26a69a',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, { color: '#26a69a', priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    if (obdContainerRef.current) {
      const obdChart = createChart(obdContainerRef.current, {
        layout: { background: { color: '#0a0e17' }, textColor: '#d1d4dc' },
        grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
        crosshair: { mode: 0, vertLine: { visible: true, labelVisible: true }, horzLine: { visible: true, labelVisible: true } },
        timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, rightOffset: 15, fixLeftEdge: false, fixRightEdge: false, lockVisibleTimeRangeOnResize: true, ticksVisible: true },
        rightPriceScale: { borderColor: '#2a2e39', minimumWidth: 120, autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 }, ticksVisible: true }, // 👈 ЖЕСТКАЯ ШИРИНА
        width: obdContainerRef.current.clientWidth,
        height: obdContainerRef.current.clientHeight,
      });

      const obdSeries25 = obdChart.addSeries(LineSeries, { color: '#ef5350', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceScaleId: 'right' });
      const obdSeries5 = obdChart.addSeries(LineSeries, { color: '#4caf50', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceScaleId: 'right' });
      const obdSeries10 = obdChart.addSeries(LineSeries, { color: '#2196f3', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceScaleId: 'right' });
      const obdSeries25p = obdChart.addSeries(LineSeries, { color: '#ffffff', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceScaleId: 'right' });

      obdSeries25.setData([]); obdSeries5.setData([]); obdSeries10.setData([]); obdSeries25p.setData([]);

      (obdContainerRef.current as any).__series25 = obdSeries25;
      (obdContainerRef.current as any).__series5 = obdSeries5;
      (obdContainerRef.current as any).__series10 = obdSeries10;
      (obdContainerRef.current as any).__series25p = obdSeries25p;
      (obdContainerRef.current as any).__chart = obdChart;

      [-100, -50, 0, 50, 100].forEach(level => {
        obdSeries25.createPriceLine({ price: level, color: level === 0 ? '#2a2e39' : '#1e222d', lineWidth: 1, lineStyle: level === 0 ? 2 : 0, axisLabelVisible: false, title: '' });
      });

      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && !isSyncingZoom) {
          isSyncingZoom = true;
          obdChart.timeScale().setVisibleLogicalRange(range);
          if (rsiChartRef.current) rsiChartRef.current.timeScale().setVisibleLogicalRange(range);
          isSyncingZoom = false;
          if (range.from < 10) loadMoreDataRef.current();
        }
      });

      obdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && !isSyncingZoom && chartRef.current) {
          isSyncingZoom = true;
          chartRef.current.timeScale().setVisibleLogicalRange(range);
          if (rsiChartRef.current) rsiChartRef.current.timeScale().setVisibleLogicalRange(range);
          isSyncingZoom = false;
        }
      });

      chart.subscribeCrosshairMove((param) => {
        if (isSyncingCrosshair) return;
        isSyncingCrosshair = true;
        if (param.time && param.point) {
          try { obdChart.setCrosshairPosition(0, param.time, obdSeries25); } catch (e) {}
          if (rsiChartRef.current && rsiSeriesRef.current) {
            try { rsiChartRef.current.setCrosshairPosition(0, param.time, rsiSeriesRef.current); } catch (e) {}
          }
        } else {
          obdChart.clearCrosshairPosition();
          if (rsiChartRef.current) rsiChartRef.current.clearCrosshairPosition();
        }
        isSyncingCrosshair = false;
      });

      obdChart.subscribeCrosshairMove((param) => {
        if (isSyncingCrosshair) return;
        isSyncingCrosshair = true;
        if (param.time && param.point) {
          try { chart.setCrosshairPosition(0, param.time, candleSeries); } catch (e) {}
          if (rsiChartRef.current && rsiSeriesRef.current) {
            try { rsiChartRef.current.setCrosshairPosition(0, param.time, rsiSeriesRef.current); } catch (e) {}
          }
        } else {
          chart.clearCrosshairPosition();
          if (rsiChartRef.current) rsiChartRef.current.clearCrosshairPosition();
        }
        isSyncingCrosshair = false;
      });
    }

    const initCanvas = () => {
      if (canvasRef.current && chartContainerRef.current) {
        canvasRef.current.width = chartContainerRef.current.clientWidth;
        canvasRef.current.height = chartContainerRef.current.clientHeight;
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight });
        initCanvas();
        redrawAll();
        
        if (obdContainerRef.current) {
          const obdChart = (obdContainerRef.current as any).__chart;
          if (obdChart) {
            obdChart.applyOptions({ 
              width: obdContainerRef.current.clientWidth, 
              height: obdContainerRef.current.clientHeight
            });
          }
        }
        if (rsiContainerRef.current && rsiChartRef.current) {
          rsiChartRef.current.applyOptions({ 
            width: rsiContainerRef.current.clientWidth, 
            height: rsiContainerRef.current.clientHeight
          });
        }


        if (macdContainerRef.current && macdChartRef.current) {
          macdChartRef.current.applyOptions({ 
          width: macdContainerRef.current.clientWidth, 
          height: macdContainerRef.current.clientHeight
          });
        }

      }
    });

    if (chartContainerRef.current) resizeObserver.observe(chartContainerRef.current);
    if (obdContainerRef.current) resizeObserver.observe(obdContainerRef.current);

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => debouncedRedraw());
    chart.subscribeCrosshairMove(() => debouncedRedraw());
    setTimeout(initCanvas, 100);

    return () => {
      resizeObserver.disconnect();
      if (redrawTimerRef.current) clearTimeout(redrawTimerRef.current);
      if (obdContainerRef.current) {
        const obdChart = (obdContainerRef.current as any).__chart;
        if (obdChart) obdChart.remove();
      }
      if (rsiChartRef.current) { rsiChartRef.current.remove(); rsiChartRef.current = null; }
      chart.remove();
    };
  }, []);

  // Инициализация RSI с жесткой привязкой размеров
  useEffect(() => {
    if (!isRsiVisible || !rsiContainerRef.current) {
      if (rsiChartRef.current) {
        rsiChartRef.current.remove();
        rsiChartRef.current = null;
        rsiSeriesRef.current = null;
      }
      return;
    }

    let isSyncingZoom = false;
    let isSyncingCrosshair = false;

    const timer = setTimeout(() => {
      if (!rsiContainerRef.current || !chartRef.current) return;

      const mainChart = chartRef.current;
      const mainTimeScale = mainChart.timeScale();

      const rsiChart = createChart(rsiContainerRef.current, {
        layout: { background: { color: '#0a0e17' }, textColor: '#d1d4dc' },
        grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
        crosshair: { mode: 0, vertLine: { visible: true, labelVisible: true }, horzLine: { visible: true, labelVisible: true } },
        timeScale: { 
          borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, 
          rightOffset: 15, // Жестко задаем 15, как в главном графике
          fixLeftEdge: false,
          fixRightEdge: false,
          lockVisibleTimeRangeOnResize: true 
        },
        rightPriceScale: { 
          borderColor: '#2a2e39', 
          minimumWidth: 120, // 👈 ЖЕСТКАЯ ШИРИНА
          scaleMargins: { top: 0.1, bottom: 0.1 } 
        },
        width: rsiContainerRef.current.clientWidth,
        height: rsiContainerRef.current.clientHeight,
      });

      const rsiSeries = rsiChart.addSeries(LineSeries, {
        color: '#9c27b0', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
      });

      rsiSeries.createPriceLine({ price: 70, color: '#ef5350', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
      rsiSeries.createPriceLine({ price: 50, color: '#2a2e39', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
      rsiSeries.createPriceLine({ price: 30, color: '#4caf50', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });

      rsiChartRef.current = rsiChart;
      rsiSeriesRef.current = rsiSeries;

      const range = mainTimeScale.getVisibleLogicalRange();
      if (range) rsiChart.timeScale().setVisibleLogicalRange(range);

      rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && !isSyncingZoom && chartRef.current) {
          isSyncingZoom = true;
          chartRef.current.timeScale().setVisibleLogicalRange(range);
          
          const obdChart = obdContainerRef.current ? (obdContainerRef.current as any).__chart : null;
          if (obdChart) obdChart.timeScale().setVisibleLogicalRange(range);
          
          isSyncingZoom = false;
        }
      });

      chartRef.current.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && !isSyncingZoom && rsiChartRef.current) {
          isSyncingZoom = true;
          rsiChartRef.current.timeScale().setVisibleLogicalRange(range);
          isSyncingZoom = false;
        }
      });

      rsiChart.subscribeCrosshairMove((param) => {
        if (isSyncingCrosshair) return;
        isSyncingCrosshair = true;
        if (param.time && param.point && chartRef.current && candleSeriesRef.current) {
          try { chartRef.current.setCrosshairPosition(0, param.time, candleSeriesRef.current); } catch (e) {}
          
          const obdChart = obdContainerRef.current ? (obdContainerRef.current as any).__chart : null;
          const obdSeries25 = obdContainerRef.current ? (obdContainerRef.current as any).__series25 : null;
          if (obdChart && obdSeries25) {
            try { obdChart.setCrosshairPosition(0, param.time, obdSeries25); } catch (e) {}
          }
        } else {
          if (chartRef.current) chartRef.current.clearCrosshairPosition();
          const obdChart = obdContainerRef.current ? (obdContainerRef.current as any).__chart : null;
          if (obdChart) obdChart.clearCrosshairPosition();
        }
        isSyncingCrosshair = false;
      });

      if (candleDataRef.current.length > 0) {
        const rsiData = calculateRSI(candleDataRef.current);
        rsiSeries.setData(rsiData);
        const currentRange = mainTimeScale.getVisibleLogicalRange();
        if (currentRange) rsiChart.timeScale().setVisibleLogicalRange(currentRange);
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      if (rsiChartRef.current) {
        rsiChartRef.current.remove();
        rsiChartRef.current = null;
        rsiSeriesRef.current = null;
      }
    };
  }, [isRsiVisible]);



  // Инициализация MACD
useEffect(() => {
  if (!isMacdVisible || !macdContainerRef.current) {
    if (macdChartRef.current) {
      macdChartRef.current.remove();
      macdChartRef.current = null;
      macdSeriesRef.current = null;
      macdSignalSeriesRef.current = null;
      macdHistogramSeriesRef.current = null;
    }
    return;
  }

  let isSyncingZoom = false;
  let isSyncingCrosshair = false;

  const timer = setTimeout(() => {
    if (!macdContainerRef.current || !chartRef.current) return;

    const mainChart = chartRef.current;
    const mainTimeScale = mainChart.timeScale();

    const macdChart = createChart(macdContainerRef.current, {
      layout: { background: { color: '#0a0e17' }, textColor: '#d1d4dc' },
      grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
      crosshair: { mode: 0, vertLine: { visible: true, labelVisible: true }, horzLine: { visible: true, labelVisible: true } },
      timeScale: { 
        borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, 
        rightOffset: 15,
        fixLeftEdge: false,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: true 
      },
      rightPriceScale: { 
        borderColor: '#2a2e39', 
        minimumWidth: 120,
        scaleMargins: { top: 0.1, bottom: 0.1 } 
      },
      width: macdContainerRef.current.clientWidth,
      height: macdContainerRef.current.clientHeight,
    });

    const macdSeries = macdChart.addSeries(LineSeries, {
      color: '#2196f3', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
    });

    const signalSeries = macdChart.addSeries(LineSeries, {
      color: '#ff9800', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
    });

    const histogramSeries = macdChart.addSeries(HistogramSeries, {
      priceLineVisible: false, lastValueVisible: false,
    });

    macdSeries.createPriceLine({ price: 0, color: '#2a2e39', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });

    macdChartRef.current = macdChart;
    macdSeriesRef.current = macdSeries;
    macdSignalSeriesRef.current = signalSeries;
    macdHistogramSeriesRef.current = histogramSeries;

    const range = mainTimeScale.getVisibleLogicalRange();
    if (range) macdChart.timeScale().setVisibleLogicalRange(range);

    macdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && !isSyncingZoom && chartRef.current) {
        isSyncingZoom = true;
        chartRef.current.timeScale().setVisibleLogicalRange(range);
        const obdChart = obdContainerRef.current ? (obdContainerRef.current as any).__chart : null;
        if (obdChart) obdChart.timeScale().setVisibleLogicalRange(range);
        if (rsiChartRef.current) rsiChartRef.current.timeScale().setVisibleLogicalRange(range);
        isSyncingZoom = false;
      }
    });

    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && !isSyncingZoom && macdChartRef.current) {
        isSyncingZoom = true;
        macdChartRef.current.timeScale().setVisibleLogicalRange(range);
        isSyncingZoom = false;
      }
    });

    macdChart.subscribeCrosshairMove((param) => {
      if (isSyncingCrosshair) return;
      isSyncingCrosshair = true;
      if (param.time && param.point && chartRef.current && candleSeriesRef.current) {
        try { chartRef.current.setCrosshairPosition(0, param.time, candleSeriesRef.current); } catch (e) {}
        const obdChart = obdContainerRef.current ? (obdContainerRef.current as any).__chart : null;
        const obdSeries25 = obdContainerRef.current ? (obdContainerRef.current as any).__series25 : null;
        if (obdChart && obdSeries25) {
          try { obdChart.setCrosshairPosition(0, param.time, obdSeries25); } catch (e) {}
        }
        if (rsiChartRef.current && rsiSeriesRef.current) {
          try { rsiChartRef.current.setCrosshairPosition(0, param.time, rsiSeriesRef.current); } catch (e) {}
        }
      } else {
        if (chartRef.current) chartRef.current.clearCrosshairPosition();
        const obdChart = obdContainerRef.current ? (obdContainerRef.current as any).__chart : null;
        if (obdChart) obdChart.clearCrosshairPosition();
        if (rsiChartRef.current) rsiChartRef.current.clearCrosshairPosition();
      }
      isSyncingCrosshair = false;
    });

    if (candleDataRef.current.length > 0) {
      const { macdData, signalData, histogramData } = calculateMACD(candleDataRef.current);
      macdSeries.setData(macdData);
      signalSeries.setData(signalData);
      histogramSeries.setData(histogramData);
      const currentRange = mainTimeScale.getVisibleLogicalRange();
      if (currentRange) macdChart.timeScale().setVisibleLogicalRange(currentRange);
    }
  }, 50);

  return () => {
    clearTimeout(timer);
    if (macdChartRef.current) {
      macdChartRef.current.remove();
      macdChartRef.current = null;
      macdSeriesRef.current = null;
      macdSignalSeriesRef.current = null;
      macdHistogramSeriesRef.current = null;
    }
  };
}, [isMacdVisible]);


  const redrawAll = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const currentDrawings = drawingsRef.current;
    const currentSelectedId = selectedDrawingIdRef.current;

    currentDrawings.forEach(drawing => {
      if (!drawing.symbol || drawing.symbol !== symbolRef.current) return;
      const isSelected = drawing.id === currentSelectedId;
      ctx.strokeStyle = drawing.color;
      ctx.lineWidth = drawing.lineWidth;
      ctx.setLineDash([]);

      let pixels: { x: number; y: number }[];
      if (drawing.fixed) {
        pixels = drawing.points.map(p => chartToPixel(p.x, p.y) || { x: 0, y: 0 });
      } else {
        pixels = drawing.points;
      }

      if (isSelected) {
        ctx.save();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = drawing.lineWidth + 2;
        ctx.setLineDash([5, 5]);
      }

      if (drawing.type === 'hline' && pixels.length >= 1) {
        const y = pixels[0].y;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      } else if (drawing.type === 'vline' && pixels.length >= 1) {
        const x = pixels[0].x;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      } else if (drawing.type === 'line' && pixels.length >= 2) {
        ctx.beginPath(); ctx.moveTo(pixels[0].x, pixels[0].y); ctx.lineTo(pixels[1].x, pixels[1].y); ctx.stroke();
      } else if (drawing.type === 'ray' && pixels.length >= 2) {
        ctx.beginPath(); ctx.moveTo(pixels[0].x, pixels[0].y);
        const dx = pixels[1].x - pixels[0].x; const dy = pixels[1].y - pixels[0].y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0) ctx.lineTo(pixels[0].x + (dx / length) * 2000, pixels[0].y + (dy / length) * 2000);
        ctx.stroke();
      } else if (drawing.type === 'fib' && pixels.length >= 2) {
        const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        const y1 = pixels[0].y; const y2 = pixels[1].y; const x1 = pixels[0].x; const x2 = pixels[1].x;
        fibLevels.forEach(level => {
          const invertedLevel = 1 - level;
          const y = y1 + (y2 - y1) * invertedLevel;
          ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
          ctx.fillStyle = drawing.color; ctx.font = '10px sans-serif'; ctx.fillText(`${(level * 100).toFixed(1)}%`, x2 + 5, y + 3);
        });
      } else if ((drawing.type === 'rect' || drawing.type === 'rect-clean') && pixels.length >= 2) {
        const minX = Math.min(pixels[0].x, pixels[1].x); const maxX = Math.max(pixels[0].x, pixels[1].x);
        const minY = Math.min(pixels[0].y, pixels[1].y); const maxY = Math.max(pixels[0].y, pixels[1].y);
        const width = maxX - minX; const height = maxY - minY;
        ctx.fillStyle = drawing.color + '40'; ctx.fillRect(minX, minY, width, height);
        if (drawing.type === 'rect') {
          const midY = minY + height / 2;
          ctx.strokeStyle = drawing.color; ctx.lineWidth = drawing.lineWidth; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(minX, midY); ctx.lineTo(maxX, midY); ctx.stroke();
        }
      } else if (drawing.type === 'channel' && pixels.length >= 3) {
         const x1 = pixels[0].x, y1 = pixels[0].y, x2 = pixels[1].x, y2 = pixels[1].y, x3 = pixels[2].x, y3 = pixels[2].y;
         const dx = x2 - x1, dy = y2 - y1;
         let offsetY = 0;
         if (dx !== 0) { const lineY = y1 + dy * (x3 - x1) / dx; offsetY = Math.abs(y3 - lineY); } else { offsetY = Math.abs(y3 - y1); }
         ctx.fillStyle = drawing.color + '30'; ctx.beginPath(); ctx.moveTo(x1, y1 - offsetY); ctx.lineTo(x2, y2 - offsetY); ctx.lineTo(x2, y2 + offsetY); ctx.lineTo(x1, y1 + offsetY); ctx.closePath(); ctx.fill();
         ctx.strokeStyle = drawing.color; ctx.lineWidth = drawing.lineWidth;
         ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
         ctx.beginPath(); ctx.moveTo(x1, y1 - offsetY); ctx.lineTo(x2, y2 - offsetY); ctx.moveTo(x1, y1 + offsetY); ctx.lineTo(x2, y2 + offsetY); ctx.stroke();
      } else if (drawing.type === 'ruler' && pixels.length >= 2) {
          const startX = pixels[0].x, startY = pixels[0].y, endX = pixels[1].x, endY = pixels[1].y;
          const width = Math.abs(endX - startX), height = Math.max(Math.abs(endY - startY), 4);
          const drawStartX = Math.min(startX, endX), drawStartY = Math.min(startY, endY);
          let priceChange = 0;
          if (drawing.fixed) { priceChange = ((drawing.points[1].y - drawing.points[0].y) / drawing.points[0].y) * 100; }
          else { const p1 = candleSeriesRef.current?.coordinateToPrice(drawing.points[0].y); const p2 = candleSeriesRef.current?.coordinateToPrice(drawing.points[1].y); priceChange = (p1 != null && p2 != null) ? ((p2 - p1) / p1) * 100 : 0; }
          const isPositive = priceChange >= 0;
          const percentColor = isPositive ? '#26a69a' : '#ef5350';
          const percentText = priceChange >= 0 ? `+${priceChange.toFixed(2)}%` : `${priceChange.toFixed(2)}%`;
          const barCount = Math.abs(pixels[1].x - pixels[0].x);
          let totalMinutes = 0;
          if (intervalRef.current === '1m') totalMinutes = barCount; else if (intervalRef.current === '5m') totalMinutes = barCount * 5; else if (intervalRef.current === '15m') totalMinutes = barCount * 15; else if (intervalRef.current === '30m') totalMinutes = barCount * 30; else if (intervalRef.current === '1h') totalMinutes = barCount * 60; else if (intervalRef.current === '4h') totalMinutes = barCount * 240; else if (intervalRef.current === '1d') totalMinutes = barCount * 1440; else if (intervalRef.current === '1w') totalMinutes = barCount * 10080;
          let timeText = '';
          if (totalMinutes >= 1440) timeText = `${Number.isInteger(totalMinutes / 1440) ? totalMinutes / 1440 : (totalMinutes / 1440).toFixed(1)} дн`;
          else if (totalMinutes >= 60) timeText = `${Number.isInteger(totalMinutes / 60) ? totalMinutes / 60 : (totalMinutes / 60).toFixed(1)} ч`;
          else timeText = `${totalMinutes} мин`;
          ctx.strokeStyle = drawing.color; ctx.lineWidth = drawing.lineWidth; ctx.setLineDash([]);
          if (drawing.rulerType === 'price') {
            ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(startX, endY); ctx.stroke();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'; ctx.fillRect(startX - 40, endY - 15, 80, 30);
            ctx.fillStyle = percentColor; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(percentText, startX, endY); ctx.textAlign = 'left';
          } else if (drawing.rulerType === 'date') {
            ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, startY); ctx.stroke();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'; ctx.fillRect(endX - 40, startY - 15, 80, 30);
            ctx.fillStyle = drawing.color; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(timeText, endX, startY); ctx.textAlign = 'left';
          } else {
            const minX = Math.min(startX, endX), maxX = Math.max(startX, endX), minY = Math.min(startY, endY), maxY = Math.max(startY, endY);
            const w = maxX - minX, h = Math.max(maxY - minY, 4);
            ctx.fillStyle = isPositive ? 'rgba(38, 166, 154, 0.1)' : 'rgba(239, 83, 80, 0.1)'; ctx.fillRect(minX, minY, w, h);
            ctx.strokeStyle = isPositive ? '#26a69a' : '#ef5350'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(minX, minY); ctx.lineTo(maxX, minY); ctx.moveTo(minX, maxY); ctx.lineTo(maxX, maxY); ctx.moveTo(minX, minY); ctx.lineTo(minX, maxY); ctx.moveTo(maxX, minY); ctx.lineTo(maxX, maxY); ctx.stroke();
            const midX = minX + w / 2, midY = minY + h / 2, tw = 90, th = 44;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(midX - tw / 2, midY - th / 2, tw, th, 4); ctx.fill(); } else { ctx.fillRect(midX - tw / 2, midY - th / 2, tw, th); }
            ctx.fillStyle = percentColor; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(percentText, midX, midY - 8);
            ctx.fillStyle = drawing.color; ctx.font = '12px sans-serif'; ctx.fillText(timeText, midX, midY + 10); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          }
      }

      if (isSelected) {
        pixels.forEach((point, idx) => {
          const isBeingDragged = isDraggingRef.current && draggingPointIndexRef.current === idx;
          ctx.fillStyle = isBeingDragged ? '#ef4444' : '#3b82f6';
          ctx.beginPath(); ctx.arc(point.x, point.y, isBeingDragged ? 7 : 5, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
        });
        ctx.restore();
      }
    });
  };

  useEffect(() => { redrawAll(); }, [drawings, selectedDrawingId, activeTool, interval, symbol]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete') {
        if (selectedDrawingId) { setDrawings(prev => prev.filter(d => d.id !== selectedDrawingId)); setSelectedDrawingId(null); }
        else if (drawings.length > 0) setDrawings(prev => prev.slice(0, -1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawings.length, selectedDrawingId]);

  // Обработка рисования
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    if (!isDrawingMode && !isRulerMode) {
      isDraggingRef.current = false; draggingPointIndexRef.current = null; isMovingDrawingRef.current = false; canvas.style.cursor = 'default'; return;
    }

    if (isRulerMode) {
      canvas.style.cursor = 'crosshair';
      const handleRulerMouseDown = (e: MouseEvent) => { const rect = canvas.getBoundingClientRect(); isDrawingRef.current = true; startPointRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }; };
      const handleRulerMouseMove = (e: MouseEvent) => {
        if (!isDrawingRef.current || !startPointRef.current) return;
        const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top;
        redrawAll();
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        const startX = startPointRef.current.x, startY = startPointRef.current.y;
        const startPrice = candleSeriesRef.current?.coordinateToPrice(startY); const endPrice = candleSeriesRef.current?.coordinateToPrice(y);
        let priceChange = 0; if (startPrice != null && endPrice != null && startPrice !== 0) priceChange = ((endPrice - startPrice) / startPrice) * 100;
        const isPositive = priceChange >= 0; const percentColor = isPositive ? '#26a69a' : '#ef5350'; const percentText = isPositive ? `+${priceChange.toFixed(2)}%` : `${priceChange.toFixed(2)}%`;
        const barCount = Math.abs(x - startX);
        let totalMinutes = 0;
        if (intervalRef.current === '1m') totalMinutes = barCount; else if (intervalRef.current === '5m') totalMinutes = barCount * 5; else if (intervalRef.current === '15m') totalMinutes = barCount * 15; else if (intervalRef.current === '30m') totalMinutes = barCount * 30; else if (intervalRef.current === '1h') totalMinutes = barCount * 60; else if (intervalRef.current === '4h') totalMinutes = barCount * 240; else if (intervalRef.current === '1d') totalMinutes = barCount * 1440; else if (intervalRef.current === '1w') totalMinutes = barCount * 10080;
        let timeText = '';
        if (totalMinutes >= 1440) timeText = `${Number.isInteger(totalMinutes / 1440) ? totalMinutes / 1440 : (totalMinutes / 1440).toFixed(1)} дн`;
        else if (totalMinutes >= 60) timeText = `${Number.isInteger(totalMinutes / 60) ? totalMinutes / 60 : (totalMinutes / 60).toFixed(1)} ч`;
        else timeText = `${totalMinutes} мин`;

        ctx.strokeStyle = colorRef.current; ctx.lineWidth = lineWidthRef.current; ctx.setLineDash([]);
        if (activeTool === 'price-ruler') {
          ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(startX, y); ctx.stroke();
          ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'; ctx.fillRect(startX - 40, y - 15, 80, 30);
          ctx.fillStyle = percentColor; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(percentText, startX, y); ctx.textAlign = 'left';
        } else if (activeTool === 'date-ruler') {
          ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(x, startY); ctx.stroke();
          ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'; ctx.fillRect(x - 40, startY - 15, 80, 30);
          ctx.fillStyle = colorRef.current; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(timeText, x, startY); ctx.textAlign = 'left';
        } else {
          const drawStartX = Math.min(startX, x), drawStartY = Math.min(startY, y), width = Math.abs(x - startX), height = Math.max(Math.abs(y - startY), 4);
          ctx.fillStyle = isPositive ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)'; ctx.fillRect(drawStartX, drawStartY, width, height);
          ctx.strokeStyle = isPositive ? '#26a69a' : '#ef5350'; ctx.strokeRect(drawStartX, drawStartY, width, height);
          const midX = drawStartX + width / 2, midY = drawStartY + height / 2;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'; ctx.fillRect(midX - 60, midY - 25, 120, 50);
          ctx.fillStyle = percentColor; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(percentText, midX, midY - 5);
          ctx.fillStyle = colorRef.current; ctx.font = '12px sans-serif'; ctx.fillText(timeText, midX, midY + 15); ctx.textAlign = 'left';
        }
      };
      const handleRulerMouseUp = (e: MouseEvent) => {
        if (!isDrawingRef.current || !startPointRef.current) return;
        const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top;
        const startChartCoords = pixelToChart(startPointRef.current.x, startPointRef.current.y); const endChartCoords = pixelToChart(x, y);
        if (startChartCoords && endChartCoords) {
          setDrawings(prev => [...prev, { id: Date.now().toString(), type: 'ruler', rulerType: activeTool === 'price-ruler' ? 'price' : activeTool === 'date-ruler' ? 'date' : 'both', points: [{ x: startChartCoords.time, y: startChartCoords.price }, { x: endChartCoords.time, y: endChartCoords.price }], color: colorRef.current, lineWidth: lineWidthRef.current, interval, symbol, fixed: true }]);
        }
        isDrawingRef.current = false; startPointRef.current = null;
      };
      canvas.addEventListener('mousedown', handleRulerMouseDown); canvas.addEventListener('mousemove', handleRulerMouseMove); window.addEventListener('mouseup', handleRulerMouseUp);
      return () => { canvas.removeEventListener('mousedown', handleRulerMouseDown); canvas.removeEventListener('mousemove', handleRulerMouseMove); window.removeEventListener('mouseup', handleRulerMouseUp); };
    }

    if (activeTool === 'cursor') {
      const handleSelectClick = (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top; const tolerance = 10; let foundDrawing: string | null = null;
        for (const drawing of drawingsRef.current) {
          if (!drawing.symbol || drawing.symbol !== symbolRef.current) continue;
          let pixels = drawing.fixed ? drawing.points.map(p => chartToPixel(p.x, p.y) || { x: 0, y: 0 }) : drawing.points;
          if (drawing.type === 'hline' && pixels.length >= 1 && Math.abs(y - pixels[0].y) < tolerance) { foundDrawing = drawing.id; break; }
          if (drawing.type === 'vline' && pixels.length >= 1 && Math.abs(x - pixels[0].x) < tolerance) { foundDrawing = drawing.id; break; }
        }
        setSelectedDrawingId(foundDrawing); redrawAll();
      };
      const handleMouseDown = (e: MouseEvent) => {
        const currentSelectedId = selectedDrawingIdRef.current; if (!currentSelectedId) return;
        e.preventDefault(); e.stopPropagation();
        const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top;
        const drawing = drawingsRef.current.find(d => d.id === currentSelectedId);
        if (!drawing || !drawing.symbol || drawing.symbol !== symbolRef.current) return;
        let pixels = drawing.fixed ? drawing.points.map(p => chartToPixel(p.x, p.y) || { x: 0, y: 0 }) : drawing.points;
        for (let i = 0; i < pixels.length; i++) {
          if (Math.sqrt((x - pixels[i].x) ** 2 + (y - pixels[i].y) ** 2) < 10) { isDraggingRef.current = true; draggingPointIndexRef.current = i; canvas.style.cursor = 'grabbing'; return; }
        }
        isMovingDrawingRef.current = true; moveStartPosRef.current = { x, y }; moveInitialPointsRef.current = drawing.points.map(p => ({ ...p })); canvas.style.cursor = 'grabbing';
      };
      const handleMouseMove = (e: MouseEvent) => {
        if (isMovingDrawingRef.current && selectedDrawingIdRef.current && moveStartPosRef.current && moveInitialPointsRef.current) {
          e.preventDefault();
          const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top;
          const dx = x - moveStartPosRef.current.x, dy = y - moveStartPosRef.current.y;
          const initialPoints = moveInitialPointsRef.current; const currentId = selectedDrawingIdRef.current;
          setDrawings(prev => prev.map(d => {
            if (d.id === currentId) {
              const newPoints = initialPoints.map(originalPoint => {
                if (d.fixed) { const pixel = chartToPixel(originalPoint.x, originalPoint.y); if (pixel) { const newChartCoords = pixelToChart(pixel.x + dx, pixel.y + dy); if (newChartCoords) return { x: newChartCoords.time, y: newChartCoords.price }; } return originalPoint; }
                else return { x: originalPoint.x + dx, y: originalPoint.y + dy };
              });
              return { ...d, points: newPoints };
            }
            return d;
          }));
          return;
        }
        if (!isDraggingRef.current || draggingPointIndexRef.current === null) return;
        const currentSelectedId = selectedDrawingIdRef.current; if (!currentSelectedId) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top;
        setDrawings(prev => prev.map(d => {
          if (d.id === currentSelectedId) {
            const newPoints = [...d.points];
            if (d.fixed) { const chartCoords = pixelToChart(x, y); if (chartCoords) newPoints[draggingPointIndexRef.current!] = { x: chartCoords.time, y: chartCoords.price }; }
            else newPoints[draggingPointIndexRef.current!] = { x, y };
            return { ...d, points: newPoints };
          }
          return d;
        }));
      };
      const handleMouseUp = () => { isDraggingRef.current = false; isMovingDrawingRef.current = false; moveStartPosRef.current = null; moveInitialPointsRef.current = null; draggingPointIndexRef.current = null; canvas.style.cursor = 'pointer'; };
      const handleMouseHover = (e: MouseEvent) => {
        if (isDraggingRef.current) return;
        const currentSelectedId = selectedDrawingIdRef.current; if (!currentSelectedId) { canvas.style.cursor = 'pointer'; return; }
        const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top;
        const drawing = drawingsRef.current.find(d => d.id === currentSelectedId);
        if (!drawing || !drawing.symbol || drawing.symbol !== symbolRef.current) { canvas.style.cursor = 'pointer'; return; }
        let pixels = drawing.fixed ? drawing.points.map(p => chartToPixel(p.x, p.y) || { x: 0, y: 0 }) : drawing.points;
        let nearPoint = false;
        for (let i = 0; i < pixels.length; i++) { if (Math.sqrt((x - pixels[i].x) ** 2 + (y - pixels[i].y) ** 2) < 10) { nearPoint = true; break; } }
        canvas.style.cursor = nearPoint ? 'grab' : 'pointer';
      };
      canvas.addEventListener('click', handleSelectClick); canvas.addEventListener('mousedown', handleMouseDown); canvas.addEventListener('mousemove', handleMouseMove); canvas.addEventListener('mousemove', handleMouseHover); window.addEventListener('mouseup', handleMouseUp);
      return () => { canvas.removeEventListener('click', handleSelectClick); canvas.removeEventListener('mousedown', handleMouseDown); canvas.removeEventListener('mousemove', handleMouseMove); canvas.removeEventListener('mousemove', handleMouseHover); window.removeEventListener('mouseup', handleMouseUp); };
    }

    const handleDrawMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (activeTool === 'channel') {
        if (!startPointRef.current) { startPointRef.current = { x, y }; isDrawingRef.current = true; return; }
        if (!middlePointRef.current) { middlePointRef.current = { x, y }; return; }
        const startChartCoords = pixelToChart(startPointRef.current.x, startPointRef.current.y); const middleChartCoords = pixelToChart(middlePointRef.current.x, middlePointRef.current.y); const endChartCoords = pixelToChart(x, y);
        if (startChartCoords && middleChartCoords && endChartCoords) {
          setDrawings(prev => [...prev, { id: Date.now().toString(), type: 'channel', points: [{ x: startChartCoords.time, y: startChartCoords.price }, { x: middleChartCoords.time, y: middleChartCoords.price }, { x: endChartCoords.time, y: endChartCoords.price }], color: colorRef.current, lineWidth: lineWidthRef.current, interval, symbol, fixed: true }]);
        }
        isDrawingRef.current = false; startPointRef.current = null; middlePointRef.current = null; return;
      }
      isDrawingRef.current = true; startPointRef.current = { x, y };
    };

    const handleDrawMouseMove = (e: MouseEvent) => {
      if (activeTool === 'channel') { if (!startPointRef.current) return; } else { if (!isDrawingRef.current || !startPointRef.current) return; }
      const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top;
      redrawAll();
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      ctx.strokeStyle = colorRef.current; ctx.lineWidth = lineWidthRef.current; ctx.setLineDash([5, 5]);
      if (activeTool === 'hline') { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
      else if (activeTool === 'vline') { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
      else if (activeTool === 'line') { ctx.beginPath(); ctx.moveTo(startPointRef.current.x, startPointRef.current.y); ctx.lineTo(x, y); ctx.stroke(); }
      else if (activeTool === 'ray') {
        ctx.beginPath(); ctx.moveTo(startPointRef.current.x, startPointRef.current.y);
        const dx = x - startPointRef.current.x, dy = y - startPointRef.current.y; const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0) ctx.lineTo(startPointRef.current.x + (dx / length) * 2000, startPointRef.current.y + (dy / length) * 2000);
        ctx.stroke();
      } else if (activeTool === 'fib') {
        const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]; const y1 = startPointRef.current.y, x1 = startPointRef.current.x;
        fibLevels.forEach(level => { const invertedLevel = 1 - level; const fy = y1 + (y - y1) * invertedLevel; ctx.beginPath(); ctx.moveTo(x1, fy); ctx.lineTo(x, fy); ctx.stroke(); });
      } else if (activeTool === 'rect' || activeTool === 'rect-clean') {
        const minX = Math.min(startPointRef.current.x, x), maxX = Math.max(startPointRef.current.x, x), minY = Math.min(startPointRef.current.y, y), maxY = Math.max(startPointRef.current.y, y);
        const width = maxX - minX, height = maxY - minY;
        ctx.fillStyle = colorRef.current + '40'; ctx.fillRect(minX, minY, width, height);
        if (activeTool === 'rect') { const midY = minY + height / 2; ctx.strokeStyle = colorRef.current; ctx.lineWidth = lineWidthRef.current; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(minX, midY); ctx.lineTo(maxX, midY); ctx.stroke(); }
      } else if (activeTool === 'channel') {
        const x1 = startPointRef.current.x, y1 = startPointRef.current.y; let x2 = middlePointRef.current ? middlePointRef.current.x : x; let y2 = middlePointRef.current ? middlePointRef.current.y : y;
        if (!middlePointRef.current) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
        else {
          const dx = x2 - x1, dy = y2 - y1; let offsetY = dx !== 0 ? Math.abs(y - (y1 + dy * (x - x1) / dx)) : Math.abs(y - y1);
          if (offsetY > 0) {
            ctx.fillStyle = colorRef.current + '30'; ctx.beginPath(); ctx.moveTo(x1, y1 - offsetY); ctx.lineTo(x2, y2 - offsetY); ctx.lineTo(x2, y2 + offsetY); ctx.lineTo(x1, y1 + offsetY); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = colorRef.current; ctx.lineWidth = lineWidthRef.current; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(x1, y1 - offsetY); ctx.lineTo(x2, y2 - offsetY); ctx.moveTo(x1, y1 + offsetY); ctx.lineTo(x2, y2 + offsetY); ctx.stroke();
          }
        }
      }
      ctx.setLineDash([]);
    };

    const handleDrawMouseUp = (e: MouseEvent) => {
      if (activeTool === 'channel') return;
      if (!isDrawingRef.current || !startPointRef.current) return;
      const rect = canvas.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const endChartCoords = pixelToChart(x, y); const startChartCoords = pixelToChart(startPointRef.current.x, startPointRef.current.y);
      const newDrawing: Drawing = { id: Date.now().toString(), type: activeTool, points: [], color: colorRef.current, lineWidth: lineWidthRef.current, interval, symbol, fixed: true };
      if (activeTool === 'hline' || activeTool === 'vline') { if (endChartCoords) newDrawing.points = [{ x: endChartCoords.time, y: endChartCoords.price }]; }
      else if (activeTool === 'line' || activeTool === 'ray' || activeTool === 'fib' || activeTool === 'rect' || activeTool === 'rect-clean') {
        if (startChartCoords && endChartCoords) newDrawing.points = [{ x: startChartCoords.time, y: startChartCoords.price }, { x: endChartCoords.time, y: endChartCoords.price }];
      }
      if (newDrawing.points.length > 0) setDrawings(prev => [...prev, newDrawing]);
      isDrawingRef.current = false; startPointRef.current = null;
    };
    canvas.addEventListener('mousedown', handleDrawMouseDown); canvas.addEventListener('mousemove', handleDrawMouseMove); canvas.addEventListener('mouseup', handleDrawMouseUp);
    return () => { canvas.removeEventListener('mousedown', handleDrawMouseDown); canvas.removeEventListener('mousemove', handleDrawMouseMove); canvas.removeEventListener('mouseup', handleDrawMouseUp); };
  }, [isDrawingMode, isRulerMode, activeTool]);

  useEffect(() => { localStorage.setItem('chartDrawings', JSON.stringify(drawings)); }, [drawings]);

  const adaptDrawingsToTimeframe = useCallback((newKlines: { time: number }[]) => {
    if (newKlines.length === 0) return;
    const oldLastTime = lastBarTimeRef.current; const newInterval = intervalRef.current;
    setDrawings(prevDrawings => {
      return prevDrawings.map(drawing => {
        if (!drawing.fixed) return drawing;
        if (drawing.symbol && drawing.symbol !== symbolRef.current) return drawing;
        if (drawing.type === 'hline' && drawing.points.length >= 1) {
          const price = drawing.points[0].y; const middleIndex = Math.floor(newKlines.length / 2); const middleTime = newKlines[middleIndex].time / 1000;
          return { ...drawing, interval: newInterval, points: [{ x: middleTime, y: price }] };
        }
        return { ...drawing, interval: newInterval, points: drawing.points.map(point => ({ x: remapTimeForIntervalChange(point.x, newKlines, oldLastTime, drawing.interval, newInterval), y: point.y })) };
      });
    });
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        setCandlesLoaded(false);
        const data = await getKlines(symbol, interval, 2000);
        setCandlesLoaded(true);
        adaptDrawingsToTimeframe(data);

        if (candleSeriesRef.current && chartRef.current) {
          const candleData = data.map(d => ({ time: (d.time / 1000) as Time, open: d.open, high: d.high, low: d.low, close: d.close }));
          const volumeData = data.map(d => ({ time: (d.time / 1000) as Time, value: d.volume, color: d.close >= d.open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)' }));

          candleSeriesRef.current.setData(candleData);
          volumeSeriesRef.current?.setData(volumeData);
          lastBarTimeRef.current = candleData.length > 0 ? (candleData[candleData.length - 1].time as number) : null;

          if (rsiSeriesRef.current && rsiChartRef.current) {
            const rsiData = calculateRSI(candleData);
            rsiSeriesRef.current.setData(rsiData);
          }

          if (macdSeriesRef.current && macdSignalSeriesRef.current && macdHistogramSeriesRef.current && macdChartRef.current) {
            const { macdData, signalData, histogramData } = calculateMACD(candleData);
            macdSeriesRef.current.setData(macdData);
            macdSignalSeriesRef.current.setData(signalData);
            macdHistogramSeriesRef.current.setData(histogramData);
          }
           
          if (obdContainerRef.current && candleData.length > 0) {
            const s25 = (obdContainerRef.current as any).__series25;
            const s5 = (obdContainerRef.current as any).__series5;
            const s10 = (obdContainerRef.current as any).__series10;
            const s25p = (obdContainerRef.current as any).__series25p;
            
            if (s25 && s5 && s10 && s25p) {
              const makeZeroArr = () => candleData.map(c => ({ time: c.time, value: 0 }));
              const obdData25 = makeZeroArr(); const obdData5 = makeZeroArr(); const obdData10 = makeZeroArr(); const obdData25p = makeZeroArr();
              const savedHistoryStr = localStorage.getItem('obd_history'); const savedHistory = savedHistoryStr ? JSON.parse(savedHistoryStr) : {};
              const symHistory = savedHistory[symbol] || {};
              const getHist = (key: string) => Array.isArray(symHistory) ? (key === '2.5' ? symHistory : []) : (symHistory[key] || []);
              const h25 = getHist('2.5'); const h5 = getHist('5'); const h10 = getHist('10'); const h25p = getHist('25');

              const applyHistory = (dataArr: any[], historyArr: any[]) => {
                historyArr.forEach((pt: any) => {
                  let closestIdx = -1, minDiff = Infinity;
                  dataArr.forEach((candle, idx) => { const diff = Math.abs(candle.time - pt.time); if (diff < minDiff) { minDiff = diff; closestIdx = idx; } });
                  if (closestIdx !== -1 && minDiff <= 300) dataArr[closestIdx].value = pt.value;
                });
              };

              applyHistory(obdData25, h25); applyHistory(obdData5, h5); applyHistory(obdData10, h10); applyHistory(obdData25p, h25p);
              s25.setData(obdData25); s5.setData(obdData5); s10.setData(obdData10); s25p.setData(obdData25p);
              isObdInitialized.current = true;
              candleDataRef.current = candleData; volumeDataRef.current = volumeData; obdData25Ref.current = obdData25; obdData5Ref.current = obdData5; obdData10Ref.current = obdData10; obdData25pRef.current = obdData25p;
              oldestCandleTimeRef.current = candleData[0].time * 1000;
            }
          }

          setTimeout(() => {
            try {
              if (chartRef.current) { 
                chartRef.current.timeScale().fitContent(); 
                chartRef.current.priceScale('right').applyOptions({ autoScale: true }); 
              }
              
              const range = chartRef.current?.timeScale().getVisibleLogicalRange();
              if (range) {
                if (obdContainerRef.current) {
                  const obdChart = (obdContainerRef.current as any).__chart;
                  if (obdChart) obdChart.timeScale().setVisibleLogicalRange(range);
                }
                if (rsiChartRef.current) {
                  rsiChartRef.current.timeScale().setVisibleLogicalRange(range);
                }

                if (macdChartRef.current) {
                  macdChartRef.current.timeScale().setVisibleLogicalRange(range);
                }              
              }
            } catch (e) {}
          }, 100);

          setTimeout(() => redrawAll(), 50);
        }
      } catch (e) { console.error('Failed to load klines:', e); }
    };

    loadData();

    loadMoreDataRef.current = async () => {
      if (isLoadingMoreRef.current || !oldestCandleTimeRef.current || !candleSeriesRef.current || !chartRef.current) return;
      isLoadingMoreRef.current = true;
      
      try {
        const olderKlines = await getOlderKlines(symbol, interval, oldestCandleTimeRef.current - 1, 1000);
        if (olderKlines.length === 0) { isLoadingMoreRef.current = true; return; }
        const newestFetchedTime = olderKlines[olderKlines.length - 1].time;
        if (newestFetchedTime >= oldestCandleTimeRef.current) { isLoadingMoreRef.current = true; return; }

        const olderCandles = olderKlines.map(d => ({ time: (d.time / 1000) as Time, open: d.open, high: d.high, low: d.low, close: d.close }));
        const olderVolumes = olderKlines.map(d => ({ time: (d.time / 1000) as Time, value: d.volume, color: d.close >= d.open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)' }));
        const olderObd25 = olderKlines.map(d => ({ time: (d.time / 1000) as Time, value: 0 }));
        const olderObd5 = olderKlines.map(d => ({ time: (d.time / 1000) as Time, value: 0 }));
        const olderObd10 = olderKlines.map(d => ({ time: (d.time / 1000) as Time, value: 0 }));
        const olderObd25p = olderKlines.map(d => ({ time: (d.time / 1000) as Time, value: 0 }));

        const savedRange = chartRef.current.timeScale().getVisibleLogicalRange();

        candleDataRef.current = [...olderCandles, ...candleDataRef.current];
        volumeDataRef.current = [...olderVolumes, ...volumeDataRef.current];
        obdData25Ref.current = [...olderObd25, ...obdData25Ref.current];
        obdData5Ref.current = [...olderObd5, ...obdData5Ref.current];
        obdData10Ref.current = [...olderObd10, ...obdData10Ref.current];
        obdData25pRef.current = [...olderObd25p, ...obdData25pRef.current];

        candleSeriesRef.current.setData(candleDataRef.current);
        volumeSeriesRef.current?.setData(volumeDataRef.current);
        
        if (rsiSeriesRef.current) {
          const rsiData = calculateRSI(candleDataRef.current);
          rsiSeriesRef.current.setData(rsiData);
        }

        if (obdContainerRef.current) {
           const s25 = (obdContainerRef.current as any).__series25; const s5 = (obdContainerRef.current as any).__series5; const s10 = (obdContainerRef.current as any).__series10; const s25p = (obdContainerRef.current as any).__series25p;
           if (s25) s25.setData(obdData25Ref.current); if (s5) s5.setData(obdData5Ref.current); if (s10) s10.setData(obdData10Ref.current); if (s25p) s25p.setData(obdData25pRef.current);
        }

        if (savedRange) {
          setTimeout(() => {
            if (chartRef.current) {
              chartRef.current.timeScale().setVisibleLogicalRange({ from: savedRange.from + olderCandles.length, to: savedRange.to + olderCandles.length });
            }
          }, 10);
        }
        oldestCandleTimeRef.current = olderCandles[0].time * 1000;
      } catch (err) { console.error('Failed to load older data:', err); } finally { setTimeout(() => { isLoadingMoreRef.current = false; }, 50); }
    };

    if (wsRef.current) wsRef.current.close();
    wsRef.current = createKlineWebSocket(symbol, interval, (kline) => {
      if (candleSeriesRef.current) {
        const timeInSeconds = Math.floor(kline.time / 1000);
        const newCandle = { time: timeInSeconds as Time, open: kline.open, high: kline.high, low: kline.low, close: kline.close };
        candleSeriesRef.current.update(newCandle);
        lastBarTimeRef.current = timeInSeconds;

        if (candleDataRef.current.length > 0) {
          const lastCandle = candleDataRef.current[candleDataRef.current.length - 1];
          if (lastCandle.time === timeInSeconds) {
            lastCandle.close = kline.close;
            lastCandle.high = Math.max(lastCandle.high, kline.high);
            lastCandle.low = Math.min(lastCandle.low, kline.low);
          } else {
            candleDataRef.current.push(newCandle);
          }
          
          if (rsiSeriesRef.current && candleDataRef.current.length >= 15) {
            const rsiData = calculateRSI(candleDataRef.current);
            const lastRsi = rsiData[rsiData.length - 1];
            if (lastRsi) {
              rsiSeriesRef.current.update(lastRsi);
            }
          }

          if (macdSeriesRef.current && macdSignalSeriesRef.current && macdHistogramSeriesRef.current && candleDataRef.current.length >= 26) {
            const { macdData, signalData, histogramData } = calculateMACD(candleDataRef.current);
            const lastMacd = macdData[macdData.length - 1];
            const lastSignal = signalData[signalData.length - 1];
            const lastHistogram = histogramData[histogramData.length - 1];
            if (lastMacd) macdSeriesRef.current.update(lastMacd);
            if (lastSignal) macdSignalSeriesRef.current.update(lastSignal);
            if (lastHistogram) macdHistogramSeriesRef.current.update(lastHistogram);
          }        
          
        }
      }
    });

    return () => { if (wsRef.current) wsRef.current.close(); };
  }, [symbol, interval, adaptDrawingsToTimeframe]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden min-h-0">
        <DrawingTools
          activeTool={activeTool}
          onToolSelect={setActiveTool}
          isDrawingMode={isDrawingMode}
          onToggleDrawingMode={() => { setIsDrawingMode(!isDrawingMode); if (!isDrawingMode) setActiveTool('cursor'); }}
          color={color}
          onColorChange={(newColor) => {
            setColor(newColor);
            if (selectedDrawingId) setDrawings(prev => prev.map(d => d.id === selectedDrawingId ? { ...d, color: newColor } : d));
          }}
          lineWidth={lineWidth}
          onLineWidthChange={(width) => {
            setLineWidth(width);
            if (selectedDrawingId) setDrawings(prev => prev.map(d => d.id === selectedDrawingId ? { ...d, lineWidth: width } : d));
          }}
          drawings={drawings}
          onDeleteDrawing={(id) => { setDrawings(prev => prev.filter(d => d.id !== id)); if (selectedDrawingId === id) setSelectedDrawingId(null); }}
          onClearAll={() => { setDrawings([]); setSelectedDrawingId(null); }}
          selectedDrawingId={selectedDrawingId}
          onSelectDrawing={setSelectedDrawingId}
        />

        <div className="flex-1 flex flex-row overflow-hidden min-h-0">
          
          <div className="flex-1 flex flex-col relative min-w-0">
            <div className="flex-1 relative min-h-0 overflow-hidden">
              <div ref={chartContainerRef} className="w-full h-full" />
              <canvas ref={canvasRef} className="absolute inset-0 z-10" style={{ pointerEvents: (isDrawingMode || isRulerMode) ? 'auto' : 'none', cursor: isRulerMode ? 'crosshair' : (isDrawingMode ? (activeTool === 'cursor' ? 'pointer' : 'crosshair') : 'default') }} />
            </div>

            {isRsiVisible && (
              <>
                <div 
                  className="h-2 w-full cursor-row-resize bg-[#2a2e39] hover:bg-purple-600 transition-colors z-20"
                  onMouseDown={handleRsiMouseDown}
                  style={{ marginTop: '-4px', marginBottom: '-4px' }}
                />
                <div 
                  className="border-t-2 border-[#2a2e39] relative shrink-0"
                  style={{ height: `${rsiHeight}px` }}
                >
                  <div className="absolute top-2 left-2 z-10 text-xs text-purple-400 bg-[#0a0e17] px-2 py-1 rounded flex items-center gap-2 shadow-lg border border-[#2a2e39] pointer-events-none">
                    <span className="font-bold">RSI (14)</span>
                  </div>
                  <div ref={rsiContainerRef} className="w-full h-full" />
                </div>
              </>
            )}

            {isMacdVisible && (
             <>
               <div 
                 className="h-2 w-full cursor-row-resize bg-[#2a2e39] hover:bg-orange-600 transition-colors z-20"
                 onMouseDown={handleMacdMouseDown}
                 style={{ marginTop: '-4px', marginBottom: '-4px' }}
               />
               <div 
                 className="border-t-2 border-[#2a2e39] relative shrink-0"
                 style={{ height: `${macdHeight}px` }}
               >
               <div className="absolute top-2 left-2 z-10 text-xs text-orange-400 bg-[#0a0e17] px-2 py-1 rounded flex items-center gap-2 shadow-lg border border-[#2a2e39] pointer-events-none">
                    <span className="font-bold">MACD (12, 26, 9)</span>
                  </div>
                 <div ref={macdContainerRef} className="w-full h-full" />
               </div>
              </>
            )}

            <div 
              className="h-2 w-full cursor-row-resize bg-[#2a2e39] hover:bg-blue-600 transition-colors z-20"
              onMouseDown={handleMouseDown}
              style={{ marginTop: '-4px', marginBottom: '-4px' }}
            />

            <div className="border-t-2 border-[#2a2e39] relative shrink-0" style={{ height: `${obdHeight}px` }}>
              <div className="absolute top-2 left-2 z-10 text-xs text-gray-400 bg-[#0a0e17] px-2 py-1 rounded flex items-center gap-4 shadow-lg border border-[#2a2e39] pointer-events-none">
                <span className="flex items-center gap-1">OBD 2.5%: <span className="text-[#ef5350] font-bold">{ratios[symbol]?.['2.5'] !== undefined ? ratios[symbol]['2.5'].toFixed(2) : '...'}</span></span>
                <span className="flex items-center gap-1">OBD 5%: <span className="text-[#4caf50] font-bold">{ratios[symbol]?.['5'] !== undefined ? ratios[symbol]['5'].toFixed(2) : '...'}</span></span>
                <span className="flex items-center gap-1">OBD 10%: <span className="text-[#2196f3] font-bold">{ratios[symbol]?.['10'] !== undefined ? ratios[symbol]['10'].toFixed(2) : '...'}</span></span>
                <span className="flex items-center gap-1">OBD 25%: <span className="text-[#ffffff] font-bold">{ratios[symbol]?.['25'] !== undefined ? ratios[symbol]['25'].toFixed(2) : '...'}</span></span>
              </div>
              <div ref={obdContainerRef} className="w-full h-full" />
            </div>
          </div>
          
          <div className="w-64 bg-[#131722] border-l border-[#2a2e39] flex flex-col shrink-0">
            <div className="flex-1 flex flex-col border-b border-[#2a2e39]">
             <LiquidationsPanel />
            </div>
            <div className="flex-1 flex flex-col border-b border-[#2a2e39]">
              <div className="py-1 px-2 text-[10px] font-bold text-gray-400 uppercase bg-[#1e222d] border-b border-[#2a2e39]">Ордера киты</div>
              <div className="flex-1 p-2 overflow-y-auto"><div className="text-gray-600 text-xs text-center mt-4">Нет данных</div></div>
            </div>
            <div className="flex-1 flex flex-col">
              <div className="py-1 px-2 text-[10px] font-bold text-gray-400 uppercase bg-[#1e222d]">Алерты</div>
              <div className="flex-1 p-2 overflow-y-auto"><div className="text-gray-600 text-xs text-center mt-4">Нет данных</div></div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}