
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
    var maximizedNote = null;

    container.addEventListener("touchstart", dragStart, false);
    container.addEventListener("touchend", dragEnd, false);
    container.addEventListener("touchmove", drag, false);

    container.addEventListener("mousedown", dragStart, false);
    container.addEventListener("mouseup", dragEnd, false);
    container.addEventListener("mousemove", drag, false);

    container.addEventListener("mouseup", function (event) {
        var hasValue = window.getSelection().isCollapsed;
        // console.log(window.getSelection(), currentX, currentY)
    }, false);
    window.addEventListener("click", () => {
        if (maximizedNote) {
            console.log(maximizedNote)
            maximizedNote.element.classList.remove("note-maximized")
        }
    })
    function dragStart(e) {

        if (e.target.classList.contains("note-header")) {
            console.log(e.target.parentElement)
            if (e.target.parentElement.classList.contains("note-maximized")) {
                return;
            }
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
            noteManager.saveChanges()
            dragItem = undefined;
        }
    }

    var pageX;
    var pageY;

    document.addEventListener("mouseup", function (e) {
        pageX = e.pageX;
        pageY = e.pageY;

    })

    function drag(e) {
        if (e.type === "touchmove") {
            currentX = e.touches[0].pageX;
            currentY = e.touches[0].pageY;
        } else {
            currentX = e.pageX;
            currentY = e.pageY;
        }
        if (dragItem) {


            let x = (currentX - xOffset)
            let y = (currentY - yOffset)
            x = x - (x % 10) + 1
            y = y - (y % 10) + 1
            dragItem.style.left = x
            dragItem.style.top = y

        }
    }
    function unescapeHTML(e) {
        return e.replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/<div>/, '<p>')
            .replace(/<\/div>/, '</p>');
    }
    class Note {
        constructor(contents, x, y, width, height, theme, innerHTML, onUpdated) {
            this.uniqueId = uuidv4();
            this.theme = theme || "default";
            this.contents = contents;
            this.x = x;
            this.y = y;
            this.width = width
            this.height = height;
            this.element = undefined;
            this.onUpdated = onUpdated
            this.innerHTML = innerHTML // migariton

        }
        renderQuill() {
            this.body.style.display = "block"
            this.quill = new Quill(this.body, {
                modules: {
                    toolbar: {
                        container: this.toolbar  // Selector for toolbar container
                    }
                },
                theme: 'snow'
            });
            if (this.innerHTML == undefined) {
                this.quill.setContents(this.contents)
            } else {
                console.log("here", this.innerHTML)
                this.contents = this.quill.getContents()
                this.onUpdated()
            }
            this.quill.on('text-change', (delta, oldDelta, source) => {
                this.contents = this.quill.getContents()
            });
            this.quill.on('selection-change', (range, oldRange, source) => {
                if (range === null && oldRange !== null) {
                    this.onUpdated(this);
                } else if (range !== null && oldRange === null) {
                    //focus
                }
            });

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
            this.theme3.style.background = "rgb(255, 186, 60)"
            this.theme3.innerHTML = "Orange"
            this.theme3.onclick = () => {
                this.changeTheme("orange");
            }
            this.theme4 = document.createElement("a")
            this.theme4.style.background = "rgb(255, 241, 114)"
            this.theme4.innerHTML = "Yellow"
            this.theme4.onclick = () => {
                this.changeTheme("yellow");
            }
            this.theme5 = document.createElement("a")
            this.theme5.style.background = "rgb(103, 238, 121)"
            this.theme5.innerHTML = "Green"
            this.theme5.onclick = () => {
                this.changeTheme("green");
            }

            this.dropdownContent.append(this.theme1);
            this.dropdownContent.append(this.theme2);
            this.dropdownContent.append(this.theme3);
            this.dropdownContent.append(this.theme4);
            this.dropdownContent.append(this.theme5);

            this.dropdown = document.createElement("div")
            this.dropdown.classList.add("dropdown");
            this.dropdown.append(this.dropdownButton)
            this.dropdown.append(this.dropdownContent)
        }
        buildQuill() {


        }
        buildBody() {
            this.bodyWrapper = document.createElement("div");
            this.bodyWrapper.classList.add("note-body-wrapper");

            if (this.width) {
                this.bodyWrapper.style.width = this.width + "px";
            }
            if (this.height) {
                this.bodyWrapper.style.height = this.height + "px";

            }

            this.resizer = document.createElement("div");
            this.resizer.classList.add("resizer");
            this.resizer.classList.add("bottom-right");

            this.toolbar = document.createElement("div");
            this.toolbar.classList.add("ql-toolbar")
            this.toolbar.classList.add("ql-snow")
            this.toolbar.innerHTML = `  <span class="ql-formats">
            <select class="ql-font"></select>
            <select class="ql-size"></select>
            </span>
            <span class="ql-formats">
            <button class="ql-bold"></button>
            <button class="ql-italic"></button>
            <button class="ql-underline"></button>
            <button class="ql-strike"></button>
            </span>
            <span class="ql-formats">
            <select class="ql-color"></select>
            <select class="ql-background"></select>
            </span>
            <span class="ql-formats">
            <button class="ql-script" value="sub"></button>
            <button class="ql-script" value="super"></button>
            </span>
            <span class="ql-formats">
            <button class="ql-header" value="1"></button>
            <button class="ql-header" value="2"></button>
            <button class="ql-blockquote"></button>
            <button class="ql-code-block"></button>
            </span>
            <span class="ql-formats">
            <button class="ql-list" value="ordered"></button>
            <button class="ql-list" value="bullet"></button>
            <button class="ql-indent" value="-1"></button>
            <button class="ql-indent" value="+1"></button>
            </span>
            <span class="ql-formats">
            <button class="ql-direction" value="rtl"></button>
            <select class="ql-align"></select>
            </span>
            <span class="ql-formats">
            <button class="ql-link"></button>
            <button class="ql-image"></button>
            <button class="ql-video"></button>
            <button class="ql-formula"></button>
            </span>
            <span class="ql-formats">
            <button class="ql-clean"></button>
            </span>`
            this.bodyWrapper.append(this.toolbar)

            this.body = document.createElement("div")
            this.body.classList.add("note-body");
            // console.log(unescapeHTML(this.innerHTML))
            if (this.innerHTML) {
                this.body.innerHTML = this.innerHTML
            }

            this.bodyWrapper.append(this.body);
            this.bodyWrapper.append(this.resizer);



        }
        destroy() {
            this.element.remove()
        }
        buildHeader() {
            this.buildDropdown()

            this.header = document.createElement("div");
            this.header.classList.add("note-header");
            this.header.append(this.dropdown)
            this.header.ondblclick = (e) => {
                maximizedNote = this;
                this.element.classList.add("note-maximized")

            }
        }
        build() {
            this.buildHeader()
            this.buildBody()

            this.element = document.createElement("div");
            this.element.addEventListener("click", (ev) => {
                ev.stopPropagation();
            })
            this.element.classList.add("note");
            this.element.style.top = this.y;
            this.element.style.left = this.x;

            this.element.append(this.header);
            this.element.append(this.bodyWrapper);

            this.element.setAttribute("data-uniqueId", this.uniqueId)
            this.changeTheme(this.theme);
            makeResizableDiv(this.bodyWrapper)

        }

    }
    class NoteManager {
        constructor() {
            this.notes = []
            this.initDB()
            this.preferences = {
                enableGrid: true
            }
            this.enableGridDOM = document.getElementById("grid_enabled");
            this.enableGridDOM.addEventListener("change", (e) => this.onGridEnableListener(e))
        }
        checkGrid() {
            if (this.preferences.enableGrid) {
                document.body.classList.add("grid")
                this.enableGridDOM.checked = true
            } else {
                document.body.classList.remove("grid")
                this.enableGridDOM.checked = false
            }
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
            let preferences;
            try {
                data = await noteStore.get("default")
                preferences = (await noteStore.get("preferences")).value
                noteObjs = JSON.parse(data.value)
                noteObjs.forEach(x => {
                    x.innerHTML = x.text // for migration
                })
            } catch (e) {
                console.log(e)
                return;
            }
            this.preferences = preferences || this.preferences

            this.checkGrid()

            for (let n of noteObjs) {
                let note = new Note(n.contents, n.x, n.y, n.width, n.height, n.theme, n.innerHTML,
                    (note) => this.onNoteUpdated(note))
                note.build()
                document.body.append(note.element)
                this.notes.push(note);
            }
            for (let n of this.notes) {
                n.renderQuill()
            }
        }
        onGridEnableListener(e) {
            this.preferences.enableGrid = e.target.checked
            this.checkGrid()
            this.saveChanges()
        }
        addNote(text, x, y, innerHTML) {
            let note = new Note(text, x, y, "", null, null, innerHTML,
                (note) => this.onNoteUpdated(note))
            note.build()

            document.body.append(note.element)
            note.renderQuill()
            note.quill.focus()

            this.notes.push(note);
            note.body.focus();


        }

        onNoteUpdated(note) {
            if (note && !note.body.innerText.replace(/^\s+|\s+$/g, '') && !note.body.querySelector("img")) {
                let noteIndex = this.notes.findIndex(x => x.uniqueId == note.uniqueId)
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
                let jsonNotes = JSON.stringify(this.notes, (key, value) => {
                    if (["__quill", "quill", "innerHTML"].includes(key)) return undefined
                    return value;
                })
                await noteStore.put({ id: "default", value: jsonNotes })
                await noteStore.put({ id: "preferences", value: this.preferences })
                localStorage.setItem(localStorageID, JSON.stringify({ tabId, v: uuidv4() }))
            } catch (e) {
                console.log(e)
                return;
            }
        }
    }

    const noteManager = new NoteManager()

    document.body.ondblclick = (e) => {
        if (e.target.tagName == "BODY") {
            noteManager.addNote("", e.pageX, e.pageY, null)
        }
    }

    window.addEventListener('storage', async function (e) {
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



    function makeResizableDiv(element) {
        // const element = document.querySelector(div);
        const resizers = element.querySelectorAll('.resizer')
        const minimum_size = 20;
        let width, height;
        let isResizing = false;
        let original_width = 0;
        let original_height = 0;
        let original_x = 0;
        let original_y = 0;
        let original_mouse_x = 0;
        let original_mouse_y = 0;
        for (let i = 0; i < resizers.length; i++) {
            const currentResizer = resizers[i];
            currentResizer.addEventListener('mousedown', function (e) {
                e.preventDefault()
                original_width = parseFloat(getComputedStyle(element, null).getPropertyValue('width').replace('px', ''));
                original_height = parseFloat(getComputedStyle(element, null).getPropertyValue('height').replace('px', ''));
                original_x = element.getBoundingClientRect().left;
                original_y = element.getBoundingClientRect().top;
                original_mouse_x = e.pageX;
                original_mouse_y = e.pageY;
                window.addEventListener('mousemove', resize)
                window.addEventListener('mouseup', stopResize)
            })

            function resize(e) {
                if (currentResizer.classList.contains('bottom-right')) {
                    isResizing = true;
                    width = parseInt(original_width + (e.pageX - original_mouse_x))
                    height = parseInt(original_height + (e.pageY - original_mouse_y))
                    if (width > minimum_size) {
                        element.style.width = width + 'px'
                    }
                    if (height > minimum_size) {
                        element.style.height = height + 'px'
                    }
                } else {
                    isResizing = false;
                }

            }

            function stopResize() {
                if (isResizing) {
                    let mWidth = (width % 10)
                    let mHeight = (height % 10)
                    if (mWidth < 5) {
                        mWidth = -mWidth - 3
                    } else {
                        mWidth = 10 - mWidth - 3
                    }
                    if (mHeight < 5) {
                        mHeight = -mHeight - 1
                    } else {
                        mHeight = 10 - mHeight - 1
                    }
                    element.style.width = width + mWidth
                    element.style.height = height + mHeight
                    isResizing = false;
                    window.removeEventListener('mousemove', resize)
                    let n = noteManager.notes.find(x => x.uniqueId == element.parentElement.getAttribute("data-uniqueId"))
                    n.width = width;
                    n.height = height;
                    noteManager.saveChanges()
                }

            }
        }
    }
}
