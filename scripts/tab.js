

class Note {

    constructor(title, content, color, createdAt, updatedAt) {
        //generate id from IndexedDB
        this.id = null;
        this.title = title;
        this.content = content;
        this.color = color;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        //init listeners
        this.history = [];
        this.onChangeCallback = null;

    }

    addHistory() {
        //keep only last 10 history
        if (this.history.length > 10) {
            this.history.shift();
        }
        this.history.push(this.content);
        //notify onchange
        this.onChange();
    }
    //set onchange event
    onChange(callback) {
        this.onChangeCallback = callback;
    }

}

class NoteView {

    constructor(note) {


        //create box dom 
        this.note = note;
        this.dom = document.createElement('div');
        this.dom.classList.add('note');
        this.dom.style.backgroundColor = this.note.color;
        //create drag handle dom
        this.dragHandle = document.createElement('div');
        this.dragHandle.classList.add('drag-handle');
        this.dragHandle.innerHTML = "...";

        //set default style
        this.dom.style.minWidth = "200px";
        this.dom.style.minHeight = "100px";

        this.dom.style.width = "200px";
        this.dom.style.height = "100px";
        this.dom.style.left = "50px";
        this.dom.style.top = "50px";

        this.dom.style.position = "absolute";
        this.dom.style.zIndex = "1";
        this.dom.style.border = "1px solid black";
        this.dom.style.borderRadius = "5px";

        //set width and height
        this.dom.style.width = note.width;
        this.dom.style.height = note.height;
        //set position
        this.dom.style.left = note.x;
        this.dom.style.top = note.y;


        this.dom.appendChild(this.dragHandle);

        //create title dom
        this.titleDom = document.createElement('div');
        this.titleDom.classList.add('title');
        this.titleDom.innerHTML = this.note.title;
        this.dom.appendChild(this.titleDom);
        //create content dom
        this.contentDom = document.createElement('div');
        this.contentDom.classList.add('content');
        this.contentDom.innerHTML = this.note.content;
        this.dom.appendChild(this.contentDom);
        //create history dom
        //watch content and title changes and update note
        this.titleDom.addEventListener('input', (e) => {
            this.note.title = e.target.innerHTML;
            this.note.addHistory();
        }
        );
        this.contentDom.addEventListener('input', (e) => {
            this.note.content = e.target.innerHTML;
            this.note.addHistory();
        }
        );
        //create delete button
        this.deleteButton = document.createElement('button');
        this.deleteButton.classList.add('delete');
        this.deleteButton.innerHTML = 'D';
        this.deleteButton.addEventListener('click', (e) => {
            //show are you sure dialog
            let undo_snack = document.createElement('div');
            undo_snack.classList.add('undo-snack');

            let text = document.createElement('div');
            text.innerHTML = "Undo";
            let countdown = 5;
            let undo_button = document.createElement('button');
            undo_button.classList.add('undo-button');
            undo_button.innerHTML =countdown;

            //set timer to hide snack
            let deleteTimer = setTimeout(() => {

                undo_snack.remove();
                this.onDelete();
            }, 5000);

            //count down from 5 to 0 by second and update snack text
            let tmp = countdown;
            let countDownInterval = setInterval(() => {
                undo_button.innerHTML = (--tmp);
            }, 1000);

            //undo button event 
            undo_button.addEventListener('click', (e) => {
                clearInterval(countDownInterval);
                clearTimeout(deleteTimer);
                this.dom.style.display = "block";
                undo_snack.remove();
            });
            this.dom.style.display = "none";
            undo_snack.appendChild(text);
            undo_snack.appendChild(undo_button);
            document.querySelector(".snack-list").appendChild(undo_snack);

        }
        );
        this.dom.appendChild(this.deleteButton);

        this.dragHandle.addEventListener('mousedown', (e) => {

            //prevent to start drag if selected text avaliable
            if (window.getSelection().toString() !== '') {
                return;
            }
            this.dragStart(e);
        });
        //stop drag when mouse up
        document.addEventListener('mouseup', (e) => {
            this.dragEnd(e);
        });



        document.addEventListener('mousemove', (e) => {
            this.dragMove(e);
        });
        document.addEventListener('mouseup', (e) => {
            this.dragEnd(e);
        });

        //resize from corner by dragging resize handler
        this.resizeHandle = document.createElement('div');

        this.resizeHandle.classList.add('resize-handle');
        this.dom.appendChild(this.resizeHandle);
        this.resizeHandle.addEventListener('mousedown', (e) => {
            this.resizeStart(e);
        }
        );
        document.addEventListener('mouseup', (e) => {
            this.resizeEnd(e);
        }
        );
        document.addEventListener('mousemove', (e) => {
            this.resizeMove(e);
        }
        );

    }

    resizeStart(e) {
        this.resizeStartX = e.clientX;
        this.resizeStartY = e.clientY;
        this.resizeStartWidth = this.dom.offsetWidth;
        this.resizeStartHeight = this.dom.offsetHeight;
        this.resizeStartLeft = this.dom.offsetLeft;
        this.resizeStartTop = this.dom.offsetTop;
        this.resizeStarted = true;
    }

    resizeMove(e) {
        if (!this.resizeStarted) {
            return;
        }

        let width = this.resizeStartWidth + (e.clientX - this.resizeStartX);
        let height = this.resizeStartHeight + (e.clientY - this.resizeStartY);

        //check if it is exceeding style  min
        if (width < parseInt(this.dom.style.minWidth)) {
            width = parseInt(this.dom.style.minWidth);
        }
        if (height < parseInt(this.dom.style.minHeight)) {
            height = parseInt(this.dom.style.minHeight);
        }

        this.dom.style.width = width + "px";
        this.dom.style.height = height + "px";
    }

    resizeEnd(e) {
        this.resizeStarted = false;

    }


    dragStart(e) {
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragStartLeft = this.dom.offsetLeft;
        this.dragStartTop = this.dom.offsetTop;

    }

    dragMove(e) {
        if (this.isDragging) {
            let x = (this.dragStartLeft + e.clientX - this.dragStartX);
            let y = (this.dragStartTop + e.clientY - this.dragStartY);
            x = x + (5 - (x % 5));
            y = y + (5 - (y % 5));
            this.dom.style.left = x + 'px';
            this.dom.style.top = y + 'px';
        }
    }

    dragEnd(e) {
        this.isDragging = false;
        this.dragStartX = null;
        this.dragStartY = null;
        this.dragStartLeft = null;
        this.dragStartTop = null;

    }



    //set ondelete event
    onDelete(callback) {
        this.onDeleteCallback = callback;
    }

    update(note) {
        this.note = note;
    }


    render() {
        document.body.appendChild(this.dom);

    }
}

class NoteManager {

    // In other tab where you want observation of changes
    constructor() {

        this.notes = [];
        this.noteViews = [];
        this.db = new Dexie("EasyNoteDatabase");
        this.db.version(1).stores({
            notes: `++id,createdAt,updatedAt`,
            history: `++id,noteId,createdAt`
        });
        this.initBroadcastChannel();

    }

    initBroadcastChannel() {
        this.channel = new BroadcastChannel('BroadcastChannel');
        this.channel.onmessage = function (event) {
            const message = event.data;
            console.log('A message occurred', message);
        };
    };

    async deleteNote(note) {
        if (note.id != null) {

            this.db.notes.delete(note.id);
            this.db.history.add({ noteId: note.id, createdAt: new Date(), content: note.content });
            this.channel.postMessage({
                type: 'delete',
                note
            });
        }
    }
    async updateNote(note) {
        if (note.id != null) {

            this.db.notes.update(note.id, { ...note, updatedAt: new Date() });
            this.db.history.add({ noteId: note.id, createdAt: new Date(), content: note.content });
            this.channel.postMessage({
                type: 'update',
                note
            });

        }
    }

    async addNote() {
        let note = { createdAt: new Date(), updatedAt: null, name: "Josephine", age: 21 };
        await this.db.notes.add(note);
        console.log(note);
        //create note view
        let noteView = new NoteView(note);
        noteView.render();
        this.noteViews.push(noteView);
        this.channel.postMessage({
            type: 'add',
            note
        });
    }


}
var nm = "";
document.body.onload = () => {

    nm = new NoteManager();
    nm.addNote();
    nm.addNote();
};
