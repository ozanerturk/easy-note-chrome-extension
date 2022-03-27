class Database extends MyEventEmitter {
    notes = [];


    constructor() {
        super();
        this.db = new Dexie("EasyNoteDatabase");
        this.db.version(1).stores({
            notes: `++id,createdAt,updatedAt`,
        });

    }
    async init() {
        if (!this.db.isOpen()) {
            await this.db.open();
        }
    }

    async getNote(id) {
        let res = await this.db.notes.get(Number(id));
        console.log(res);
        if (res) {
            return new Note(res);
        }
        return null;
    }

    async loadNotes() {

        let notes = (await this.db.notes.toArray()).filter(x => !x.deleted);
        this.notes = notes;
        return notes;
    }

    async addNote(note, publishEvent = true) {
        note = { ...note, createdAt: dayjs().unix(), updatedAt: dayjs().unix() };
        await this.db.notes.add(note);
        this.notes.push(note);
        if (publishEvent) {
            this.emit("created", note);
        }
        return note;
    }

    async updateNote(note, publishEvent = true) {
        note = { ...note, updatedAt: dayjs().unix() };
        this.db.notes.update(note.id, note);
        if (publishEvent) {
            this.emit("updated", note);
        }
        return note;
    }

    async deleteNote(note, publishEvent = true) {
        let res = await this.db.notes.get(Number(note.id));
        console.log(res);
        if (res) {
            note = { ...note, updatedAt: dayjs().unix(), deleted: true };
            this.db.notes.update(note.id, note);
        }
        if (publishEvent) {
            this.emit("deleted", note);
        }
        return note;
    }

}