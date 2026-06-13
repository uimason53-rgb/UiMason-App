export interface WorkflowState {

    taskId: string;

    currentAgent: string;

    completedAgents: string[];

}

export interface AgentExecutionResult {

    success: boolean;

    output?: any;

}