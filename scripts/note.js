
class Note {

    constructor({ id, x, y, title, content, width, height, color, createdAt, updatedAt } = {
        id: undefined,
        x: 0,
        y: 0,
        width: defaults.minNoteWidth,
        height: defaults.minNoteHeight,
        title: "",
        content: "",
        color: "#ffffff",
        createdAt: dayjs().unix(),
        updatedAt: dayjs().unix()

    }) {
        //generate id from IndexedDB
        this.id = id;
        this.title = title;
        this.content = content;
        this.color = color;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.x = x;
        this.y = y;
        this.width = width || defaults.minNoteWidth;
        this.height = height || defaults.minNoteHeight;
        //init listeners

    }

    serialize() {
        return {
            id: this.id,
            title: this.title,
            content: this.content,
            color: this.color,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            x: this.x,
            y: this.y
        };
    }

    update({ title, content, color, x, y, width, height }) {
        this.title = title;
        this.content = content;
        this.color = color;
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.updatedAt = dayjs().unix();
    }

}