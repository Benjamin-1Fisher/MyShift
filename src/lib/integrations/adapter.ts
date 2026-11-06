import type { Operation } from "../domain";
/** Implement only after reviewing the external provider's API, credentials and scope.
 * Imports must be previewed/confirmed through the same RPC; adapters must not write SQL.
 */
export interface ScheduleIntegration {
  readonly name: string;
  readonly connected: boolean;
  fetchProposals(weekStart: string): Promise<Operation[]>;
  exportSchedule(weekStart: string): Promise<Uint8Array>;
}
export const integrations: ScheduleIntegration[] = [];
