


class NoteManager {

    noteViews = [];
    constructor(database) {
        this.initBroadcastChannel();
        this.database = database;
        this.database.on("deleted", (note) => {
            this.channel.postMessage({
                type: 'delete',
                note: JSON.parse(JSON.stringify(note))
            });
        });
        this.database.on('updated', (note) => {
            this.channel.postMessage({
                type: 'updated',
                note: JSON.parse(JSON.stringify(note))
            });
        });
        this.database.on("created", (note) => {
            this.channel.postMessage({
                type: 'add',
                note: JSON.parse(JSON.stringify(note))
            });
        });
    }

    async init() {
        await this.database.init();
        let notes = await this.database.loadNotes();
        notes.map(x => new Note({ ...x })).forEach(note => {
            this.addNoteView(note);
        });
    }

    initBroadcastChannel() {
        this.channel = new BroadcastChannel('BroadcastChannel');
        this.channel.onmessage = async (event) => {
            const message = event.data;
            console.log('A message occurred', message);
            if (message.type == 'delete') {
                let noteViewIndex = this.noteViews.findIndex(x => x.note.id == message.note.id);
                if (noteViewIndex != -1) {
                    let deletedNoteView = this.noteViews.splice(noteViewIndex, 1);
                    deletedNoteView[0].dom.remove();
                }


            }
            else if (message.type == 'add') {
                let note = new Note({ ...message.note });
                this.addNoteView(note);
            } else if (message.type == 'updated') {
                let note = await this.database.getNote(message.note.id);
                console.log(note);
                if (note) {
                    let noteView = this.noteViews.find(x => x.note.id == message.note.id);
                    noteView.note = note;
                    noteView.updateStyle();
                }
            }
        };
    };

    async deleteNote(note) {
        if (note.id != null) {
            await this.database.deleteNote(note);

        }
    }
    async updateNote({ id, x, y, width, height, title, content }) {
        if (id != null) {
            let note = await this.database.getNote(id);
            if (note) {
                note.update({ x, y, width, height, title, content });
                await this.database.updateNote(note);
            }
        }
    }
    async addNoteView(note) {
        let noteView = new NoteView(note);
        noteView.onDelete = () => {
            this.deleteNote(note);
        };
        noteView.onChanged = ({
            x,
            y,
            width,
            height,
            title,
            content

        }) => {
            this.updateNote({ id: note.id, x, y, width, height, title, content });
        };
        this.noteViews.push(noteView);
        noteView.render();
    }

    async addNote({ x, y, createdAt, updatedAt, content } = {
        x: 0,
        y: 0,
        createdAt: dayjs().unix(),
        updatedAt: dayjs().unix(),
        content: ''
    }) {
        let note = {
            x,
            y,
            createdAt,
            updatedAt,
            content
        };
        note = await this.database.addNote(note);
        this.addNoteView(note);
        //create note view
    }


}


const userImage = document.getElementById("userImage");
const username = document.getElementById("username");
const login = document.getElementById("login");
const logout = document.getElementById("logout");
logout.style.display = "none";

const database = new Database();
const firebaseClient = new FirebaseClient();
firebaseClient.init().then(() => {
    firebaseClient.attachDatabase(database);
   
});

let nm = new NoteManager(database);
nm.init().then(() => {
    let world = document.getElementById('world');
    world.addEventListener('dblclick', (e) => {
        console.log(e);
        if (e.target == world) {
            nm.addNote({ x: e.clientX, y: e.clientY, title: "", content: "" });
        }
    });
    world.addEventListener('click', (e) => {
        if (e.target == world) {
            getSelection().empty();
        }

    });
});


login.addEventListener('click', () => {
    firebaseClient.login().then(user => {
        if (user) {
            userImage.src = user.photoURL;
            username.innerText = user.displayName;
            login.style.display = "none";
            logout.style.display = "block";
        } else {

            userImage.src = "";
            username.innerHTML = "";
            login.style.display = 'block';
            logout.style.display = 'none';
        }
    });

});

logout.addEventListener("click", function () {
    firebaseClient.logout();
});

if (localStorage.getItem('token')) {
    //perform login click
    login.click();
}





