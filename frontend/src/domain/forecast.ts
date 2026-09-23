export type TurbineId = string;
export type Horizon = 24 | 48;

export type JobStatus = "idle" | "queued" | "running" | "succeeded" | "failed" | "needs_data" | "superseded";
export interface Turbine {
  id: TurbineId;
  name: string;
  latitude: number;
  longitude: number;
  ratedPowerKw: number | null;
  dataRevision: number;
  modelRevision: number | null;
  activeModelId: string | null;
  trainingStatus: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Calculation {
  id: string;
  turbine: TurbineId;
  dataRevision: number;
  status: Exclude<JobStatus, "idle">;
  createdAt: string;
  updatedAt: string;
  message: string;
  attempts: number;
  modelVersion?: string;
  forecastId?: string;
  metrics?: { validationMae: number; persistenceMae: number; trainRows: number };
}

export interface ForecastPoint {
  time: string;
  power: number;
  wind: number | null;
  temperature: number | null;
}

export interface ActualPoint {
  time: string;
  power: number;
}

export interface ObservationBatch {
  turbine: TurbineId;
  updatedAt: string;
  points: ActualPoint[];
}

export interface ForecastRun {
  dataRevision?: number;
  calculationId?: string;
  createdAt?: string;
  id: string;
  turbine: TurbineId;
  issuedAt: string;
  weatherIssuedAt: string;
  weatherAvailableAt: string;
  horizon: Horizon;
  status: "success" | "error";
  reason: string;
  modelVersion: string;
  fallbackUsed: boolean;
  method: string;
  weatherSource: string;
  points: ForecastPoint[];
}

export interface WorkspaceData {
  turbines: Turbine[];
  runs: ForecastRun[];
  observations: ObservationBatch[];
  meta: {
    weatherSource: string;
    availabilityDelayHours: number;
    actualsThrough: string | null;
  };
}
