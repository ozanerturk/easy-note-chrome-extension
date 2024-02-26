
const tabId = uuidv4();
const localStorageID = "EasyNote_2b72694a-dcd2-49f1-8b5c-464d15699c21_bus"
const VERSION = "1.3.0"

const PREFERENCES = {
    _: {},
    get(key, defaultValue) {
        return this._[key] || defaultValue
    },
    set(key, value) {
        this._[key] = value
    },
    init(prefs) {
        this._ = prefs
    }
}

const SERACH = {
    serach_input: null,
    backspace_count: 0,
    init(e) {
        this.serach_input = e
        this.serach_input.addEventListener("keydown", (e) => {
            if (e.key == "Backspace") {
                if (this.serach_input.value == "") {
                    this.backspace_count++
                    console.log(this.backspace_count)
                }
                if (this.backspace_count) {
                    this.backspace_count = 0;
                    SERACH.hide()
                } else {
                    this.serach_input.setAttribute("placeholder", "Press Backspace to clear search")
                }
            }
        })
        this.serach_input.addEventListener("input", (e) => {
            SERACH.filter()
        })

    },
    hide() {
        this.serach_input.value = ""
        this.serach_input.style.display = "none"
        let notes = document.querySelectorAll(".note")

        notes.forEach(x => {
            x.style.display = "block"
        })
        document.body.classList.remove("searching")
        document.body.focus()
    },
    show(m) {
        this.serach_input.value = m
        this.serach_input.style.display = "flex"
        document.body.classList.add("searching")
        this.serach_input.focus()
        this.filter()
    },
    filter() {
        let notes = document.querySelectorAll(".note")
        notes.forEach(x => {
            if (x.innerText.toLowerCase().includes(this.serach_input.value.toLowerCase())) {
                x.style.display = "block"
            } else {
                x.style.display = "none"
            }
        })
    }
}

const NOTIFICATION = {
    message(msg, duration = 1500) {
        let notification_div = document.querySelector(".notification")
        let message = document.createElement("div")
        if (msg instanceof HTMLElement) {
            message.appendChild(msg)
        } else {
            message.innerHTML = msg
        }
        notification_div.appendChild(message)

        setTimeout(() => {
            notification_div.removeChild(message)
        }, duration)

        return message
    }
}

// Function to backup IndexedDB data
async function backupIndexedDB(db, backupFileName) {

    const transaction = db.transaction(db.objectStoreNames, 'readonly');
    const backupData = {};

    for (let storeName of db.objectStoreNames) {
        const objectStore = transaction.objectStore(storeName);
        const results = await objectStore.getAll();

        backupData[storeName] = results
    }

    const blob = new Blob([JSON.stringify(backupData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName;
    a.click();

}

// Function to restore IndexedDB data
async function restoreIndexedDB(db, fileInput) {
    if (!fileInput.files[0]) {
        alert("Please select a file to restore.")
        return
    }
    let content = await fileInput.files[0].text();
    let json = JSON.parse(content);
    console.log(json)
    if (!json.notes) {
        alert("This backup file is not compatible with this version of Easy Note. Please use a backup file created with the same version of Easy Note.")
        return
    }
    let version = json.notes.find(x => x.id === "version")
    if (!version) {
        alert("This backup file is not compatible with this version of Easy Note. Please use a backup file created with the same version of Easy Note.")
        return
    }
    version = version.value;
    if (version.split(".")[0] !== VERSION.split(".")[0] || version.split(".")[1] !== VERSION.split(".")[1]) {
        alert("This backup file is not compatible with this version of Easy Note. Please use a backup file created with the same version of Easy Note.")
        return
    }
    let r = confirm("Are you sure you want to restore this backup?")
    if (!r) {
        return
    }
    for (let storeName of db.objectStoreNames) {
        let objectStore = db.transaction(storeName, "readwrite").objectStore(storeName);
        await objectStore.clear();
    }
    for (let storeName in json) {
        let objectStore = db.transaction(storeName, "readwrite").objectStore(storeName);
        for (let obj of json[storeName]) {
            objectStore.add(obj);
        }
    }
    //reload
    location.reload()
}
document.body.onload = () => {

    let clicked_note = null
    const serach_input = document.querySelector("#search-bar")
    SERACH.init(serach_input)

    const note_options = document.querySelector(".note-options")
    const note_options_copy_btn = document.querySelector(".note-options #copy")
    const note_options_sendToBack_btn = document.querySelector(".note-options #toBack")
    const note_options_sendToFront_btn = document.querySelector(".note-options #toFront")
    const note_options_delete_btn = document.querySelector(".note-options #delete")



    const note_theme_btns = document.querySelectorAll(".note-options .theme div")
    note_theme_btns.forEach(x => {
        x.addEventListener("click", () => {
            if (clicked_note) {
                clicked_note.changeTheme(x.dataset.value)
                noteManager.saveChanges()
                note_options.style.display = "none"
            }
        })
    })

    note_options_delete_btn.addEventListener("click", () => {
        if (clicked_note) {
            clicked_note.element.style.display = "none"
            //remove clicked_note
            let cancel_btn = document.createElement("button")
            cancel_btn.focus()
            cancel_btn.style.cursor = "pointer"
            cancel_btn.style.border = "none"
            cancel_btn.style.padding = "5px"

            duration = 3
            let message = NOTIFICATION.message(cancel_btn, duration * 1000)
            cancel_btn.innerHTML = "F5 to save your ass  in " + duration + " seconds"

            let interval = setInterval(function () {
                duration -= 1
                cancel_btn.innerHTML = "F5 to save your ass  in " + duration + " seconds"
            }, 1000)
            let deleteTask = setTimeout((clicked_note) => {
                let index = noteManager.notes.findIndex(x => x.uniqueId == clicked_note.uniqueId)
                if (index != -1) {
                    noteManager.notes.splice(index, 1)
                    noteManager.saveChanges()
                    clicked_note.element.remove()
                    clicked_note = null
                    clearInterval(interval)
                    message.remove()
                }
            }, duration * 1000, clicked_note)

            cancel_btn.addEventListener("click", () => {
                clicked_note.element.style.display = "block"
                clearTimeout(deleteTask)
                clearInterval(interval)
                message.remove()
                cancel_btn.remove()
            })

        }
    })

    note_options_copy_btn.addEventListener("click", () => {
        if (clicked_note) {
            //copy clicked_note text to clipboard
            let text = clicked_note.quill.getText(0, Number.MAX_SAFE_INTEGER)
            navigator.clipboard.writeText(text)
            NOTIFICATION.message("Text copied to clipboard")
        }
    })

    note_options_sendToBack_btn.addEventListener("click", () => {
        if (clicked_note) {
            //pop clicked_note and push it to the end
            let index = noteManager.notes.indexOf(clicked_note)
            console.log(index)
            noteManager.notes.splice(index, 1)
            noteManager.notes.unshift(clicked_note)
            noteManager.saveChanges()
            //move element to beginning of document
            clicked_note.element.remove()
            document.body.prepend(clicked_note.element)
            clicked_note = null

        }
    })
    note_options_sendToFront_btn.addEventListener("click", () => {
        if (clicked_note) {
            //pop clicked_note and push it to the end
            let index = noteManager.notes.indexOf(clicked_note)
            console.log(index)
            noteManager.notes.splice(index, 1)
            noteManager.notes.push(clicked_note)
            noteManager.saveChanges()
            //move element to beginning of document
            clicked_note.element.remove()
            document.body.append(clicked_note.element)
            clicked_note = null
        }
    })



    const noteoptions = document.querySelector(".ss-content.note-options")
    document.title = `Easy Note - ${VERSION}`
    // Add fonts to whitelist
    const Font = Quill.import('formats/font');
    console.log(Font)
    Font.attrName = "asdfasdf "
    Font.keyName = "ql-font"
    // We do not add Aref Ruqaa since it is the default
    Font.whitelist = [
        "poppins",
        "lato",
        "raleway",
        "montserrat",
        "helvetica",
        "arial",
        "times+new+roman",
        "georgia",
        "courier+new",
        "lucida+console",
        "quicksand",
        "merriweather",
        "droid+serif"
    ];
    Quill.register(Font, true);

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
            maximizedNote.element.classList.remove("note-maximized")
        }
    })
    function dragStart(e) {
        if (e.target.classList.contains("note-header")) {
            e.preventDefault();

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

            this.resizerBottomRight = document.createElement("div");
            this.resizerBottomRight.classList.add("resizer");
            this.resizerBottomRight.classList.add("bottom-right");

            this.resizerTopLeft = document.createElement("div");
            this.resizerTopLeft.classList.add("resizer");
            this.resizerTopLeft.classList.add("top-left");

            this.toolbar = document.createElement("div");
            this.toolbar.innerHTML = document.getElementsByTagName("template")[0].innerHTML
            this.bodyWrapper.append(this.toolbar)

            this.body = document.createElement("div")
            this.body.classList.add("note-body");
            // console.log(unescapeHTML(this.innerHTML))
            if (this.innerHTML) {
                this.body.innerHTML = this.innerHTML
            }

            this.bodyWrapper.append(this.body);
            this.bodyWrapper.append(this.resizerTopLeft);
            this.bodyWrapper.append(this.resizerBottomRight);



        }
        destroy() {
            this.element.remove()
        }
        buildHeader() {

            this.option_btn = document.createElement("div");
            this.option_btn.classList.add("option-btn");
            this.option_btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                note_options.style.display = "flex"
                note_options.style.position = "fixed"
                //remove cursor
                note_options.style.cursor = "default"
                note_options.style.left = this.option_btn.getBoundingClientRect().x - 30 + "px"
                note_options.style.top = this.option_btn.getBoundingClientRect().y + "px"
                clicked_note = this
                document.addEventListener("click", (e) => {
                    note_options.style.display = "none"

                }, { once: true })



            })

            this.header = document.createElement("div");
            this.header.classList.add("note-header");
            this.header.append(this.option_btn);


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
            this.element.addEventListener("click", (e) => {
                //check if body is ".searching"
                console.log(document.body.classList.contains("searching"))
                if (document.body.classList.contains("searching")) {
                    SERACH.hide()
                    maximizedNote = this
                    this.element.classList.add("note-maximized")
                }
            })
            this.changeTheme(this.theme);
            makeResizableDiv(this.bodyWrapper)

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

            //========= VERSION =========
            let version;
            try {
                version = (await noteStore.get("version")).value
            } catch (e) {
                console.log(e)
            }
            if (!version) {
                console.log("migrating...")
                await noteStore.put({ id: "version", value: VERSION })
                //migrate if neccessary
            }


            //========= PREFERENCES =========

            let preferences;
            try {
                preferences = (await noteStore.get("preferences")).value
                PREFERENCES.init(preferences)

            } catch (e) {
                console.log(e)
                return;
            }

            //========= NOTES =========
            try {
                data = await noteStore.get("default")
                noteObjs = JSON.parse(data.value)
                noteObjs.forEach(x => {
                    x.innerHTML = x.text // for migration
                })
            } catch (e) {
                console.log(e)
            }

            //========= GRID =========
            let backgroundValue = PREFERENCES.get("background", "grid-dots");
            let backgroundSelect = document.getElementById("background");
            backgroundSelect.value = backgroundValue
            document.body.classList.add(backgroundValue);

            backgroundSelect.addEventListener("change", (e) => {
                document.body.classList.remove(backgroundValue);
                document.body.classList.add(e.target.value);
                PREFERENCES.set("background", e.target.value)
                this.saveChanges()
            })



            //==== FONT ======
            let fontSelect = document.getElementById("font");
            let fontValue = PREFERENCES.get("font", "Helvetica");
            fontSelect.value = fontValue
            document.body.style.fontFamily = fontSelect.value;
            fontSelect.addEventListener("change", (e) => {
                document.body.style.fontFamily = e.target.value;
                PREFERENCES.set("font", e.target.value)
                this.saveChanges()
            })


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

            let preferencesbtn = document.getElementById("preferencesbtn")
            let preferencesDom = document.getElementById("preferences")
            preferencesbtn.addEventListener("click", (e) => {
                preferencesDom.classList.add("open")
                const closeListeren = (e) => {
                    if (!preferencesDom.contains(e.target)) {
                        preferencesDom.classList.remove("open")
                    }
                    document.removeEventListener("click", closeListeren)
                }
                e.stopPropagation();
                document.addEventListener("click", closeListeren)

            })

            document.getElementById("backup").addEventListener("click", async (e) => {
                await backupIndexedDB(this.db, "EasyNotev3" + new Date().toISOString() + ".json")

            })

            document.getElementById("restore").addEventListener("click", async (e) => {
                await restoreIndexedDB(this.db, document.getElementById("restoreFile"))
            })
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
                await noteStore.put({ id: "preferences", value: PREFERENCES._ })
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
            if (!document.body.classList.contains("searching")) {
                noteManager.addNote("", e.pageX, e.pageY, null)
            }
        }
    }
    //on ESC
    document.body.onkeydown = (e) => {
        //if F5 is pressed
        if (e.key == "F5") {

        }
        if (e.key == "Escape") {
            SERACH.hide()
            if (maximizedNote) {
                maximizedNote.element.classList.remove("note-maximized")
            }
        }
        else if (document.activeElement == document.body && !document.body.classList.contains("searching")) {
            e.preventDefault()
            e.stopPropagation()
            //check if keycode is not a letter
            if (e.key.length == 1) {
                SERACH.show(e.key)
            }
        }

    }

    //on Enter


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
        let orginal_parent_left = 0;
        let orginal_parent_top = 0;
        let original_mouse_x = 0;
        let original_mouse_y = 0;
        let original_opacity = 1;
        for (let i = 0; i < resizers.length; i++) {
            const currentResizer = resizers[i];
            currentResizer.addEventListener('mousedown', function (e) {
                e.preventDefault()
                original_width = parseFloat(getComputedStyle(element, null).getPropertyValue('width').replace('px', ''));
                original_height = parseFloat(getComputedStyle(element, null).getPropertyValue('height').replace('px', ''));
                original_min_height = parseFloat(getComputedStyle(element, null).getPropertyValue('min-height').replace('px', ''));
                original_min_width = parseFloat(getComputedStyle(element, null).getPropertyValue('min-width').replace('px', ''));
                orginal_parent_left = parseFloat(element.parentElement.style.left);
                orginal_parent_top = parseFloat(element.parentElement.style.top);
                original_mouse_x = e.pageX;
                original_mouse_y = e.pageY;
                original_opacity = element.style.opacity
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
                if (currentResizer.classList.contains('top-left')) {
                    isResizing = true;
                    //while bottom right is anchor point
                    let shiftX = parseFloat(e.pageX - original_mouse_x)
                    let shiftY = parseFloat(e.pageY - original_mouse_y)

                    width = parseInt(original_width - shiftX)
                    height = parseInt(original_height - shiftY)
                    if (width > minimum_size) {
                        element.style.width = width + 'px'
                        if (width >= original_min_width) {
                            element.parentElement.style.left = orginal_parent_left + shiftX + 'px'
                        }

                    }
                    if (height > minimum_size) {
                        element.style.height = height + 'px'

                        if (height >= original_min_height) {
                            element.parentElement.style.top = orginal_parent_top + shiftY + 'px'
                        }
                    }
                }
                element.style.opacity = 0.5

            }

            function stopResize() {
                // if (isResizing) {
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
                element.style.opacity = original_opacity
                isResizing = false;
                window.removeEventListener('mousemove', resize)
                let n = noteManager.notes.find(x => x.uniqueId == element.parentElement.getAttribute("data-uniqueId"))
                n.width = width
                n.height = height
                n.y = parseFloat(element.parentElement.style.top)
                n.x = parseFloat(element.parentElement.style.left)
                noteManager.saveChanges()
            }

            // }
        }
    }
}
