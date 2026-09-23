import { useMemo, useState } from "react";
import { Clock3, Layers3, Thermometer, Wind, Zap } from "lucide-react";
import type { ForecastWorkspace } from "../app/useForecastWorkspace";
import { mapReadings, observationTimes, turbineSites } from "../domain/map";
import type { MapMode } from "../domain/map";
import { formatDate, number, stamp } from "../lib/format";
import TurbineMap from "../components/map/TurbineMap";
import HorizonControl from "../components/HorizonControl";
import "./MapPage.css";

type Props = Pick<ForecastWorkspace, "run" | "runs" | "observations" | "turbines" | "turbine" | "changeTurbine" | "horizon" | "setHorizon" | "hour" | "setHour">;

export default function MapPage({ run, runs, observations, turbines, turbine, changeTurbine, horizon, setHorizon, hour, setHour }: Props) {
  const [mode, setMode] = useState<MapMode>("forecast");
  const [historyHour, setHistoryHour] = useState<number | null>(null);
  const actualTimes = useMemo(() => observationTimes(observations), [observations]);
  const sites = turbineSites(turbines);
  const times = mode === "forecast" ? run?.points.slice(0, horizon).map((point) => point.time) ?? [] : actualTimes;
  const index = Math.max(0, Math.min(mode === "forecast" ? hour : historyHour ?? times.length - 1, times.length - 1));
  const time = times[index];
  const readings = mapReadings(runs, observations, run?.issuedAt ?? "", time, mode, sites, run?.id);
  const reading = readings.find((value) => value.id === turbine)!;
  const site = sites.find((value) => value.id === turbine);
  function selectHour(value: number) { if (mode === "forecast") setHour(value); else setHistoryHour(value); }

  return <section className="map-workspace" aria-label="Карта ветропарка">
    <div className="map-toolbar">
      <div><h2><Layers3 size={19} /> Обзор турбин</h2><p>Выберите турбину на карте и нужный час.</p></div>
      <div className="map-mode" role="group" aria-label="Источник данных карты">
        <button aria-pressed={mode === "forecast"} onClick={() => setMode("forecast")}>Прогноз</button>
        <button aria-pressed={mode === "actual"} onClick={() => setMode("actual")}>Измерения · архив</button>
      </div>
    </div>
    <TurbineMap sites={sites} readings={readings} turbine={turbine} mode={mode} onSelect={changeTurbine} />
    <div className="map-timeline">
      <div className="map-time-heading">
        <label htmlFor="map-time"><Clock3 size={17} />{mode === "forecast" ? "Час прогноза" : "Час измерения"} · UTC</label>
        {time && <select id="map-time" value={index} onChange={(event) => selectHour(Number(event.target.value))}>
          {times.map((value, index) => <option key={value} value={index}>{stamp(value)}</option>)}
        </select>}
        {mode === "forecast" && <HorizonControl value={horizon} onChange={setHorizon} />}
      </div>
      {time ? <>
        <input type="range" min={0} max={times.length - 1} value={index} onChange={(event) => selectHour(Number(event.target.value))}
          aria-label="Выбранный час на карте" aria-valuetext={`${stamp(time)} UTC`} disabled={times.length < 2} />
        <div className="map-time-bounds"><span>{stamp(times[0])}</span><span>{stamp(times.at(-1))}</span></div>
      </> : <p className="map-empty" role="status">{mode === "forecast" ? "У выбранного ветряка пока нет прогноза. Загрузите измерения на странице «Ветряки и данные»." : "В архиве пока нет измерений."}</p>}
    </div>
    {site && reading && <div className="map-detail" aria-live="polite">
      <div className="map-site"><span className="map-eyebrow">ВЫБРАННЫЙ ОБЪЕКТ</span><h3>{site.name}</h3><p>{site.coordinates[1].toFixed(6)}°, {site.coordinates[0].toFixed(6)}°</p></div>
      <div className="map-reading"><span><Zap size={15} />{mode === "forecast" ? "Прогноз мощности" : "Измеренная мощность"}</span><strong>{number(reading.power)} <small>усл. ед.</small></strong></div>
      <div className="map-reading"><span><Wind size={15} />Ветер · прогноз</span><strong>{number(reading.wind, 1)} <small>м/с</small></strong></div>
      <div className="map-reading"><span><Thermometer size={15} />Температура · прогноз</span><strong>{number(reading.temperature, 1)} <small>°C</small></strong></div>
    </div>}
    <div className="map-footnote">
      <p>{mode === "forecast" ? `Прогноз от ${stamp(run?.issuedAt)} UTC. Мощность нормирована от 0 до 1.`
        : `Измерения: ${formatDate(actualTimes[0], true)} — ${formatDate(actualTimes.at(-1), true)}. В архиве измерений нет погоды.`}</p>
      <p>Модели условные. Поворот и наклон: правая кнопка мыши или Ctrl + перетаскивание. «—» означает отсутствие данных.</p>
    </div>
  </section>;
}
