import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Map as LibreMap, Marker, NavigationControl, ScaleControl } from "maplibre-gl";
import { LocateFixed, RotateCcw } from "lucide-react";
import type { TurbineId } from "../../domain/forecast";
import { turbineSites } from "../../domain/map";
import type { MapMode, TurbineReading } from "../../domain/map";
import { number, turbineName } from "../../lib/format";
import { createTurbineLayer, parkCenter } from "./turbineLayer";
import "maplibre-gl/dist/maplibre-gl.css";

interface Props {
  readings: TurbineReading[];
  turbine: TurbineId;
  mode: MapMode;
  onSelect: (id: TurbineId) => void;
}

export default function TurbineMap({ readings, turbine, mode, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const layerRef = useRef<ReturnType<typeof createTurbineLayer> | null>(null);
  const callback = useRef(onSelect);
  callback.current = onSelect;
  const [anchors, setAnchors] = useState<{ id: TurbineId; element: HTMLDivElement }[]>([]);
  const [error, setError] = useState("");
  const [tileError, setTileError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  function overviewZoom() {
    const width = Math.max(280, container.current?.clientWidth ?? 600);
    return Math.min(16.8, 15.35 + Math.log2(width / 360)) - (width < 500 ? 0.4 : 0);
  }

  useEffect(() => {
    if (!container.current) return;
    setError(""); setTileError(false);
    let map: LibreMap;
    try {
      map = new LibreMap({
        container: container.current, center: parkCenter, zoom: overviewZoom(), pitch: 58, bearing: 30,
        maxPitch: 75, maxZoom: 19, canvasContextAttributes: { antialias: true },
        style: {
          version: 8,
          sources: { basemap: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>' } },
          layers: [
            { id: "background", type: "background", paint: { "background-color": "#e5ecdf" } },
            { id: "basemap", type: "raster", source: "basemap", paint: { "raster-saturation": -0.5, "raster-opacity": 0.85 } },
          ],
        },
      });
    } catch {
      setError("3D карта недоступна. Проверьте поддержку WebGL и аппаратное ускорение браузера. Данные доступны ниже.");
      return;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    const layer = createTurbineLayer((id) => callback.current(id));
    layerRef.current = layer;
    map.on("style.load", () => {
      try { map.addLayer(layer.layer); }
      catch { setError("Не удалось отобразить 3D модели. Попробуйте загрузить карту ещё раз."); }
    });
    map.on("error", () => setTileError(true));
    map.on("webglcontextlost", () => setError("Соединение с 3D картой прервано. Загрузите карту ещё раз."));
    const entries = turbineSites.map((site) => {
      const element = document.createElement("div");
      const marker = new Marker({ element, anchor: "top", offset: [0, 18] }).setLngLat(site.coordinates).addTo(map);
      // The React card owns keyboard interaction, not the marker wrapper.
      element.removeAttribute("tabindex");
      element.removeAttribute("role");
      element.removeAttribute("aria-label");
      return { id: site.id, element, marker };
    });
    setAnchors(entries);
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      entries.forEach((entry) => entry.marker.remove());
      map.remove(); mapRef.current = null; layerRef.current = null;
    };
  }, [attempt]);

  useEffect(() => { layerRef.current?.select(turbine); }, [turbine, anchors]);

  function resetView() {
    mapRef.current?.easeTo({ center: parkCenter, zoom: overviewZoom(), pitch: 58, bearing: 30, duration: 600 });
  }

  return <div className="turbine-map-shell">
    <div ref={container} className="turbine-map" role="region" aria-label="Интерактивная 3D карта двух турбин" />
    <div className="map-caption"><span className="map-status-dot" /> ВЕТРОПАРК <span>2 турбины</span></div>
    {!error && <button className="button map-reset" onClick={resetView}><LocateFixed size={16} />Весь парк</button>}
    {tileError && !error && <div className="map-warning" role="status">Подложка карты недоступна. Модели и данные сохранены. <button onClick={() => setAttempt((value) => value + 1)}>Повторить</button></div>}
    {error && <div className="map-failure" role="alert"><p>{error}</p><button className="button" onClick={() => setAttempt((value) => value + 1)}><RotateCcw size={16} />Повторить</button></div>}
    {!error && anchors.map(({ id, element }) => {
      const reading = readings.find((reading) => reading.id === id);
      return createPortal(<button className={`map-card ${turbine === id ? "selected" : ""}`}
        aria-pressed={turbine === id} aria-label={`Выбрать: ${turbineName(id)}`} onClick={() => onSelect(id)}>
        <span className="map-card-heading"><span className={`turbine-dot ${id}`} />{turbineName(id)}<span>↗</span></span>
        <span className="map-card-value">{number(reading?.power)} <small>усл. ед.</small></span>
        <span className="map-card-source">{reading?.power == null ? "Нет данных за этот час" : mode === "forecast" ? "Прогноз мощности" : "Измеренная мощность"}</span>
      </button>, element, id);
    })}
  </div>;
}
