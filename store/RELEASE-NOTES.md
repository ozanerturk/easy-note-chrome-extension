Ask Claude about your notes, mark up what you clip, and a note without a lock.

**[What's new — guided tour and how-tos](https://easynote.tayfai.tech/release-notes.html)**

## Connect to Claude

Turn on **Connect to Claude** in the ☁ panel, add Easy Note as a connector in Claude (*Settings → Connectors*, with the address the panel shows), and sign in with the same Google account. Then ask: *"what did I write about the Lisbon trip?"*

- **Search and read.** Claude searches your notes and reads the one it needs — headings, lists and tables come across as plain, readable text. The Capture tray is never searched.
- **What is due, for a morning briefing.** Claude can list your reminders — due now, today, or coming this week — in your own time zone. With Chrome closed it answers from the copy Google Drive sync keeps and says how recent that is.
- **Capture.** Ask Claude to keep a line for you and it lands in the Capture tray, like a clip, until you file it. Claude only ever adds: it cannot edit, move or delete a note.
- **Off by default.** While the switch is off, nothing is connected. Switching it off closes the connection and deletes the relay's sign-in to your Drive folder.
- **What passes through.** A small relay carries Claude's request to your notes and the answer back — from your open browser, or with Chrome closed from your own Google Drive copy. It does not store or log what is in your notes. It keeps what it needs to sign you in: an opaque Google account id, a hashed sign-in token, and an encrypted sign-in to your Easy Note Drive folder for the Chrome-closed case. See the [privacy policy](https://easynote.tayfai.tech/privacy.html).
- **No new permissions** for this. It needs Chrome 116 or newer, which is what keeps the connection alive in the background.

## Mark up a clip, and copy its words

After you drag a box with **⌥⇧S**, the bar has a pen, highlighter, arrows, numbered steps, text and blur, in colours you pick, with undo and redo. **Save** puts it in the tray; **Download** keeps a copy as a file. When the region has writing in it, **Copy text** appears and puts the words on your clipboard — read on your computer, nothing sent anywhere. In the gallery, a **Download** button saves the picture, and its words can be selected straight off it.

## Smaller things

- **Resize from either bottom corner**, including a note floating over a page.
- **Sums** learn `%` (remainder) and `**` (power).
- **The lock is retired.** Notes you had locked are now ordinary notes you can move and delete. A note locked in an earlier version is still never shared with Claude.
- **A new permission, `offscreen`**, lets the clipper copy to the clipboard and read text out of a clip, which a service worker cannot do on its own.

---

# Earlier: 3.3

Every picture on the board in one place, and the words inside them ready to copy.

**[What's new — guided tour and how-tos](https://easynote.tayfai.tech/release-notes.html)**

## Double-click a picture to open it

It fills the screen, and every other picture in every note is behind it — newest note first, wherever it lives. Arrow keys look through them, **Esc** comes back out.

- Each picture says which page its note lives on and when that note was last written in, so a picture is never just floating on its own.
- **⏎**, or *Go to note*, takes you to the note it came out of — opening its page if that is not the one you are on.
- The board stays faintly visible behind it. This is something laid over your notes, not another screen you have gone away to.

## Copy the text out of a photograph

A screenshot of an error message, a photo of a whiteboard, a receipt from a phone camera — the words on them are the reason the picture was kept, and they were the one thing in a note you could not copy.

- Open a picture and it is read in the background. When the words are ready the picture flashes once, and you can select them straight off it — or take all of it with **Copy text**.
- It reads **English and Turkish**, including ı, ğ and ş.
- **It all happens on your computer.** The recognition engine and both language models ship inside the extension; no picture, and nothing read out of one, is ever sent anywhere. It works with the network off.
- A picture is read once, ever. After that its words come back instantly.

## A quieter note

- **A note can be one line tall.** The old floor was six lines of empty space every short note had to carry.
- **The "Type or paste here" prompt is gone.** It said nothing the cursor did not, in every empty note at once.
- **Headings go properly big**, and a maximised note has room to breathe instead of a wide margin squeezing its text into the middle.
- **Menus read properly in dark mode**, and a note dropped back onto its own page no longer appears twice.

---

# Earlier: 3.2

Clip anything off the web, file it when you are ready, and a board that finally has a dark mode.

**[What's new — guided tour and how-tos](https://easynote.tayfai.tech/release-notes.html)**

## Clip any part of any page

Press **⌥⇧S** on any web page — or use the toolbar icon, or right-click → *Clip to Easy Note* — drag a box round what you want, and it is saved with the page it came from. No new tab, no copy and paste, no losing your place.

- A live pixel readout while you drag, and **Esc** cancels at any point, including mid-drag.
- The overlay takes itself off the page the moment you save or cancel. Nothing is left behind.
- It costs **no host permissions**: `activeTab` is granted by your click and expires with it, so the extension has no standing access to any site and reads nothing from the page but the pixels you drew a box around.

## A tray for things you have not filed yet

Clips land in a strip along the bottom of the board rather than somewhere on a page you would have to go looking for later.

- **Drag one onto the board** to place it, or onto a page in the sidebar to file it there.
- Older clips fade a little so your eye goes to what is recent — nothing is ever hidden, sorted away or deleted on its own.
- When the tray is empty it is not there at all. The board keeps its full height.

## Dark mode

Light, dark, or whatever your system is set to. It is applied before the page draws, so opening a new tab at night never flashes white at you.

## Every page has a home

Hold the **🏠** button to say where a page should open. Click it, press **Esc** on an empty board, or click the page's name again to get back there from wherever you have wandered off to.

## Carrying a note somewhere else

Hold a note over a page in the sidebar and that page opens underneath it, so you can put the note down exactly where you want rather than posting it into a page you cannot see. **Esc** calls the whole thing off and puts everything back.

## A quieter board

- **Pages tell you what is waiting.** A page holding a reminder that has come due shows a quiet count; click it to step through them one at a time. Nothing hops or flashes any more.
- **Notes lost their buttons.** Right-click a note — or use the **⋯** above it — for colour, reminders, lock, fullscreen and delete. Page rows lost their two buttons the same way.
- **No borders, one small corner radius, and less of everything.** A maximised note now has a proper surface to read against, and its text stops at a comfortable measure instead of running the width of the screen.
- **Reminders are simpler:** 15 minutes, an hour, this evening, tomorrow, in 3 days, in a week.
- Deleting a page with notes in it now asks twice, and an empty one does not ask at all.

## Finding your way around

If you have not tried something the app can do, it will mention it — once, quietly, in a line that fades on its own, and never again once you have used it.

---

# Earlier: 3.1

Reminders that tap you on the shoulder, notes you can actually write in, and a board that gets out of the way.

**[What's new — guided tour and how-tos](https://easynote.tayfai.tech/release-notes.html)**

## Reminders

Give a note a time — 15 or 40 minutes, 1, 2 or 3 hours, or one you pick — and when it comes round the note hops on the board to catch your eye.

- It waits for you: being due is worked out from the note itself, so it is still hopping tomorrow morning, in a second tab, after the browser has been closed all night.
- A note that came due on **another page** makes that page's name hop in the sidebar, so nothing goes off quietly in a folder you are not looking at.
- Click the reminder to dismiss it. What a note is waiting for reads on the same line as its last-edited time, and hides with it.

No permissions were added for this: a reminder is a timestamp on the note, and it syncs to Drive with everything else.

## Notes you can write in properly

The editor is now built on Tiptap, and formatting is something you type rather than hunt for.

- `- ` starts a bullet list, `1. ` a numbered one, `[] ` a checkbox you can tick, `# ` a heading, `> ` a quote.
- Type a bare address and it becomes a link as you pass it.
- **Select any text** and a small bar appears over it: bold, italic, underline, strikethrough, links, bullet lists, checkboxes, and a pair of buttons that step the text up and down through the sizes.
- Checkboxes can be ticked on a closed note. Crossing something off a list is not editing.
- ⌘Z undoes inside the note you are writing in, and on the board it brings back a deleted note.

Everything written in earlier versions comes across unchanged — headings, lists, links, emphasis, colours and pasted images all survive being opened.

## A quieter board

- Notes start with **no fill at all** — just text on the canvas — with eighteen colours when one would help.
- A note's buttons live in a small bar above it, and only while you are working in that note. Nothing else on the board wears any chrome.
- Drag a note from anywhere on it. Hold ⌘/Ctrl while dragging to step it along the grid.
- Leave a note empty and it clears itself away.
- **Lock** now pins a note where it is as well as guarding it from deletion.

## Paste straight onto the board

Copy anything, press ⌘V on empty canvas, and it becomes a note where your cursor is — text, links and images alike. Ctrl+P does the same without the paste.

## Also

- Zoom and pan now work with the cursor over a note, not just over empty canvas.
- Dragging notes onto a page fills the row in, so you can see where they are about to land.
- Recent notes in the search panel show when they were last edited.
- Deleting a note offers an undo for a few seconds.

---

[Privacy policy](https://easynote.tayfai.tech/privacy.html) · [Chrome Web Store](https://chromewebstore.google.com/detail/easy-note/hheobakelknbjicekbkmijjgcbephcef)
