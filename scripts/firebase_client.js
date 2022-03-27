class FirebaseClient {

    constructor() {

        this.firebaseConfig = {
            apiKey: "AIzaSyAD5Ag3FYxGWrv0pYgjQcXdiHzYfi--k1Q",
            authDomain: "easynote-aaaa1.firebaseapp.com",
            projectId: "easynote-aaaa1",
            storageBucket: "easynote-aaaa1.appspot.com",
            messagingSenderId: "559352844761",
            appId: "1:559352844761:web:42353711ac7117f202c9c8",
            measurementId: "G-EQQ7SK816X"
        };
    }

    async init() {
        this.app = firebase.initializeApp(this.firebaseConfig);
        this.firebaseDatabase = firebase.firestore();

    }
    async saveUser(user) {
        //get uid
        console.log(user);
        this.uid = firebase.auth().currentUser.uid;
        let res = await this.firebaseDatabase.collection("user").doc(this.uid).set({
            name: "",
            email: "",
            phone: "",
            address: "",
        });
    };

    async saveNote(note) {

        //get note from firebase && its good because if we are online, local copy is more recent than remote copy
        let existNote = await this.firebaseDatabase.collection('user')
            .doc(this.uid)
            .collection('notes')
            .doc(String(note.id)).get();
        if (!existNote.data() || (note.updatedAt > existNote.data().updatedAt)) {
            if (note.updatedAt ) {
                //remote copy is older than local copy
                let noteModel = {
                    id: String(note.id),
                    title: note.title || '',
                    content: note.content || '',
                    x: note.x || 0,
                    y: note.y || 0,
                    createdAt: dayjs(note.createdAt).unix(),
                    updatedAt: dayjs(note.updatedAt).unix(),

                };
                let collection = `user/${this.uid}/notes`;
                this.firebaseDatabase
                    .collection(collection)
                    .doc(noteModel.id)
                    .set(noteModel);
            }
        }
        return;
    }
    attachDatabase(database) {

        database.on("created", (note) => {
            this.saveNote(note);
        });
        database.on("updated", (note) => {
            this.saveNote(note);
        });
        database.on("deleted", (note) => {
            this.saveNote(note);
        });

    }

    async syncChange(change) {
        //check if note is already existed
        let note = await database.getNote(change.doc.id);
        if (!note) {
            //if not, create new note
            let noteModel = {
                id: Number(change.doc.id),
                title: change.doc.data().title || '',
                content: change.doc.data().content || '',
                x: change.doc.data().x || 0,
                y: change.doc.data().y || 0,
                createdAt: dayjs(change.doc.data().createdAt).unix(),
                updatedAt: dayjs(change.doc.data().updatedAt).unix(),

            };
            database.addNote(noteModel);
        }
        else {//if yes, update note
            //check if local copy is more recent than remote copy
            if (dayjs(change.doc.data().updatedAt).unix() > note.updatedAt) {
                //if yes, update local copy
                note.title = change.doc.data().title || '';
                note.content = change.doc.data().content || '';
                note.x = change.doc.data().x || 0;
                note.y = change.doc.data().y || 0;
                note.createdAt = dayjs(change.doc.data().createdAt).unix();
                note.updatedAt = dayjs(change.doc.data().updatedAt).unix();
                database.updateNote(note);
            } else if (dayjs(change.doc.data().updatedAt).unix() < note.updatedAt) {
                //if no, update remote copy
                this.saveNote(note);
            } else {
                // same timestamp no nothing
            }
        }
    }
    async retention() {
        //get remote copies which are signed as deleted and modified before 2 days
        let deletedNotes = await this.firebaseDatabase.collection('user')
            .doc(this.uid)
            .collection('notes')
            .where('updatedAt', '<', dayjs().subtract(2, 'day').unix())
            .where('deleted', '==', true)
            .get();
        deletedNotes.forEach(async (doc) => {
            await this.firebaseDatabase.collection('user')
                .doc(this.uid)
                .collection('notes')
                .doc(doc.id)
                .delete();
        });
    }
    sync() {

        //get remote copies
        //compare with local copies
        //if there are remote copies more recent than the local copies, update local copies
        //if there are local copies more recent than the remote copies, update remote copies
        //delete copies signed as deleted more than 2 days

        //get remote copies

        this.firebaseDatabase.collection('user')
            .doc(this.uid)
            .collection('notes')
            .onSnapshot(async (snapshot) => {
                let syncedRemoteIds = [];
                snapshot.docChanges().forEach(async change => {
                    syncedRemoteIds.push(change.doc.id);
                    if (change.type === 'added') {
                        //remote copies retrieved here.
                        await this.syncChange(change);
                    }
                    if (change.type === 'modified') {
                        await this.syncChange(change);
                    }
                    if (change.type === 'removed') {
                        let note = await database.getNote(change.doc.id);
                        if (!note) {
                            await database.deleteNote(note, false);
                        }
                    }
                });
                //todo: one time call
                this.retention();
                let localNotes = await database.loadNotes();
                console.log("localNotes",localNotes)
                localNotes.filter(x=>syncedRemoteIds.includes(String(x.id)))
                localNotes.forEach(n=>{
                    this.saveNote(n)
                })
            });
    }

    login() {
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                localStorage.setItem('token', token);
                firebase.auth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(null, token));
                firebase.auth().onAuthStateChanged((user) => {

                    if (user) {
                        this.saveUser(user);
                        this.sync();
                    }
                    resolve(user);
                    console.log('User state change detected from the Background script of the Chrome Extension:', user);
                });
            });
        });
    }
    logout() {
        //get token from local storage
        let token = localStorage.getItem('token');
        var url = 'https://accounts.google.com/o/oauth2/revoke?token=' + token;
        window.fetch(url);

        chrome.identity.removeCachedAuthToken({ token: token }, function () {
            alert('removed');
            //Remove token from local
            localStorage.removeItem('token');
        });
        firebase.auth().signOut();
    }
}
