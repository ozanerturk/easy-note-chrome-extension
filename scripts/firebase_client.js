class FirebaseClient extends MyEventEmitter {

    constructor() {
        super();
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
        this.synced = [];
        this.app = firebase.initializeApp(this.firebaseConfig);
        this.firebaseDatabase = firebase.firestore();
        this.firebaseDatabase.useEmulator("localhost", 8080);

    }
    async saveUser(user) {
        //get uid
        console.log("user saved", user);
        this.uid = firebase.auth().currentUser.uid;
        let res = await this.firebaseDatabase.collection("user").doc(this.uid).set({
            name: "",
            email: "",
            phone: "",
            address: "",
        });
    };

    async saveNote(note) {
        //no need to check if remote copy is more recent than local, since it will be updated by syncChange
        console.log("update remote note", note);
        let noteModel = {
            id: note.id,
            title: note.title || '',
            content: note.content || '',
            x: note.x || 0,
            y: note.y || 0,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            deleted: note.deleted || false

        };
        let collection = `user/${this.uid}/notes`;
        await this.firebaseDatabase
            .collection(collection)
            .doc(noteModel.id)
            .set(noteModel);
        return;
    }


    async syncChange(doc) {
        //caution, sync does not make confilict resolution, so if there are two copies of the same note, the latest one will be kept
        //check if note is already existed
        let note = await database.getNote(doc.id);
        console.log("local note", note, " for", doc.id);
        if (!note) {
            //if not, create new note
            let noteModel = {
                id: doc.id,
                title: doc.data().title || '',
                content: doc.data().content || '',
                x: doc.data().x || 0,
                y: doc.data().y || 0,
                createdAt: doc.data().createdAt.toDate(),
                updatedAt: doc.data().updatedAt.toDate(),
                deleted: doc.data().deleted || false
            };

            console.log("[FIREBASECLIENT]","new note created", doc.data().id);
            await database.addNote(noteModel);
        }
        else {
            //if note exists, update the note
            //check if local copy is more recent than remote copy
            let remoteDate = dayjs(doc.data().updatedAt.toDate());
            let localDate = dayjs(note.updatedAt);
            console.log(remoteDate, localDate);

            if (remoteDate.isAfter(localDate)) {
                //if remote copy is more recent, update local copy
                // console.log("[FIREBASECLIENT]","remote note is more recent", doc.id, doc.data().updatedAt.toDate());
                note.title = doc.data().title || '';
                note.content = doc.data().content || '';
                note.x = doc.data().x || 0;
                note.y = doc.data().y || 0;
                note.createdAt = doc.data().createdAt.toDate();
                note.updatedAt = doc.data().updatedAt.toDate();
                note.deleted = doc.data().deleted || false;
                await database.updateNote(note);
            } else if (localDate.isAfter(remoteDate)) {
                //if local copy more recent, update remote copy
                console.log("local note is more recent", note);
                await this.saveNote(note);
            } else {
                console.log("same timestamp");
                // same timestamp no nothing
            }
        }
    }
    async retention() {
        //get remote copies which are signed as deleted and modified before 2 days
        let deletedNotes = await this.firebaseDatabase.collection('user')
            .doc(this.uid)
            .collection('notes')
            .where('updatedAt', '<', dayjs().subtract(2, 'day').toDate())
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
    async sync(database) {
        //delete copies signed as deleted more than 2 days
        await this.retention();

        //get remote copies
        let snapshot = await this.firebaseDatabase.collection('user')
            .doc(this.uid)
            .collection('notes')
            .where('deleted', '==', false)
            .get();

        console.log("remote notes received length", snapshot.docs.length);

        let syncedIds = [];
        await snapshot.forEach(async doc => {
            //sync local copies with remotes
            syncedIds.push(doc.id);
            await this.syncChange(doc);
        });
        console.log("has been synced count:", syncedIds.length);

        let localNotes = await database.loadNotes();

        //if there are local copies more recent than the remote copies, update remote copies
        //filter local notes not contains remotenotes
        let localNotesFiltered = localNotes.filter(note => {
            return !syncedIds.includes(note.id);
        });
        console.log("localNotesFiltered", localNotesFiltered);
        await localNotesFiltered.forEach(async n => {
            await this.saveNote(n);
        });



        //after sync complete we can listen for local changes

        database.on("created", (note) => {
            this.saveNote(note);
        });
        database.on("updated", (note) => {
            this.saveNote(note);
        });
        database.on("deleted", (note) => {
            this.saveNote(note);
        });
        console.log("sync completed");
    }

    login() {
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                localStorage.setItem('token', token);
                firebase.auth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(null, token));
                firebase.auth().onAuthStateChanged((user) => {

                    if (user) {
                        this.saveUser(user);
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
