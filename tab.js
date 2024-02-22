
const tabId = uuidv4();
const localStorageID = "EasyNote_2b72694a-dcd2-49f1-8b5c-464d15699c21_bus"
const VERSION = "1.3.0"
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
            this.theme1.innerHTML = ""
            this.theme1.onclick = () => {
                this.changeTheme("Default");
            }

            this.theme2 = document.createElement("a")
            this.theme2.style.background = "rgb(255, 125, 125)"
            this.theme2.onclick = () => {
                this.changeTheme("red");
            }


            this.theme3 = document.createElement("a")
            this.theme3.style.background = "rgb(255, 186, 60)"
            this.theme3.onclick = () => {
                this.changeTheme("orange");
            }
            this.theme4 = document.createElement("a")
            this.theme4.style.background = "rgb(255, 241, 114)"
            this.theme4.onclick = () => {
                this.changeTheme("yellow");
            }
            this.theme5 = document.createElement("a")
            this.theme5.style.background = "rgb(103, 238, 121)"
            this.theme5.onclick = () => {
                this.changeTheme("green");
            }
            /* THEME aqua START*/

            this.theme6 = document.createElement("a")
            this.theme6.style.background = "rgb(0, 255, 255)"
            this.theme6.onclick = () => {
                this.changeTheme("aqua");
            }

            /*THEME aqua END*/

            /* THEME fuchsia START*/

            this.theme7 = document.createElement("a")
            this.theme7.style.background = "rgb(255, 0, 255)"
            this.theme7.onclick = () => {
                this.changeTheme("fuchsia");
            }

            /*THEME fuchsia END*/

            /* THEME silver START*/

            this.theme8 = document.createElement("a")
            this.theme8.style.background = "rgb(192, 192, 192)"
            this.theme8.onclick = () => {
                this.changeTheme("silver");
            }

            /*THEME silver END*/

            /* THEME gold START*/

            this.theme9 = document.createElement("a")
            this.theme9.style.background = "rgb(255, 215, 0)"
            this.theme9.onclick = () => {
                this.changeTheme("gold");
            }

            this.theme10 = document.createElement("a")
            this.theme10.style.background = "rgb(128, 128, 128)"
            this.theme10.onclick = () => {
                this.changeTheme("gray");
            }

            this.theme11 = document.createElement("a")
            this.theme11.style.background = "rgb(192, 192, 192)"
            this.theme11.onclick = () => {
                this.changeTheme("silver");
            }
            /*.note.theme-navy {
    background: rgb(51, 51, 204);
}*/
            this.theme12 = document.createElement("a")
            this.theme12.style.background = "rgb(51, 51, 204)"
            this.theme12.onclick = () => {
                this.changeTheme("navy");
            }



            /*THEME gold END*/

            this.dropdownContent.append(this.theme1);
            this.dropdownContent.append(this.theme2);
            this.dropdownContent.append(this.theme3);
            this.dropdownContent.append(this.theme4);
            this.dropdownContent.append(this.theme5);
            this.dropdownContent.append(this.theme6);
            this.dropdownContent.append(this.theme7);
            this.dropdownContent.append(this.theme8);
            this.dropdownContent.append(this.theme9);
            this.dropdownContent.append(this.theme10);
            this.dropdownContent.append(this.theme11);
            this.dropdownContent.append(this.theme12);

            this.dropdown = document.createElement("div")
            this.dropdown.classList.add("dropdown");
            this.dropdown.classList.add("theme-dropdown");
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
            // this.enableGridDOM = document.getElementById("grid_enabled");
            // this.enableGridDOM.addEventListener("change", (e) => this.onGridEnableListener(e))
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

            } catch (e) {
                console.log(e)
                return;
            }
            this.preferences = preferences || this.preferences


            //========= NOTES =========
            try {
                data = await noteStore.get("default")
                noteObjs = JSON.parse(data.value)
                noteObjs.forEach(x => {
                    x.innerHTML = x.text // for migration
                })
            } catch (e) {
                console.log(e)
                return;
            }

            //========= GRID =========
            let backgroundSelect = document.getElementById("background");
            backgroundSelect.value = this.preferences.background || "grid";
            document.body.classList.add(backgroundSelect.value);

            backgroundSelect.addEventListener("change", (e) => {
                document.body.classList.remove(this.preferences.background);
                document.body.classList.add(e.target.value);
                this.preferences.background = e.target.value
                this.saveChanges()
            })



            //==== FONT ======
            let fontSelect = document.getElementById("font");
            fontSelect.value = this.preferences.font || "Helvetica";
            document.body.style.fontFamily = fontSelect.value;
            fontSelect.addEventListener("change", (e) => {
                document.body.style.fontFamily = e.target.value;
                this.preferences.font = e.target.value
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
