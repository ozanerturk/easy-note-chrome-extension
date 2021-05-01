
const tabId = uuidv4();
const localStorageID = "EasyNote_2b72694a-dcd2-49f1-8b5c-464d15699c21_bus"
const localStorageID_migrated = "EasyNote_2b72694a-dcd2-49f1-8b5c-464d15699c21_migrated"
const localStorage_ID_old = "EasyNote_2b72694a-dcd2-49f1-8b5c-464d15699c21"

document.body.onload = () => {
    var container = document.querySelector("body");
    var dragItem = undefined
    var currentX;
    var currentY;
    var initialX;
    var initialY;
    var xOffset = 0;
    var yOffset = 0

    container.addEventListener("touchstart", dragStart, false);
    container.addEventListener("touchend", dragEnd, false);
    container.addEventListener("touchmove", drag, false);

    container.addEventListener("mousedown", dragStart, false);
    container.addEventListener("mouseup", dragEnd, false);
    container.addEventListener("mousemove", drag, false);
    function dragStart(e) {
        if (e.target.classList.contains("note-header")) {
            dragItem = e.target.parentElement;
            xOffset = e.offsetX
            yOffset = e.offsetY
            currentX = dragItem.style.left;
            currentY = dragItem.style.top;
            if (e.type === "touchstart") {
                initialX = e.touches[0].pageX;
                initialY = e.touches[0].pageY;
            } else {
                initialX = e.pageX;
                initialY = e.pageY;
            }
        }

    }

    function dragEnd(e) {
        if (dragItem) {
            initialX = currentX;
            initialY = currentY;
            let note = noteManager.notes.find(x => x.uniqueId == dragItem.getAttribute("data-uniqueId"))
            note.x = parseInt(dragItem.style.left);
            note.y = parseInt(dragItem.style.top);
            console.log(note)
            noteManager.saveChanges()
            dragItem = undefined;
        }

    }

    function drag(e) {
        if (dragItem) {
            e.preventDefault();
            if (e.type === "touchmove") {
                currentX = e.touches[0].pageX;
                currentY = e.touches[0].pageY;
            } else {
                currentX = e.pageX;
                currentY = e.pageY;
            }
            let x = (currentX - xOffset)
            x = x - (x%10)
            let y = (currentY - yOffset)
            y = y - (y%10)
            dragItem.style.left = x
            dragItem.style.top = y

        }
    }

    class Note {
        constructor(text, x, y, theme, onUpdated) {
            this.uniqueId = uuidv4();
            this.theme = theme || "default";
            this.text = text;
            this.x = x;
            this.y = y;
            this.element = undefined;
            this.onUpdated = onUpdated
        }
        changeTheme(theme) {
            let isChanged = theme != this.theme;
            this.element.classList.remove(`theme-${this.theme}`)
            this.theme = theme;
            this.element.classList.add(`theme-${this.theme}`)
            if (isChanged) {
                this.onUpdated(this)
            }
        }
        buildDropdown() {

            this.dropdownButton = document.createElement("div")
            this.dropdownButton.innerHTML = "[]"
            this.dropdownButton.classList.add("dropbtn");

            this.dropdownContent = document.createElement("div")
            this.dropdownContent.classList.add("dropdown-content");

            this.theme1 = document.createElement("a")
            this.theme1.innerHTML = "Default"
            this.theme1.onclick = () => {
                this.changeTheme("Default");
            }

            this.theme2 = document.createElement("a")
            this.theme2.innerHTML = "Red"
            this.theme2.style.background = "rgb(255, 125, 125)"
            this.theme2.onclick = () => {
                this.changeTheme("red");
            }

            this.theme3 = document.createElement("a")
            this.theme3.style.background = "rgb(103, 238, 121)"
            this.theme3.innerHTML = "Green"
            this.theme3.onclick = () => {
                this.changeTheme("green");
            }
            this.theme4 = document.createElement("a")
            this.theme4.style.background = "rgb(255, 241, 114)"

            this.theme4.innerHTML = "Yellow"
            this.theme4.onclick = () => {
                this.changeTheme("yellow");
            }


            this.dropdownContent.appendChild(this.theme1);
            this.dropdownContent.appendChild(this.theme2);
            this.dropdownContent.appendChild(this.theme3);
            this.dropdownContent.appendChild(this.theme4);

            this.dropdown = document.createElement("div")
            this.dropdown.classList.add("dropdown");
            this.dropdown.appendChild(this.dropdownButton)
            this.dropdown.appendChild(this.dropdownContent)
        }
        buildBody() {

            this.body = document.createElement("div")
            this.body.classList.add("note-body");
            this.body.setAttribute("contentEditable", "true");
            this.body.innerHTML = this.text
            this.body.addEventListener("focusout", (e) => {
                this.text = this.body.innerHTML.trim()
                this.onUpdated(this);
            })

        }
        destroy() {
            this.element.remove()
        }
        buildHeader() {
            this.buildDropdown()

            this.header = document.createElement("div");
            this.header.classList.add("note-header");
            this.header.appendChild(this.dropdown)
        }
        build() {
            this.buildHeader()
            this.buildBody()
            this.element = document.createElement("div");

            this.element.classList.add("note");
            this.element.style.top = this.y;
            this.element.style.left = this.x;

            this.element.appendChild(this.header);
            this.element.appendChild(this.body);
            this.element.setAttribute("data-uniqueId", this.uniqueId)
            this.changeTheme(this.theme);
        }

    }
    class NoteManager {
        constructor() {
            this.notes = []
            this.initDB()
        }

        async initDB() {
            this.notes.forEach(n => {
                n.destroy()
            })
            this.notes = []
            this.db = await idb.openDB('easy-note', 1, {
                upgrade: (db) => {
                    // Create a store of objects
                    let store = db.createObjectStore('notes', {
                        // The 'id' property of the object will be the key.
                        keyPath: 'id',
                        // If it isn't explicitly set, create a value by auto incrementing.
                        // autoIncrement: true,
                    });
                    // Create an index on the 'date' property of the objects.
                    store.createIndex('date', 'date');
                },
            });
            let transaction = this.db.transaction("notes", "readwrite"); // (
            let noteStore = transaction.objectStore("notes"); // (2)
            let data = "";
            let noteObjs = []
            try {
                data = await noteStore.get("default")
                noteObjs = JSON.parse(data.value)
            } catch (e) {
                return;
            }
            for (let n of noteObjs) {
                let note = new Note(n.text, n.x, n.y, n.theme,
                    (note) => this.onNoteUpdated(note))
                note.build()
                document.body.appendChild(note.element)
                this.notes.push(note);
            }
        }

        addNote(text, x, y) {
            let note = new Note(text, x, y, "default",
                (note) => this.onNoteUpdated(note))
            note.build()
            document.body.appendChild(note.element)
            this.notes.push(note);
        }

        onNoteUpdated(note) {
            if (note && !note.body.innerText.replace(/^\s+|\s+$/g, '')) {
                let noteIndex = this.notes.findIndex(x => x.uniqueId == note.uniqueId)
                console.log(note.id)
                if (noteIndex != -1) {
                    let noteToDelete = this.notes.splice(noteIndex, 1)
                    noteToDelete[0].destroy()
                }
            }

            this.saveChanges();
        }
        async saveChanges() {
            console.log("changes saving")
            try {
                let transaction = this.db.transaction("notes", "readwrite"); // (
                let noteStore = transaction.objectStore("notes"); // (2)
                let jsonNotes = JSON.stringify(this.notes)
                await noteStore.put({ id: "default", value: jsonNotes })
                localStorage.setItem(localStorageID, JSON.stringify({ tabId, v: uuidv4() }))
            } catch (e) {
                console.log(e)
                return;
            }
        }
    }

    const noteManager = new NoteManager()

    document.body.ondblclick = (e) => {
        console.log(e)
        if (e.target.tagName == "BODY") {
            noteManager.addNote("newNote", e.pageX, e.pageY)

        }
    }

    window.addEventListener('storage', async function (e) {
        console.log("hh")
        if (e.storageArea === localStorage) {
            if (e.key === localStorageID) {
                if (JSON.parse(localStorage.getItem(localStorageID)).tabId == tabId) {
                    return;
                } else {
                    noteManager.initDB()
                }

            }
        }
    });

    function checkMigrate() {
        setTimeout(async () => {
            let hasOld = localStorage.getItem(localStorage_ID_old)
            console.log(hasOld)
            if (hasOld) {
                let isMigrated = localStorage.getItem(localStorageID_migrated)
                if (!isMigrated) {
                    let noteText = JSON.parse(hasOld).blocks.map(x => {
                        let data = x.data;
                        if (data.text) {
                            return "<p>" + data.text + "</p>";
                        } else if (data.items) {
                            return data.items.map(x => "<p>" + x.text + "</p>").join("")
                        }

                    }).join("")
                    noteManager.addNote(noteText, 100, 100)
                    localStorage.setItem(localStorageID_migrated, "yes")
                    console.log("migration done")
                    await noteManager.saveChanges()
                }
            }
            isMigrated = localStorage.getItem(localStorageID_migrated)
        }, 1000);
    }
    checkMigrate();
}
