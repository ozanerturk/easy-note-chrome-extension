class NoteView  extends MyEventEmitter{

    constructor(note) {
        super();
        this.configuration = new Configuration();//todo get configuration
        //create box dom 
        this.noteId = note.id;
        this.title = note.title;
        this.content = note .content;
        this.width = note.width;
        this.height = note.height;
        this.x = note.x;
        this.y = note.y;
        this.color = note.color;

        this.dom = document.createElement('div');
        this.dom.classList.add('note');
        this.dom.style.backgroundColor = this.color;
        //create drag handle dom
        this.dragHandle = document.createElement('div');
        this.dragHandle.classList.add('drag-handle');
        this.dragHandle.innerHTML = "...";

        //set default style
        this.dom.style.minWidth = "200px";
        this.dom.style.minHeight = "100px";


        this.dom.style.position = "absolute";
        this.dom.style.zIndex = "1";
        this.dom.style.border = "1px solid black";
        this.dom.style.borderRadius = "5px";

        this.isDragging = false;
        this.resizeStarted = false;

        this.dom.appendChild(this.dragHandle);

        //create title dom
        this.titleDom = document.createElement('div');
        this.titleDom.classList.add('title');
        this.titleDom.innerHTML = this.title;
        this.titleDom.ondblclick = (e) => {
            this.titleDom.contentEditable = true;
            this.titleDom.focus();
        };
        this.titleDom.onblur = (e) => {
            this.titleDom.contentEditable = false;
            this.triggerChange();
        };

        
        this.dom.appendChild(this.titleDom);
        //create content dom
        this.contentDom = document.createElement('div');
        this.contentDom.classList.add('content');
        this.contentDom.innerHTML = this.content;
        
        
        this.contentDom.ondblclick = (e) => {
            this.contentDom.setAttribute("contenteditable", "true");
        };
        this.contentDom.onblur = (e) => {
            this.contentDom.setAttribute("contenteditable", "false");
            this.triggerChange();
        };

        this.dom.appendChild(this.contentDom);
        //watch content and title changes and update note
        this.titleDom.addEventListener('input', (e) => {
            this.title = e.target.innerHTML;
        });
        this.contentDom.addEventListener('input', (e) => {
            this.content = e.target.innerHTML;
        });
        //create delete button
        this.deleteButton = document.createElement('button');
        this.deleteButton.classList.add('delete');
        this.deleteButton.innerHTML = 'D';
        this.deleteButton.addEventListener('click', (e) => {
            //show are you sure dialog
            let undo_snack = document.createElement('div');
            undo_snack.classList.add('undo-snack');

            let text = document.createElement('div');
            text.innerHTML = "Undo";
            let countdown = 5;
            let undo_button = document.createElement('button');
            undo_button.classList.add('undo-button');
            undo_button.innerHTML = countdown;

            //set timer to hide snack
            let deleteTimer = setTimeout(() => {

                undo_snack.remove();
                this.onDelete();
            }, 5000);

            //count down from 5 to 0 by second and update snack text
            let tmp = countdown;
            let countDownInterval = setInterval(() => {
                undo_button.innerHTML = (--tmp);
            }, 1000);

            //undo button event 
            undo_button.addEventListener('click', (e) => {
                clearInterval(countDownInterval);
                clearTimeout(deleteTimer);
                this.dom.style.display = "block";
                undo_snack.remove();
            });
            this.dom.style.display = "none";
            undo_snack.appendChild(text);
            undo_snack.appendChild(undo_button);
            document.querySelector(".snack-list").appendChild(undo_snack);

        }
        );
        this.dom.appendChild(this.deleteButton);

        this.dragHandle.addEventListener('mousedown', (e) => {
            //prevent
            //prevent to start drag if selected text avaliable
            if (window.getSelection().toString() == 'undefined' || window.getSelection().toString() !== '') {
                return;
            }
            this.dragStart(e);
        });
        //stop drag when mouse up
        document.addEventListener('mouseup', (e) => {
            this.dragEnd(e);

        });



        document.addEventListener('mousemove', (e) => {
            this.dragMove(e);
        });
        document.addEventListener('mouseup', (e) => {
            this.dragEnd(e);
        });

        //resize from corner by dragging resize handler
        this.resizeHandle = document.createElement('div');

        this.resizeHandle.classList.add('resize-handle');
        this.dom.appendChild(this.resizeHandle);
        this.resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.resizeStart(e);
        });
        document.addEventListener('mouseup', (e) => {
            this.resizeEnd(e);
        });
        document.addEventListener('mousemove', (e) => {
            this.resizeMove(e);
        });
        this.updateStyle();

    }
    updateModel(note){
        this.title = note.title;
        this.content = note.content;
        this.width = note.width;
        this.height = note.height;
        this.x = note.x;
        this.y = note.y;
        this.color = note.color;
        this.titleDom.innerHTML = this.title;
        this.contentDom.innerHTML = this.content;
        this.dom.style.backgroundColor = this.color;
        this.updateStyle();
    }
    updateStyle() {
        //set width and height
        this.dom.style.width = this.width+"px";
        this.dom.style.height = this.height+"px";
        //set position
        this.dom.style.left = this.x + "px";
        this.dom.style.top = this.y + "px";

    }

    remove(){
        this.dom.remove();
    }
    resizeStart(e) {
        if (this.resizeStarted == false) {
            this.resizeStartX = e.clientX;
            this.resizeStartY = e.clientY;
            this.resizeStartWidth = this.dom.offsetWidth;
            this.resizeStartHeight = this.dom.offsetHeight;
            this.resizeStartLeft = this.dom.offsetLeft;
            this.resizeStartTop = this.dom.offsetTop;
            this.resizeStarted = true;
        }
    }

    resizeMove(e) {
        if (!this.resizeStarted) {
            return;
        }

        let width = this.resizeStartWidth + (e.clientX - this.resizeStartX);
        let height = this.resizeStartHeight + (e.clientY - this.resizeStartY);
        if (width && height) {
            //check if it is exceeding style  min
            if (width < parseInt(this.dom.style.minWidth)) {
                width = parseInt(this.dom.style.minWidth);
            }
            if (height < parseInt(this.dom.style.minHeight)) {
                height = parseInt(this.dom.style.minHeight);
            }

            this.dom.style.width = width + "px";
            this.dom.style.height = height + "px";

            this.width = width;
            this.height = height;
        }

    }

    resizeEnd(e) {
        if (this.resizeStarted == true) {
            this.resizeStarted = false;
            this.triggerChange();
        }
    }


    dragStart(e) {
        if (this.isDragging == false) {

            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this.dragStartLeft = this.dom.offsetLeft;
            this.dragStartTop = this.dom.offsetTop;
        }

    }

    dragMove(e) {
        if (this.isDragging) {
            this.x = (this.dragStartLeft + e.clientX - this.dragStartX);
            this.y = (this.dragStartTop + e.clientY - this.dragStartY);
            this.x = this.x + (this.configuration.step - (this.x % this.configuration.step));
            this.y = this.y + (this.configuration.step - (this.y % this.configuration.step));
            this.dom.style.left = this.x + 'px';
            this.dom.style.top = this.y + 'px';
            this.x = this.x;
            this.y = this.y;
        }
    }

    dragEnd(e) {
        if (this.isDragging === true) {
            this.isDragging = false;
            this.dragStartX = null;
            this.dragStartY = null;
            this.dragStartLeft = null;
            this.dragStartTop = null;
            this.triggerChange();
        }
    }



    //set ondelete event
    onDelete() {
    }

    triggerChange() {
        this.emit("changed",{
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
            content: this.contentDom.innerHTML,
            title: this.titleDom.innerHTML
        });

    }
    render() {
        document.body.appendChild(this.dom);

    }
}
