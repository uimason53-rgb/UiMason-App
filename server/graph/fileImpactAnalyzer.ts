export class FileImpactAnalyzer {

    analyze(

        changedFile: string,

        dependencies: any[]

    ) {

        return dependencies.filter(

            edge =>

                edge.from === changedFile ||

                edge.to === changedFile

        );

    }

}