
var editor;
function createUUID() {

    let dt = new Date().getTime()

    const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (dt + Math.random() * 16) % 16 | 0
        dt = Math.floor(dt / 16)
        return (c == 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })


    return uuid
}
const tabId = createUUID();

(function () {
    const localStorageID = "EasyNote_2b72694a-dcd2-49f1-8b5c-464d15699c21"
    content = document.getElementById("content")
    editor = new EditorJS({
        holder: content,
        tools: {
            image: SimpleImage,
            header: {
                class: Header,
                inlineToolbar: true,
                shortcut: 'CMD+SHIFT+H'
            },
            list: {
                class: List,
                inlineToolbar: true,
                shortcut: 'CMD+SHIFT+L'
            },
            checklist: {
                class: Checklist,
                inlineToolbar: true,
            },
            paragraph: {
                config: {
                    placeholder: 'Start taking note'
                }
            },
        },
        data: {
            blocks: [{ "type": "header", "data": { "text": "HEADER", "level": 2 } }, { "type": "paragraph", "data": { "text": "<i>Italic text</i>" } }, { "type": "list", "data": { "style": "unordered", "items": ["Item1", "Item2", "Item3"] } }, { "type": "checklist", "data": { "items": [{ "text": "Buy eggs", "checked": false }, { "text": "Clean room", "checked": true }, { "text": "Do Homework", "checked": true }] } }, { "type": "paragraph", "data": { "text": "<a href=\"https://google.com\">https://google.com</a>" } }]
        },
        onReady: function () {
            var storedJsonString = localStorage.getItem(localStorageID)
            if (storedJsonString) {
                let parsed = JSON.parse(storedJsonString)
                if (parsed.blocks && parsed.blocks.length) {
                    editor.render(parsed)
                }
            }
        },
        onChange: function () {
            editor.save().then(data => {
                var stored = JSON.parse(localStorage.getItem(localStorageID))
                if (!stored || JSON.stringify(stored.blocks) != JSON.stringify(data.blocks)) {
                    data.tabId = tabId;
                    localStorage.setItem(localStorageID, JSON.stringify(data))
                }
            });

        }
    });

    window.addEventListener('storage', async function (e) {
        if (e.storageArea === localStorage) {
            if (e.key === localStorageID) {
                var data = await editor.save();
                var stored = JSON.parse(localStorage.getItem(localStorageID))
                if (stored.tabId == tabId) {
                    return;
                } else {
                    if (JSON.stringify(stored.blocks) != JSON.stringify(data.blocks)) {
                        editor.render(stored)
                    } else {
                    }
                }

            }
        }
    });
}());