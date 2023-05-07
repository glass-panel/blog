const renderer = require("./mermaid-renderer/pptr_client.js");

const config = {
    enable: true,
    browser: {
        launchOptions: {
            headless: "new",
            args: ["--no-sandbox", "--disable-gpu", "--disable-setuid-sandbox"],
        },
        parallel: false
    }
}

Object.assign(config, hexo.config.mermaid || {});

/** @param {string} str @param {RegExp} regexp @param {([...any])=>Promise<string>} callback  */
async function replaceAsync(str, regexp, callback, parallel = false) {
    // get all matches
    const matches = Array.from(str.matchAll(regexp));
    const substitutes = [];
    // generate substitutes
    if(parallel)
        substitutes.push(...await Promise.all(matches.map( args=>callback(...args) ))) ;
    else
        for(const args of matches)
            substitutes.push(await callback(...args));
    // replace all substitutes by its corresponding range
    const indexes = [0, ...matches.reduce(
        (accu, curr, indx)=>accu.concat([curr.index, curr.index+curr[0].length]),
        []
    ), str.length];

    const result = [...Array(indexes.length/2)]
        .map((i, n)=> indexes.slice(n*2, n*2+2))
        .map((i, n)=> str.slice(...i) + (substitutes[n] || ''))
        .join('');
    
    return result;
}

const rBacktick = /^((?:[^\S\r\n]*>){0,3}[^\S\r\n]*)(`{3,}|~{3,})[^\S\r\n]*((?:.*?[^`\s])?)[^\S\r\n]*\n((?:[\s\S]*?\n)?)(?:(?:[^\S\r\n]*>){0,3}[^\S\r\n]*)\2[^\S\r\n]?(\n+|$)/gm;
const rAllOptions = /([^\s]+)\s+(.+?)\s+(https?:\/\/\S+|\/\S+)\s*(.+)?/;
const rLangCaption = /([^\s]+)\s*(.+)?/;

const escapeSwigTag = str => str.replace(/{/g, '&#123;').replace(/}/g, '&#125;');

/** @param {string} content */
async function handleContent(content) {
    const result = await replaceAsync(content, rBacktick, async (
        $0 /* whole code block inlcuding start */, 
        start /* start of the code block, use to indicate wheter it's in quote or sth else */, 
        $2 /* leading ``` */,
        _args /* code block caption, like "c++" */, 
        _content /* plain content */, 
        end /* end of the whole code block, usaually "\n\n" */
    )=> {
        //console.log({$0, start, $2, _args, _content, end});
        const args = _args.split('=').shift() || "";
        const lang = (rAllOptions.exec(args) || rLangCaption.exec(args))[1];
        if(lang != "mermaid")
            return $0;

        if (start.includes('>')) {
            // heading of last line is already removed by the top RegExp "rBacktick"
            const depth = start.split('>').length - 1;
            const regexp = new RegExp(`^([^\\S\\r\\n]*>){0,${depth}}([^\\S\\r\\n]|$)`, 'mg');
            _content = _content.replace(regexp, '');
        }

        await renderer.start(config.browser.launchOptions);
        const renderResult = await renderer.render(_content);
        if(renderResult.error)  // render failed, return the original code
            return $0;
        //console.log(renderResult);
        const graph =  `<div class="graph-container">${renderResult.svg}</div>`;
        return start
            + '<hexoPostRenderCodeBlock>'
            + escapeSwigTag(graph)
            + '</hexoPostRenderCodeBlock>'
            + end;
    }, config.browser.parallel);  // set no parallel execution here to avoid open too many browser tabs at the same time

    return result;
}

hexo.extend.filter.register("before_post_render", async (data)=> {
    const content = data.content;
    if ((!content.includes('```') && !content.includes('~~~'))) 
        return data;

    data.content = await handleContent(content);;
    return data;
}, 0);

hexo.on("exit", async ()=> {
    await renderer.stop().catch(err=> console.log(err));
});