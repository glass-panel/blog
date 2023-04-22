const fs = require('fs');

require('cross-fetch/polyfill');
const parseCmd = require('shell-quote').parse;
const { Client, GraphError } = require("@microsoft/microsoft-graph-client");
const { TokenCredentialAuthenticationProvider } = require("@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials");
const { ClientSecretCredential } = require("@azure/identity");

const env = {
    GRAPH_CLIENT_SECRET: "",
    GRAPH_TENANT_ID: "",
    GRAPH_CLIENT_ID: "",
    MAIL_ACCOUNT: ""
};

const GRAPH_SCOPES = ["https://graph.microsoft.com/.default"];

/** @return {Client} */
function graphClient() {
    if(graphClient.client)
        return graphClient.client;
    const credential = new ClientSecretCredential(env.GRAPH_TENANT_ID, env.GRAPH_CLIENT_ID, env.GRAPH_CLIENT_SECRET);
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
        scopes: GRAPH_SCOPES,
    });
    graphClient.client = Client.initWithMiddleware({ authProvider, debugLogging: false });
    return graphClient.client;
}

function parseSubject(str) {
    const args = parseCmd(str);
    const cmd = { type: 'unknown', name: '', attr: 'asis' };
    while(args.length) {
        switch(args[0].replace(/:/g, ' ').toLowerCase().trim()) {
        case 'post':
            cmd.type = 'post';
            cmd.name = args[1];
            args.splice(0, 2);
            break;
        case 'asis':
            cmd.attr = 'asis';
            args.shift();
            break;
        case 'md':
        case 'mkd':
        case 'markdown':
            cmd.attr = 'markdown';
            args.shift();
            break;
        case 'fileonly':
            cmd.attr = 'fileonly';
            args.shift();
            break;
        default:
            args = [];
            break;
        }
    }
    return cmd;
}

/** @param {{type: string, name: string, attr: string}} cmd */
async function handlePost(cmd, id) {
    let baseName = cmd.name.replace(/[\s\<\>\"\|]/g, '_').replace(/[\\\/\:\*\?#@]/g, '');
    let extName = ''
    let date = new Date();
    let title = cmd.name;
    let content = '';

    hexo.log.info('Downloading mail...');
    switch(cmd.attr) {
        case 'asis': {
            extName = "html";
            const res = await graphClient().api(`/users/${env.MAIL_ACCOUNT}/messages/${id}`)
                .header("Prefer", "outlook.body-content-type=\"html\"")
                .get();
            content = res.body.content;
            date = new Date(res.sentDateTime);
            break;
        }
        case 'markdown': {
            extName = "md";
            const res = await graphClient().api(`/users/${env.MAIL_ACCOUNT}/messages/${id}`)
                .header("Prefer", "outlook.body-content-type=\"text\"")
                .get();
            content = res.body.content;
            date = new Date(res.sentDateTime);
            break;
        }
        case 'fileonly': 
            break;
        default:
            hexo.log.error("Unknown post attribute.");
            await hexo.exit();
            process.exit(1);
    }

    const postDirPath = `./source/_posts/${baseName}`;
    hexo.log.info(`Creating post at ${postDirPath}...`);
    await fs.promises.mkdir(postDirPath, { recursive: true });
    if(cmd.attr != 'fileonly') {
        await hexo.post.create({
            title: title,
            date: date,
            path: `${baseName}/${baseName}.${extName}`,
        });
        await fs.promises.appendFile(`${postDirPath}/${baseName}.${extName}`, content);
    }

    hexo.log.info('Downloading attachments...');
    const attachments = await graphClient().api(`/users/${env.MAIL_ACCOUNT}/messages/${id}/attachments`).get();
    for(const attachment of attachments.value) {
        if(attachment.contentBytes)
            await fs.promises.writeFile(`${postDirPath}/${attachment.name}`, Buffer.from(attachment.contentBytes, 'base64'));
        else
            await graphClient().api(`/users/${env.MAIL_ACCOUNT}/messages/${id}/attachments/${attachment.id}/$value`)
                .responseType('stream')
                .getStream()
                .then(res=> {
                    const fileStream = fs.createWriteStream(`${postDirPath}/${attachment.name}`);
                    res.pipe(fileStream);
                });
    }

    hexo.log.info('Post Created!');
    return;
}

hexo.extend.console.register("mail2post", "Convert mail to post", {
    arguments: {
        name: "--mailid",
        desc: "mail id"
    }
}, async (args)=> {
    try {
        Object.assign(env, process.env);
        const id = args.mailid;
        if(!id || typeof(id) != "string") {
            hexo.log.error("Invalid mail id")
            await hexo.exit();
            process.exit(1);
        }
        hexo.log.info(`Processing mail ${id} ...`);
        const subject = await graphClient().api(`/users/${env.MAIL_ACCOUNT}/messages/${id}`)
            .select("subject")
            .get()
            .then(r=> r.subject).catch(err=> {
                if(err instanceof GraphError && err.statusCode == 404) {
                    hexo.log.error("Mail not found");
                    return null;
                }
                throw err;
            });
        if(!subject) {
            await hexo.exit();
            process.exit(1);
        }
        const cmd = parseSubject(subject);
        hexo.log.info(`Command: ${JSON.stringify(cmd)}`);
        switch(cmd.type) {
        case 'post':
            await handlePost(cmd, id);
            break;
        default:
            hexo.log.error("Unknown command");
            await hexo.exit();
            process.exit(1);
        }
    } catch(err) {
        hexo.log.error(err);
        await hexo.exit();
        process.exit(1);
    }
})