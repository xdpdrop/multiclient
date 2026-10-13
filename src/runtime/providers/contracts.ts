import type {
  Availability,
  Capabilities,
  Connection,
  Interaction,
  ProviderInteractionReply,
  Message,
  ProviderEvent,
  ProviderId,
  Attachment,
} from '../../shared/types';
export type AdapterContext = {
  cwd: string;
  dataDir: string;
  bridgePath: string;
  executable: string;
  connection: Connection;
  mode?: string;
  signal: AbortSignal;
  emit: (event: ProviderEvent) => void;
  interact: (
    request: Pick<Interaction, 'kind' | 'title' | 'detail' | 'questions'>,
    signal?: AbortSignal,
  ) => Promise<ProviderInteractionReply>;
  secret?: string;
};
export type SessionHandle = { nativeId?: string };
export type StartTurnRequest = {
  text: string;
  model: string;
  mode: string;
  effort?: string;
  history: Message[];
  attachments?: Attachment[];
  contextText?: string;
  instructionsText?: string;
  excludedContextSnapshotIds?: string[];
};
export interface ProviderConnection {
  capabilities: Capabilities;
  openSession(request: { nativeId?: string }): Promise<SessionHandle>;
  startTurn(request: StartTurnRequest): Promise<void>;
  cancelTurn(): Promise<void>;
  close(): Promise<void>;
}
export interface ProviderAdapter {
  id: ProviderId;
  probe(connection: Connection): Promise<Availability>;
  connect(context: AdapterContext): Promise<ProviderConnection>;
}
