export type TurbineId = "t1" | "t2";
export type Horizon = 24 | 48;

export interface ForecastPoint {
  time: string;
  power: number;
  wind: number;
  temperature: number;
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
  id: string;
  turbine: TurbineId;
  issuedAt: string;
  weatherIssuedAt: string;
  weatherAvailableAt: string;
  horizon: Horizon;
  status: "success" | "error";
  reason: string;
  points: ForecastPoint[];
}
