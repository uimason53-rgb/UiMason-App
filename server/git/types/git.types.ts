export interface GitCommit {

    hash: string;

    message: string;

}

export interface GitBranch {

    name: string;

}

export interface GitDiff {

    file: string;

    changes: string;

}