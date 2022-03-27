


class NoteManager {
    //note manager only manages nodeViews
    //listens changes on noteViews and update the database
    //listens database changes and reflects to noteViews 
    noteViews = [];
    constructor(database) {
        //todo: here I can see database and broadcast channel are coubled to notemanager, 
        //but I don't know how to fix it for now
        this.initBroadcastChannel();
        this.database = database;
        this.database.on("deleted", (note) => {
            this.deleteNoteView(note);
            this.channel.postMessage({
                type: 'delete',
                note: JSON.parse(JSON.stringify(note))
            });
        });
        this.database.on('updated', (note) => {
            this.updateNoteView(note);
            this.channel.postMessage({
                type: 'updated',
                note: JSON.parse(JSON.stringify(note))
            });
        });
        this.database.on("created", (note) => {
            this.addNoteView(note);
            this.channel.postMessage({
                type: 'add',
                note: JSON.parse(JSON.stringify(note))
            });
        });
    }

    async init() {
        await this.database.init();
        let notes = await this.database.loadNotes();

        notes.map(x => new Note({ ...x }))
            .forEach(note => {
                this.addNoteView(note);
            });
    }

    async addNoteView(note) {
        let noteView = new NoteView(note);
        noteView.onDelete = () => {
            //todo: why we trigger delete note in notemanager ? who should responsible for this action ?
            this.database.deleteNote(note);
        };
        noteView.on("changed", ({
            x,
            y,
            width,
            height,
            title,
            content

        }) => {
            //check if there is any changes
            if (note.x != x || note.y != y || note.width != width || note.height != height || note.title != title || note.content != content) {
                console.log(note.id)
                let noteToUpdate = new Note({ id: note.id, x, y, width, height, title, content,createdAt:note.createdAt,updatedAt:new Date() });
                this.database.updateNote(noteToUpdate);
            }
        });
        this.noteViews.push(noteView);
        noteView.render();
    }
    deleteNoteView(note) {
        let noteViewIndex = this.noteViews.findIndex(x => x.noteId == note.id);
        if (noteViewIndex != -1) {
            let deletedNoteView = this.noteViews.splice(noteViewIndex, 1);
            deletedNoteView[0].dom.remove();
        }
    }
    updateNoteView(note) {
        let noteViewIndex = this.noteViews.findIndex(x => x.noteId == note.id);
        if (noteViewIndex != -1) {
            let noteView = this.noteViews[noteViewIndex];
            noteView.updateModel(note);
        }
    }
    initBroadcastChannel() {
        //broadcast channels updates noteViews according to the changes in other tabs
        this.channel = new BroadcastChannel('BroadcastChannel');
        this.channel.onmessage = async (event) => {
            const message = event.data;
            if (message.type == 'delete') {
                let note = new Note({ ...message.note });
                this.deleteNoteView(note);
            }
            else if (message.type == 'add') {
                let note = new Note({ ...message.note });
                this.addNoteView(note);
            } else if (message.type == 'updated') {
                let note = new Note({ ...message.note });
                this.updateNoteView(note);
            }
        };
    };
};


const userImage = document.getElementById("userImage");
const username = document.getElementById("username");
const login = document.getElementById("login");
const logout = document.getElementById("logout");
logout.style.display = "none";

const database = new Database();
const firebaseClient = new FirebaseClient();
//firebaseclient can manipulate database, but not the note manager
//note manager listens database events and reflect the changes to nodeViews
firebaseClient.init().then(() => {

});


let nm = new NoteManager(database);
nm.init().then(() => {
    let world = document.getElementById('world');
    world.addEventListener('dblclick', (e) => {
        if (e.target == world) {
            database.addNote({ x: e.clientX, y: e.clientY, title: "", content: "" });
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
        firebaseClient.sync(database)
    });

});

logout.addEventListener("click", function () {
    firebaseClient.logout();
});

if (localStorage.getItem('token')) {
    //perform login click
    login.click();
}





