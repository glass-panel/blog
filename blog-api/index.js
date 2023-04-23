import { Router } from 'itty-router';
import { parse as parseCmd } from 'shell-quote';
import xss from 'xss';

const env = {
    ALLOWED_SENDERS: '[]',
    MAIL_NOTIFICATION_SECRET: '',
    GITHUB_TOKEN: '',
    GITHUB_REPO: '',
    GITHUB_ACTION: '',
    GITHUB_COMMENTS_BRANCH: '',
    GITHUB_MAIN_BRANCH: '',
};

/**
 * @typedef {Object} Comment
 * @property {string} id
 * @property {string} name
 * @property {number} time
 * @property {string} content
 * @property {Comment[]} replies
 */

const router = Router();

function makeResponse(status, body=null, headers = {}) {
    return new Response(body? JSON.stringify(body):'', {
        status,
        headers: Object.assign({
            'Content-Type': 'application/json',
        }, headers),
    });
}

/** @param {string} str */
function base64Encode(str) {
    return btoa(String.fromCharCode(...(new TextEncoder()).encode(str)));
}

function validateSender(address) {
    const allowed = JSON.parse(env.ALLOWED_SENDERS);
    if(allowed.includes(address))
        return true;
    return false;
}

async function githubAPI(url, method='GET', data=null, headers={}) {
    const res = await fetch(`https://api.github.com${url}`, {
        method,
        headers: Object.assign({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
            'Accept': 'application/json',
            'User-Agent': 'Cloudflare Worker'
        }, headers),
        body: data? JSON.stringify(data): undefined,
    }).then(res=> res.text());
    console.log(res);
    if(!res)
        return undefined;
    return JSON.parse(res);
}

function parseCommentArgs(args) {
    /** @type {{path:string, floors:number[], anonymous:boolean}} */
    const cmd = { path: '', floors: [], anonymous: false };
    while(args.length)
        switch(args[0].replace(/:/g, ' ').toLowerCase().trim()) {
        case 'reply':
            cmd.path = args[1].replace(/\/$/g, '') + '/';
            args.splice(0, 2);
            break;
        case 'floor':
            cmd.floors = args[1].split('-')
                .map(i=> i-0)
                .filter(i=>i !== undefined);
            args.splice(0, 2);
            break;
        case 'anonymous':
            cmd.anonymous = true;
            args.splice(0, 1);
            break;
        default:
            args = [];
            break;
        }
    return cmd;
}

/** @param {{path:string, floors:number[], anonymous:boolean}} cmd */
async function fetchComments(cmd) {
    // get comments file from the website directly
    const commentsPath = (cmd.path + 'comments.json').replace(/^\//g, "");
    console.log(`https://raw.githubusercontent.com/${env.GITHUB_REPO}/${env.GITHUB_COMMENTS_BRANCH}/${commentsPath}`);
    /** @type {Comment[]} */
    const comments = await githubAPI(`/repos/${env.GITHUB_REPO}/contents/${commentsPath}?ref=${env.GITHUB_COMMENTS_BRANCH}`, 
        'GET', 
        null, {
        'Accept': 'application/vnd.github.raw',
    });
    return comments;
}

/** @param {{path:string, floors:number[], anonymous:boolean}} cmd @param {Comment[]} comments */
function insertComments(cmd, comments, newComment) {
    // find the position to insert the new comment
    let insertPos = comments;
    if(cmd.floors.length) {
        if(cmd.floors.length > 24)
            return "Too many floors";
        const sentry = []; sentry.ahhh = 114514;
        // doing a reduce to find the insert position of nested comments
        insertPos = cmd.floors.reduce((prev, curr, indx)=> {
            return prev.find(i=> (i.id+'').split('-')[indx] == curr)?.replies || sentry;
        }, insertPos);
        if(insertPos.ahhh == 114514)
            return "Floor not found";
    }
    // create the new comment
    const comment = { 
        id: '' + (cmd.floors.length? 
            `${cmd.floors.join('-')}-${insertPos.length + 1}` :
            insertPos.length + 1),
        name: cmd.anonymous? '不愿透露姓名的网友' : newComment.from,
        time: Date.now(),
        content: xss(newComment.content, {
            stripIgnoreTag: true,
            stripIgnoreTagBody: ["script"]
        }),
        replies: [],
    };
    // then insert it
    insertPos.push(comment);
    return "";
}

/** @param {{path:string, floors:number[], anonymous:boolean}} cmd @param {Comment[]} comments */
async function uploadComment(cmd, comments) {
    const commentsPath = (cmd.path + 'comments.json').replace(/^\//g, "");
    // query the sha of the comment file for updating using graphQL
    const sha = await githubAPI(`/graphql`, 'POST', {
        query: "query ($owner: String!, $name: String!, $expression: String!) { repository(owner: $owner, name: $name) { object(expression: $expression) { ... on Blob { oid } } } }",
        variables: {
            owner: env.GITHUB_REPO.split('/')[0],
            name: env.GITHUB_REPO.split('/')[1],
            expression: `${env.GITHUB_COMMENTS_BRANCH}:${commentsPath}`
        }
    }).then(r=> r.data?.repository?.object?.oid || undefined);
    console.log("sha:", sha);
    // create or update the comment file
    await githubAPI(`/repos/${env.GITHUB_REPO}/contents/${commentsPath}`, 'PUT', {
        message: "comment update",
        content: base64Encode(JSON.stringify(comments)),
        branch: env.GITHUB_COMMENTS_BRANCH,
        sha: sha
    });
}

router.post('/mailNotification', /** @type {(request: Request)=>Promise<Response>} */  
async (request)=> {
    try {
        console.log("Incomming!");
        if(request.headers.get('Authorization') != env.MAIL_NOTIFICATION_SECRET)
            return makeResponse(401, { error: 'Unauthorized' });
        const body = await request.json();
        console.log(body);
        const args = parseCmd(body.data.subject).filter(i=> typeof(i) == 'string');
        console.log(args);

        switch(args[0].replace(/:/g, ' ').toLowerCase().trim()) {
        case 'reply':
            const cmd = parseCommentArgs(args);
            console.log(cmd);
            const comments = await fetchComments(cmd);
            console.log(JSON.stringify(comments));
            if(!comments)
                return makeResponse(400, { error: 'Comments not found' });
            const errMessage = insertComments(cmd, comments, body.data);
            console.log(JSON.stringify(comments));
            if(errMessage)
                return makeResponse(400, { error: errMessage });
            console.log("uploading!");
            await uploadComment(cmd, comments);
            return makeResponse(200, { message: 'OK' });
        case 'post':
        case 'edit':
        case 'delete':
            if(!validateSender(body.data.from))
                return makeResponse(400, { error: 'Sender not allowed' });
            // trigger the deploy action
            await githubAPI(`/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_ACTION}/dispatches`, 'POST', {
                ref: env.GITHUB_MAIN_BRANCH,
                inputs: {
                    mail_id: body.data.id
                }
            });
            return makeResponse(200, { message: 'OK' });
        default:
            return makeResponse(200, { error: 'Unknown command' });
        }
    } catch(err) {
        console.log(err);
        return makeResponse(500, { error: 'Internal server error' });
    }
});

router.get('*', ()=> makeResponse(404, { error: 'Not found' }));

export default {
    fetch: (request, _env)=> { Object.assign(env, _env); return router.handle(request); },
}