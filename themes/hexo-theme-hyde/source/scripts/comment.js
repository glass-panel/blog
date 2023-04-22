/**
     * @typedef {Object} Comment
     * @property {string} id
     * @property {string} name
     * @property {number} time
     * @property {string} content
     * @property {Comment[]} replies
     */

/** @return {HTMLElement} */
function createElement(tag, classList=[], props={}) {
    const elem = document.createElement(tag);
    elem.classList.add(...classList);
    for (const key in props)
        elem[key] = props[key];
    return elem;
}

const CommentInput = {
    pageurl: "",
    mailto: "",
    elements: {
        /** @type {HTMLTextAreaElement} */
        textarea: null,
        /** @type {HTMLAnchorElement} */
        submit: null,
        /** @type {HTMLSpanElement} */
        submitManual: null,
        /** @type {HTMLDivElement} */
        hint: null,
    },
    /** @type {string} */
    userInput: "",
    /** @type {string} */
    replyFloor: "",
    /** @type {boolean} */
    anonymous: false,
    /** @type {boolean} */
    manualMode: false,

    async init() {
        this.pageurl = document.getElementById("comment-meta").getAttribute("data-pageurl");
        this.mailto = document.getElementById("comment-meta").getAttribute("data-mailto");
        this.elements.textarea = document.getElementById("comment-textarea");
        this.elements.submit = document.getElementById("comment-submit");
        this.elements.submitManual = document.getElementById("comment-submit-manual");
        this.elements.hint = document.getElementById("comment-hint");
        this.onchange();
    },

    render() {
        if(!this.manualMode) {
            this.elements.textarea.style.height = "3rem";
            this.elements.textarea.value = this.userInput;
            this.elements.textarea.disabled = false;
            this.elements.submit.style.display = "block";
            this.elements.submitManual.innerText = "手动发送";
        } else {
            const subject = `Reply: ${JSON.stringify(this.pageurl)}` + 
                (this.replyFloor ? ` Floor: ${this.replyFloor}` : "") +
                (this.anonymous ? " Anonymous" : "");
            this.elements.textarea.disabled = true;
            this.elements.textarea.value = `请使用您的邮件客户端\n` +
                `向:\t\t${this.mailto}\t发送邮件\n` +
                `邮件主题:\t${subject}\n` +  
                `邮件内容:\n\n${this.userInput}`;
            this.elements.textarea.style.height = this.elements.textarea.scrollHeight + "px";
            this.elements.submit.style.display = "none";
            this.elements.submitManual.innerText = "返回";
        }
    },

    toggleFloorReply(id) {
        this.replyFloor = id;
        if(id) {
            this.elements.hint.getElementsByTagName("span").item(1).innerText = this.replyFloor;
            this.elements.hint.style.display = "block";
            this.elements.hint.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        } else 
            this.elements.hint.style.display = "none";
        this.render();
        this.onchange();
    },

    toggleAnonymous() {
        this.anonymous = !this.anonymous;
        this.render();
        this.onchange();
    },

    toggleManual() {
        if(!this.manualMode)
            this.userInput = this.elements.textarea.value;
        this.manualMode = !this.manualMode;
        this.render();
    },

    onchange() {
        if(!this.manualMode)
            this.userInput = this.elements.textarea.value;
        const subject = `Reply: ${JSON.stringify(this.pageurl)}` + 
            (this.replyFloor ? ` Floor: ${this.replyFloor}` : "") +
            (this.anonymous ? " Anonymous" : "");
        const url = `mailto:${this.mailto}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(this.userInput)}`;
        this.elements.submit.href = url;
    }
};

const Comments = {
    /** @type {Comment[]} */
    comments: [],

    elements: {
        /** @type {HTMLDivElement} */
        comments: null,
        /** @type {HTMLSpanElement} */
        number: null,
    },

    async init() {
        this.elements.comments = document.getElementById("comments");
        this.elements.number = document.getElementById("comments-num");
        const pageurl = document.getElementById("comment-meta").getAttribute("data-pageurl")
            .replace(/^\/+/, "")
            .replace(/\/+$/, "") + "/";
        const source = document.getElementById("comment-meta").getAttribute("data-source") || document.location.origin;
        this.comments = await fetch(new URL(pageurl+'comments.json?'+Math.random(), source), {
            cache: "no-cache"
        }).then(res =>  {
            if(res.status == 404)
                return [];
            if(!res.ok)
                throw new Error("Failed to fetch comments");
            return res.json();
        }); 
    },

    render() {
        const getCommentsNum = (comments) => {
            let num = comments.length;
            for (const comment of comments)
                num += getCommentsNum(comment.replies);
            return num;
        }
        this.elements.number.innerText = getCommentsNum(this.comments);
        const createCommentElem = (comment) => {
            const base = createElement("div", ["comment"]);
            const header = createElement("div", ["comment-header"]);
            const name = createElement("span", ["comment-name"], { 
                innerText: comment.name 
            });
            const time = createElement("span", ["comment-time"], { 
                innerText: new Date(comment.time).toLocaleString() 
            });
            const reply = createElement("i", ["comment-reply", "fa", "fa-solid", "fa-reply"], { 
                onclick: () => CommentInput.toggleFloorReply(comment.id) 
            });
            header.append(name, time, reply);
            const content = createElement("div", ["comment-content"], {
                innerHTML: comment.content
            });
            base.append(header, content);
            if (comment.replies.length > 0) {
                const replies = createElement("div", ["comment-replies"]);
                for (const reply of comment.replies)
                    replies.append(createCommentElem(reply));
                base.append(replies);
            }
            return base;
        }
        for (const comment of this.comments)
            this.elements.comments.append(createCommentElem(comment));
    }
};

addEventListener("load", async () => {
    await CommentInput.init();
    document.getElementById("comment-textarea").onchange = () => CommentInput.onchange();
    CommentInput.render();
    await Comments.init();
    Comments.render();
});