class Database extends MyEventEmitter {


    constructor() {
        super();
        this.db = new Dexie("EasyNoteDatabase");
        this.db.version(1).stores({
            notes: `id,createdAt,updatedAt`,
        });

    }
    async init() {
        if (!this.db.isOpen()) {
            await this.db.open();
        }
    }

    async getNote(id) {
        let res = await this.db.notes.get(id);
        if (res) {
            return new Note(res);
        }
        return null;
    }

    async loadNotes() {

        let notes = (await this.db.notes.toArray()).filter(x => !x.deleted);
        return notes;
    }

    async addNote(note) {
        let id = note.id || uuidv4();
        note = { ...note, id, createdAt: new Date(), updatedAt: new Date() };
        await this.db.notes.add(note);
        this.emit("created", note);
        console.log("[DATABASE]","note is created",note);
        return note;
    }

    async updateNote(note) {
        note = { ...note, updatedAt: new Date() };
        this.db.notes.update(note.id, note);
        this.emit("updated", note);
        console.log("[DATABASE]","note is updated",note);
        return note;
    }

    async deleteNote(note) {
        let res = await this.db.notes.get(note.id);
        if (res) {
            note = { ...note, updatedAt: new Date(), deleted: true };
            this.db.notes.update(note.id, note);
        }
        this.emit("deleted", note);
        console.log("[DATABASE]","note is deleted",note);
        return note;
    }

}