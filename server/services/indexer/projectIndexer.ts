import { projectScanner } from "./projectScanner";
import { dependencyGraph } from "./dependencyGraph";
import { symbolExtractor } from "./symbolExtractor";

import { graphBuilder } from "../../graph/graphBuilder";

import type {
    SymbolInfo
} from "./types/index.types";

export async function projectIndexer(

    root: string

) {

    const files =
        await projectScanner(
            root
        );

    const dependencies =
        await dependencyGraph(
            files.files
        );

    const symbols:
        SymbolInfo[]
        = [];

    for (

        const file

        of files.files

    ) {

        const result =
            await symbolExtractor(
                file.path
            );

        symbols.push(
            ...result
        );

    }

    const knowledgeGraph =
        await graphBuilder(

            files.files,

            symbols,

            dependencies

        );

    return {

        files,

        dependencies,

        symbols,

        knowledgeGraph

    };

}