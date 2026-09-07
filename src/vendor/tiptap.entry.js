// The only third-party code in the extension, bundled because MV3 forbids
// loading anything from a CDN (`script-src 'self'`) and ProseMirror ships bare
// ESM imports that a browser cannot resolve on its own.
//
//   npm run build   ->  js/vendor/tiptap.js
//
// The output is committed, so `load unpacked` works straight from a clone with
// no install step. Everything Easy Note itself does with these lives in
// js/editor.js, in plain readable source.

export { Editor, Extension, Node, mergeAttributes } from "@tiptap/core";

export { Document } from "@tiptap/extension-document";
export { Paragraph } from "@tiptap/extension-paragraph";
export { Text } from "@tiptap/extension-text";
export { HardBreak } from "@tiptap/extension-hard-break";
export { Heading } from "@tiptap/extension-heading";
export { Blockquote } from "@tiptap/extension-blockquote";
export { CodeBlock } from "@tiptap/extension-code-block";

export { Bold } from "@tiptap/extension-bold";
export { Italic } from "@tiptap/extension-italic";
export { Underline } from "@tiptap/extension-underline";
export { Strike } from "@tiptap/extension-strike";
export { Code } from "@tiptap/extension-code";
export { Link } from "@tiptap/extension-link";

export { BulletList, OrderedList, ListItem, TaskList, TaskItem, ListKeymap } from "@tiptap/extension-list";
// All four table nodes live in the one package; the extension-table-row and
// friends packages are re-exports of it, so they would only be more to install.
export { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
export { Image } from "@tiptap/extension-image";

export { UndoRedo, Placeholder, Gapcursor } from "@tiptap/extensions";
