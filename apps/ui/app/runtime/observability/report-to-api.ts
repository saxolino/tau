type ReportOptions = {
  reportUrl: string;
  name: string;
  /** Milliseconds. */
  duration: number;
  detail: Readonly<Record<string, unknown>>;
};

/**
 * The telemetry sink every metric entry (agent turns, kernel timings, revisions) goes through.
 *
 * SinopiaCAD: sends nothing. `TAU_API_URL` is Sinopia's `sinopiacad` function, which has no
 * `/v1/telemetry/ingest`; Tau's fire-and-forget POST would only spend its requests on 404s. Telemetry loss was
 * always acceptable here, so the callers stay as they are.
 *
 * @param _options - Telemetry report configuration including URL, metric name, duration (ms), and attributes
 */
export const reportToApi = (_options: ReportOptions): void => {
  /* Intentionally empty: see above. */
};
