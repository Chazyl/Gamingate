import type { Session } from 'electron'
import type { PlatformPacket } from '../../shared/types'

/**
 * Pure partition-scope helpers (EMB-02, EMB-04). No Electron runtime import:
 * every function is unit-testable with fake session objects.
 */

/**
 * Keep only persistent (`persist:`) sessions. In-memory partitions have no jar
 * on disk, so flushing them is a no-op the engine must never wait on.
 */
export function engineSessionsToFlush(sessions: Session[]): Session[] {
  return sessions.filter((ses) => ses.isPersistent())
}

/**
 * The only partition a per-provider clear may touch (EMB-04). Returns the
 * packet's partition key; the clear path resolves exactly this Session and
 * never `defaultSession` or a sibling partition.
 */
export function clearTargetsFor(packet: PlatformPacket): string {
  return packet.partition
}
