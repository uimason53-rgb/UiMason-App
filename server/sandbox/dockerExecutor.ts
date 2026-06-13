import {

    commandRunner

} from "./commandRunner";

export class DockerExecutor {

    async ps() {

        return commandRunner(

            "docker ps"

        );

    }

}