import type { ContextRef, ContextSnapshot } from '../../shared/context';

export function planContextInclusion(
  currentRefs: ContextRef[],
  currentSources: ContextSnapshot[],
  incomingRefs: ContextRef[],
  incomingSources: ContextSnapshot[],
  excludedContextSnapshotIds: string[] = [],
) {
  const instructions = incomingSources.filter(
    (source) =>
      source.kind === 'instructions' &&
      incomingRefs.some((ref) => ref.snapshotId === source.id && ref.included),
  );
  if (instructions.length > 1)
    throw new Error('Choose one captured revision of project instructions.');
  const captured = currentSources.filter((source) => source.kind === 'instructions');
  const previousInstructions = [
    ...new Map(captured.map((source) => [source.itemId ?? source.id, source])).values(),
  ];
  const previousIds = new Set(previousInstructions.map((source) => source.id));
  const nextInstruction = instructions[0];
  const instructionIds = new Set(captured.map((source) => source.id));
  const retained = nextInstruction
    ? currentRefs.filter((ref) => !instructionIds.has(ref.snapshotId))
    : currentRefs;
  const refs = [
    ...new Map([...retained, ...incomingRefs].map((ref) => [ref.snapshotId, ref])).values(),
  ];
  if (refs.length > 30)
    throw new Error('Include up to 30 shared sources. Remove some sources before adding more.');
  return {
    refs,
    excludedContextSnapshotIds: excludedContextSnapshotIds.filter(
      (id) => !incomingRefs.some((ref) => ref.snapshotId === id && ref.included),
    ),
    nextInstruction,
    previousInstructions,
    instructionChanged: !!nextInstruction && !previousIds.has(nextInstruction.id),
  };
}
