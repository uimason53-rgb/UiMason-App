export type ExecutionStatus =

    | "idle"
    | "running"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";

export interface ExecutionContext {

    workspaceId: string;

    request: string;

}

export interface ExecutionSession {

    id: string;

    status: ExecutionStatus;

    context: ExecutionContext;

}

export interface ExecutionHistoryItem {

    timestamp: number;

    action: string;

}