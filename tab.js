
var simplemde;

(function () {
    const localStorageID = chrome.runtime.id;
    var textArea = document.getElementById("MyID")
    console.log(textArea)
    simplemde = new SimpleMDE({
        autofocus: true,
        autosave: {
            enabled: false,
            uniqueId: "MyUniqueID",
            delay: 100,
        },
        element: document.getElementById("MyID"),
        forceSync: false,
        indentWithTabs: false,
        initialValue: "Hello world!",
        lineWrapping: false,
        parsingConfig: {
            allowAtxHeaderWithoutSpace: true,
            strikethrough: false,
            underscoresBreakWords: true,
        },
        placeholder: "Type here...",
        status: ["autosave", "lines", "words", "cursor", {
            className: "keystrokes",
            defaultValue: function (el) {
                this.keystrokes = 0;
                el.innerHTML = "0 Keystrokes";
            },
            onUpdate: function (el) {
                el.innerHTML = ++this.keystrokes + " Keystrokes";
            }
        }], // Another optional usage, with a custom status bar item that counts keystrokes
        styleSelectedText: false,
        tabSize: 4,
        toolbar: false,
        toolbarTips: false,
    });
    simplemde.codemirror.on('change', () => {
        localStorage.setItem(localStorageID, simplemde.value())
    });
    window.addEventListener('storage', function (e) {
        if (e.storageArea === localStorage) {
            if (e.key === localStorageID) {
                var stored = localStorage.getItem(localStorageID)
                if (simplemde.value() != stored)
                    simplemde.value(stored)
            }
        }
    });
    simplemde.value(localStorage.getItem(localStorageID))
}());