export class StashService {

    private _stashes:
        string[]
        = [];

    save(

        state: string

    ) {

        this._stashes.push(

            state

        );

    }

    getAll() {

        return this._stashes;

    }

}