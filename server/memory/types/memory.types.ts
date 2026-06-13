export interface MemoryItem {

    id: string;

    content: string;

    metadata?: any;

}

export interface Embedding {

    id: string;

    vector: number[];

}