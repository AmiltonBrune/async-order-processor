export const READINESS_PROBES = Symbol('ReadinessProbes');

export interface ReadinessProbe {
  readonly name: string;
  check(): Promise<boolean>;
}
