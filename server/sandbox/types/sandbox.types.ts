export interface CommandResult {

    stdout: string;

    stderr: string;

    exitCode: number;

}

export interface TerminalSessionData {

    id: string;

    createdAt: number;

}