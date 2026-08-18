(() => {
  const DB_NAME = "easynote";
  const DB_VERSION = 1;
  const STORE = "notes";
  const COLORS = ["#fff6a3", "#ffd6d6", "#d6f5d6", "#d6e8ff", "#e6d6ff"];

  const canvas = document.getElementById("canvas");
  const hint = document.getElementById("hint");

  let db;
  let zCounter = 1;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function getAllNotes() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function putNote(note) {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(note);
  }

  function deleteNoteRecord(id) {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
  }

  function updateHint(count) {
    hint.style.display = count ? "none" : "block";
  }

  function createNote(x, y) {
    const note = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      x,
      y,
      width: 200,
      height: 150,
      text: "",
      color: COLORS[canvas.querySelectorAll(".note").length % COLORS.length],
      z: ++zCounter,
    };
    const el = renderNote(note);
    putNote(note);
    updateHint(canvas.querySelectorAll(".note").length);
    el.querySelector(".note-body").focus();
  }

  function bringToFront(note, el) {
    note.z = ++zCounter;
    el.style.zIndex = note.z;
  }

  function renderNote(note) {
    const el = document.createElement("div");
    el.className = "note";
    el.style.left = `${note.x}px`;
    el.style.top = `${note.y}px`;
    el.style.width = `${note.width}px`;
    el.style.height = `${note.height}px`;
    el.style.background = note.color;
    el.style.zIndex = note.z;
    el.dataset.id = note.id;

    const header = document.createElement("div");
    header.className = "note-header";

    const closeBtn = document.createElement("button");
    closeBtn.className = "note-btn";
    closeBtn.textContent = "×";
    closeBtn.title = "Delete note";
    closeBtn.addEventListener("click", () => {
      el.remove();
      deleteNoteRecord(note.id);
      updateHint(canvas.querySelectorAll(".note").length);
    });

    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "note-body";
    body.contentEditable = "true";
    body.dataset.placeholder = "Type here…";
    body.textContent = note.text;
    body.addEventListener("input", () => {
      note.text = body.textContent;
      putNote(note);
    });
    body.addEventListener("mousedown", () => bringToFront(note, el));

    el.appendChild(header);
    el.appendChild(body);
    canvas.appendChild(el);

    makeDraggable(el, header, note);
    makeResizable(el, note);

    return el;
  }

  function makeDraggable(el, handle, note) {
    let startX, startY, startLeft, startTop;

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      bringToFront(note, el);
      startX = e.clientX;
      startY = e.clientY;
      startLeft = note.x;
      startTop = note.y;
      handle.setPointerCapture(e.pointerId);

      const onMove = (moveEvent) => {
        note.x = startLeft + (moveEvent.clientX - startX);
        note.y = startTop + (moveEvent.clientY - startY);
        el.style.left = `${note.x}px`;
        el.style.top = `${note.y}px`;
      };

      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        putNote(note);
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    });
  }

  function makeResizable(el, note) {
    const observer = new ResizeObserver(() => {
      note.width = el.offsetWidth;
      note.height = el.offsetHeight;
      putNote(note);
    });
    observer.observe(el);
  }

  canvas.addEventListener("dblclick", (e) => {
    if (e.target.closest(".note")) return;
    createNote(e.clientX, e.clientY);
  });

  openDB()
    .then((database) => {
      db = database;
      return getAllNotes();
    })
    .then((notes) => {
      zCounter = notes.reduce((max, n) => Math.max(max, n.z), 1);
      notes.forEach(renderNote);
      updateHint(notes.length);
    });
})();
