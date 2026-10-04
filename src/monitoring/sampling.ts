/** トレースの送る割合（SDD 11章）。本番は間引き、staging は全件 */
export function tracesSampleRate(environment: string): number {
  return environment === 'production' ? 0.1 : 1.0
}
