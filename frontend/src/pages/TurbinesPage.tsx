import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Database, Plus, Upload, RefreshCw, Wind } from "lucide-react";
import type { ForecastWorkspace } from "../app/useForecastWorkspace";
import type { ActualPoint, Calculation, JobStatus } from "../domain/forecast";
import { createTurbine, fetchCalculations, fetchWorkspace, importActuals, queueTraining } from "../data/api";
import { parseActualsCsv } from "../data/actualsCsv";
import { number, stamp } from "../lib/format";
import "./TurbinesPage.css";

const statusLabels: Record<JobStatus, string> = {
  idle: "Ожидает обучения", queued: "В очереди", running: "Обучение", succeeded: "Готово",
  failed: "Ошибка", needs_data: "Нужны измерения", superseded: "Данные обновлены",
};
type Props = Pick<ForecastWorkspace, "turbines" | "turbine" | "observations" | "changeTurbine" | "applyData" | "navigate">;

export default function TurbinesPage({ turbines, turbine, observations, changeTurbine, applyData, navigate }: Props) {
  const site = turbines.find((value) => value.id === turbine);
  const [jobs, setJobs] = useState<Calculation[]>([]);
  const [jobError, setJobError] = useState("");
  const [pollAttempt, setPollAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<ActualPoint[]>([]);
  const [fileName, setFileName] = useState("");
  const [requestId, setRequestId] = useState("");
  const [time, setTime] = useState("");
  const [power, setPower] = useState("");
  const [name, setName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [ratedPower, setRatedPower] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const batch = observations.find((value) => value.turbine === turbine);
  const active = site?.trainingStatus === "queued" || site?.trainingStatus === "running";

  useEffect(() => {
    setDraft([]); setFileName(""); setError(""); setNotice(""); setTime(""); setPower("");
    if (fileRef.current) fileRef.current.value = "";
  }, [turbine]);

  useEffect(() => {
    setJobs([]); setJobError("");
    if (!turbine) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await fetchCalculations(turbine, controller.signal);
        if (!controller.signal.aborted) { setJobs(result); setJobError(""); }
      } catch (reason) {
        if (!controller.signal.aborted) setJobError(reason instanceof Error ? reason.message : "Не удалось получить статус.");
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [turbine, pollAttempt]);

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить данные."); }
    finally { setBusy(false); }
  }
  async function addWindmill(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      const created = await createTurbine({ name, latitude: Number(latitude), longitude: Number(longitude), ratedPowerKw: ratedPower ? Number(ratedPower) : null });
      applyData(await fetchWorkspace());
      navigate("turbines", "", created.id);
      setName(""); setLatitude(""); setLongitude(""); setRatedPower("");
    });
  }
  async function saveMeasurements(points: ActualPoint[], key: string) {
    await perform(async () => {
      const result = await importActuals(turbine, points, key);
      applyData(await fetchWorkspace()); setPollAttempt((value) => value + 1);
      setNotice(result.changed ? `Сохранено часов: ${result.changed}. Версия данных ${result.dataRevision}. Обучение поставлено в очередь.` : "Эти значения уже сохранены. Повторное обучение не требуется.");
      setDraft([]); setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return <div className="fleet-page">
    {error && <div className="notice warning" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    <div className="fleet-columns">
      <section className="panel fleet-panel">
        <h2><Wind size={20} /> Ветряки <span className="muted">{turbines.length}</span></h2>
        <div className="fleet-list">{turbines.map((value) => <button key={value.id} disabled={busy}
          className={`fleet-site ${value.id === turbine ? "selected" : ""}`} aria-pressed={value.id === turbine} onClick={() => changeTurbine(value.id)}>
          <strong>{value.name}</strong><span>{value.latitude.toFixed(5)}°, {value.longitude.toFixed(5)}°</span>
          <small>{statusLabels[value.trainingStatus]} · версия данных {value.dataRevision}</small>
        </button>)}</div>
        <form onSubmit={addWindmill} className="fleet-form">
          <h3><Plus size={17} /> Добавить ветряк</h3>
          <label>Название<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
          <div className="fleet-form-pair">
            <label>Широта<input required type="number" step="any" min={-85} max={85} value={latitude} onChange={(event) => setLatitude(event.target.value)} disabled={busy} /></label>
            <label>Долгота<input required type="number" step="any" min={-180} max={180} value={longitude} onChange={(event) => setLongitude(event.target.value)} disabled={busy} /></label>
          </div>
          <label>Номинальная мощность, кВт · необязательно<input type="number" step="any" min={0.001} max={1000000} value={ratedPower} onChange={(event) => setRatedPower(event.target.value)} disabled={busy} /></label>
          <button className="button primary" disabled={busy}><Plus size={16} />Добавить ветряк</button>
        </form>
      </section>
      <div className="fleet-main">
        {site ? <>
          <section className="panel fleet-panel">
            <div className="fleet-panel-title"><div><h2>{site.name}</h2><p>Измерения и модель</p></div><span className={`fleet-status ${site.trainingStatus}`}>{statusLabels[site.trainingStatus]}</span></div>
            <div className="fleet-stats"><div><span>Версия измерений</span><strong>{site.dataRevision}</strong></div><div><span>Версия данных модели</span><strong>{site.modelRevision ?? "—"}</strong></div><div><span>Последний час · UTC</span><strong>{stamp(batch?.points.at(-1)?.time)}</strong></div></div>
            {site.modelRevision !== null && site.modelRevision !== site.dataRevision && <p className="fleet-hint">Измерения обновлены. Текущая модель обучена на предыдущей версии; прежние прогнозы сохранены.</p>}
            <button className="button" disabled={busy || active} onClick={() => perform(async () => {
              await queueTraining(turbine); applyData(await fetchWorkspace()); setPollAttempt((value) => value + 1);
              setNotice("Обучение поставлено в очередь.");
            })}><RefreshCw size={16} className={active ? "spin" : undefined} />{active ? "Расчёт выполняется в фоне" : "Обучить и рассчитать 48 часов"}</button>
          </section>
          <section className="panel fleet-panel">
            <h2><Upload size={19} /> Загрузить фактические данные</h2>
            <p>CSV: <code>time,power</code>. Время с часовым поясом, мощность от 0 до 1. Совпадающие часы будут исправлены, остальные сохранятся.</p>
            <pre className="fleet-example">time,power{"\n"}2026-03-01T00:00:00Z,0.42{"\n"}2026-03-01T01:00:00Z,0.38</pre>
            <p className="fleet-hint">До 10 000 строк за загрузку. Для первого обучения нужно минимум 5 суток почасовых данных без пропусков. Модель использует историю мощности; прогноз погоды ей не требуется.</p>
            <label className="fleet-upload">CSV-файл<input ref={fileRef} type="file" accept=".csv,text/csv" disabled={busy} onChange={async (event) => {
              const file = event.target.files?.[0]; setDraft([]); setError(""); setFileName("");
              if (!file) return;
              try {
                if (file.size > 2 * 1024 * 1024) throw new Error("Размер CSV не должен превышать 2 МБ.");
                const points = parseActualsCsv(await file.text()); setDraft(points); setFileName(file.name); setRequestId(crypto.randomUUID());
              } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось прочитать CSV."); }
            }} /></label>
            {draft.length > 0 && <div className="fleet-preview"><strong>{fileName} · {draft.length} часов</strong><span>{stamp(draft[0].time)} — {stamp(draft.at(-1)?.time)} UTC</span>
              <button className="button primary" disabled={busy} onClick={() => saveMeasurements(draft, requestId)}><Database size={16} />Сохранить и переобучить</button></div>}
            <form className="fleet-form fleet-correction" onSubmit={(event) => {
              event.preventDefault(); void saveMeasurements([{ time: new Date(`${time}:00Z`).toISOString(), power: Number(power) }], crypto.randomUUID());
            }}>
              <h3>Добавить или исправить один час</h3>
              <div className="fleet-form-pair"><label>Начало часа · UTC<input required type="datetime-local" step={3600} value={time} onChange={(event) => setTime(event.target.value)} disabled={busy} /></label>
                <label>Мощность · от 0 до 1<input required type="number" min={0} max={1} step="any" value={power} onChange={(event) => setPower(event.target.value)} disabled={busy} /></label></div>
              <button className="button" disabled={busy}>Сохранить измерение</button>
            </form>
          </section>
          <section className="panel fleet-panel">
            <h2>Расчёты и обучение</h2>
            {jobError && <p role="alert" className="fleet-hint">{jobError} <button className="button" onClick={() => setPollAttempt((value) => value + 1)}>Повторить</button></p>}
            {!jobs.length && !jobError && <p>Обучение начнётся автоматически после изменения измерений.</p>}
            <div className="fleet-jobs">{jobs.map((job) => <article className="fleet-job" key={job.id}>
              <div><strong>{statusLabels[job.status]}</strong><span>{stamp(job.createdAt)} UTC · данные v{job.dataRevision}</span></div>
              <p>{job.message}</p>
              {job.metrics && <p>MAE за последние 24 часа: {number(job.metrics.validationMae, 3)} · Базовый прогноз: {number(job.metrics.persistenceMae, 3)} · Строк обучения: {job.metrics.trainRows}</p>}
              {job.forecastId && <button className="button" disabled={busy} onClick={() => perform(async () => {
                applyData(await fetchWorkspace()); navigate("forecast", job.forecastId, turbine);
              })}>Открыть прогноз</button>}
            </article>)}</div>
          </section>
        </> : <section className="panel state-panel"><Wind size={32} /><h2>Добавьте первый ветряк</h2><p>После сохранения он появится на 3D карте.</p></section>}
      </div>
    </div>
  </div>;
}
