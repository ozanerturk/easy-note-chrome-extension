// The bar that appears over selected text.
//
// Typing still does the formatting — "- " for a bullet, "# " for a heading —
// but that only helps if you already know it. Selecting a few words and being
// shown what can be done to them is how anyone finds out. It exists only while
// there is a selection to act on, so a note at rest is still just a note.

import { promptForLink } from "./richtext.js";
import { rungOf, TOP_RUNG } from "./editor.js";

// Kept off the note: a note is transformed by the canvas and clipped by its
// own body, and this has to sit outside both.
function button(bar, { label, title, className = "", onPress, isOn, isOff }) {
  const el = document.createElement("button");
  el.className = `bubble-btn ${className}`.trim();
  el.innerHTML = label;
  el.title = title;
  // Pressing must not take the selection away, or there is nothing left to
  // apply the command to.
  el.addEventListener("pointerdown", (e) => e.preventDefault());
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onPress();
  });
  bar.appendChild(el);
  return { el, isOn, isOff };
}

function separator(bar) {
  const line = document.createElement("span");
  line.className = "bubble-sep";
  bar.appendChild(line);
}

/** The screen box of what is selected, or null if nothing is. */
function selectionRect() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return rect.width || rect.height ? rect : null;
}

export function attachBubble(editor) {
  // Held now rather than looked up later: by the time the editor announces it
  // is being destroyed its view is already gone, and reaching through it there
  // threw — which left the bar on the board, over a note that had closed.
  const dom = editor.view.dom;
  const noteEl = dom.closest(".note");

  const bar = document.createElement("div");
  bar.className = "bubble";
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());

  const controls = [
    button(bar, {
      label: "<b>B</b>", title: "Bold  ⌘B",
      onPress: () => editor.chain().focus().toggleBold().run(),
      isOn: () => editor.isActive("bold"),
    }),
    button(bar, {
      label: "<i>I</i>", title: "Italic  ⌘I",
      onPress: () => editor.chain().focus().toggleItalic().run(),
      isOn: () => editor.isActive("italic"),
    }),
    button(bar, {
      label: "<u>U</u>", title: "Underline  ⌘U",
      onPress: () => editor.chain().focus().toggleUnderline().run(),
      isOn: () => editor.isActive("underline"),
    }),
    button(bar, {
      label: "<s>S</s>", title: "Strikethrough",
      onPress: () => editor.chain().focus().toggleStrike().run(),
      isOn: () => editor.isActive("strike"),
    }),
  ];
  separator(bar);
  // Steppers, not settings: press again for another size, as in markdown.
  controls.push(
    button(bar, {
      label: "A", title: "Bigger text  ⌘⌥1", className: "is-title",
      onPress: () => editor.commands.stepTextSize(1),
      isOff: () => rungOf(editor) >= TOP_RUNG,
    }),
    button(bar, {
      label: "A", title: "Smaller text  ⌘⌥2", className: "is-small",
      onPress: () => editor.commands.stepTextSize(-1),
      isOff: () => rungOf(editor) <= 0,
    })
  );
  separator(bar);
  controls.push(
    button(bar, {
      label: "&bull;", title: "Bullet list",
      onPress: () => editor.chain().focus().toggleBulletList().run(),
      isOn: () => editor.isActive("bulletList"),
    }),
    button(bar, {
      label: "&#9744;", title: "Checklist",
      onPress: () => editor.chain().focus().toggleTaskList().run(),
      isOn: () => editor.isActive("taskList"),
    }),
    button(bar, {
      label: "&#128279;", title: "Link  ⌘K",
      onPress: () => {
        const href = editor.getAttributes("link").href || "";
        promptForLink(bar, href, (next) => {
          const chain = editor.chain().focus().extendMarkRange("link");
          if (next) chain.setLink({ href: next }).run();
          else chain.unsetLink().run();
        });
      },
      isOn: () => editor.isActive("link"),
    })
  );

  let shown = false;
  // While a selection is still being dragged out the bar would sit in the way
  // of the words being chosen, and move as they change. It waits for the
  // pointer to come up.
  let selecting = false;

  function hide() {
    if (!shown) return;
    bar.remove();
    shown = false;
  }

  function place(rect) {
    if (!shown) {
      document.body.appendChild(bar);
      shown = true;
    }
    const box = bar.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - box.width / 2, window.innerWidth - box.width - 8));
    let top = rect.top - box.height - 8;

    // The note's own header floats in the same strip of air. Rather than take
    // it away — it is how an open note is dragged and closed — step over it.
    const header = noteEl && noteEl.querySelector(".note-header");
    const hb = header && header.getBoundingClientRect();
    if (hb && top < hb.bottom && top + box.height > hb.top && left < hb.right && left + box.width > hb.left) {
      top = hb.top - box.height - 6;
    }

    bar.style.left = `${left}px`;
    // Below the selection instead if there is no room above it at all.
    bar.style.top = `${top < 8 ? rect.bottom + 8 : top}px`;
  }

  function update() {
    if (!editor.isEditable || editor.isDestroyed || selecting) return hide();
    const rect = editor.isFocused ? selectionRect() : null;
    if (!rect) return hide();
    place(rect);
    controls.forEach(({ el, isOn, isOff }) => {
      if (isOn) el.classList.toggle("is-on", !!isOn());
      if (isOff) el.disabled = !!isOff(); // nothing above the top of the ladder
    });
  }

  // A transaction covers both cases: the selection moving, and a mark being
  // applied to a selection that has not.
  editor.on("transaction", update);
  editor.on("focus", update);
  editor.on("blur", hide);

  const startSelecting = () => {
    selecting = true;
    hide();
  };
  const stopSelecting = () => {
    if (!selecting) return;
    selecting = false;
    update(); // the moment the highlight stops, the bar is there
  };
  dom.addEventListener("pointerdown", startSelecting);
  window.addEventListener("pointerup", stopSelecting);

  const reposition = () => shown && update();
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);

  editor.on("destroy", () => {
    dom.removeEventListener("pointerdown", startSelecting);
    window.removeEventListener("pointerup", stopSelecting);
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    hide();
  });
}
