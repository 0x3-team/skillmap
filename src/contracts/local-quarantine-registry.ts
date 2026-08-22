export type LocalQuarantineOutcomeCode =
  | 'OWNER_PILOT_CARDINALITY_DENIED'
  | 'OWNER_PILOT_DESTINATION_COLLISION_EXHAUSTED'
  | 'ATOMIC_MOVE_UNSUPPORTED'
  | 'CROSS_VOLUME_NOT_ATOMIC'
  | 'OWNER_PILOT_RESTORE_WINDOW_EXPIRED'
  | 'RESTORE_DESTINATION_OCCUPIED';

export interface LocalQuarantineOutcomeV1 {
  code: LocalQuarantineOutcomeCode;
  phase: 'preflight' | 'destination_collision' | 'restore';
  mutation: 'none';
  local_retry: false;
  fresh_authorization_required: boolean;
  next_action: string;
}

export const LOCAL_QUARANTINE_OUTCOMES = Object.freeze({
  OWNER_PILOT_CARDINALITY_DENIED: Object.freeze({
    code: 'OWNER_PILOT_CARDINALITY_DENIED',
    phase: 'preflight',
    mutation: 'none',
    local_retry: false,
    fresh_authorization_required: true,
    next_action: 'provide_exactly_one_candidate'
  }),
  OWNER_PILOT_DESTINATION_COLLISION_EXHAUSTED: Object.freeze({
    code: 'OWNER_PILOT_DESTINATION_COLLISION_EXHAUSTED',
    phase: 'destination_collision',
    mutation: 'none',
    local_retry: false,
    fresh_authorization_required: true,
    next_action: 'resolve_destination_and_restart_preview'
  }),
  ATOMIC_MOVE_UNSUPPORTED: Object.freeze({
    code: 'ATOMIC_MOVE_UNSUPPORTED',
    phase: 'preflight',
    mutation: 'none',
    local_retry: false,
    fresh_authorization_required: true,
    next_action: 'repair_atomic_primitive_and_restart_preflight'
  }),
  CROSS_VOLUME_NOT_ATOMIC: Object.freeze({
    code: 'CROSS_VOLUME_NOT_ATOMIC',
    phase: 'preflight',
    mutation: 'none',
    local_retry: false,
    fresh_authorization_required: true,
    next_action: 'select_same_volume_and_restart_preflight'
  }),
  OWNER_PILOT_RESTORE_WINDOW_EXPIRED: Object.freeze({
    code: 'OWNER_PILOT_RESTORE_WINDOW_EXPIRED',
    phase: 'restore',
    mutation: 'none',
    local_retry: false,
    fresh_authorization_required: false,
    next_action: 'retain_quarantine_and_stop'
  }),
  RESTORE_DESTINATION_OCCUPIED: Object.freeze({
    code: 'RESTORE_DESTINATION_OCCUPIED',
    phase: 'restore',
    mutation: 'none',
    local_retry: false,
    fresh_authorization_required: true,
    next_action: 'resolve_exact_original_destination_and_restart_restore_preview'
  })
} satisfies Record<LocalQuarantineOutcomeCode, Readonly<LocalQuarantineOutcomeV1>>);

const EXACT_KEYS = [
  'code',
  'phase',
  'mutation',
  'local_retry',
  'fresh_authorization_required',
  'next_action'
] as const;

export function validateLocalQuarantineOutcome(value: unknown): LocalQuarantineOutcomeV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Local quarantine outcome must be an object.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== EXACT_KEYS.length || !EXACT_KEYS.every((key) => keys.includes(key))) {
    throw new Error('Local quarantine outcome must contain exactly the six public fields.');
  }
  if (typeof record.code !== 'string' || !(record.code in LOCAL_QUARANTINE_OUTCOMES)) {
    throw new Error('Local quarantine outcome code is not in the closed registry.');
  }
  const expected = LOCAL_QUARANTINE_OUTCOMES[record.code as LocalQuarantineOutcomeCode];
  for (const key of EXACT_KEYS) {
    if (record[key] !== expected[key]) throw new Error(`Local quarantine outcome ${key} does not match its closed tuple.`);
  }
  return expected;
}
