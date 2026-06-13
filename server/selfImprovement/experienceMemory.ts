import type {

    Experience

} from "./types/learning.types";

export class ExperienceMemory {

    private experiences =
        new Map<
            string,
            Experience
        >();

    add(

        experience: Experience

    ) {

        this.experiences.set(

            experience.id,

            experience

        );

    }

}