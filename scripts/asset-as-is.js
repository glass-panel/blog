/*
    Copy all the assets in the source folder to the corresponding path in the public folder.
    * Need to configure marked: prependRoot: false in _config.yml
*/

const fs = require("fs");

const excludeSuffix = [
    "md","markdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext",   // hexo-renderer-marked
    "ejs",  // hexo-renderer-ejs
    "html", "htm",  
    "styl", "stylus",   // hexo-renderer-stylus
].filter(i=>i);

//const patten = new RegExp("^(.+)(?<!\\." + excludeSuffix.join("|\\.") + ")$", "g");

hexo.source.addProcessor("*", (source)=> {
    //console.log(source);
    if(source.type == "delete")
        return;
    const path = source.path.split("/");
    let exclude = false;
    for(const i of excludeSuffix)
        exclude = source.path.endsWith(i)? true : exclude;
    if(exclude)
        return;
    const base = [];
    if(path[0] == "_posts") {
        path.shift();
        const format = hexo.config.permalink.split("/");
        while(format.length && format[0] != ':title')
            base.push(format.shift());   
    }
    //console.log(base.concat(path).join("/"));
    hexo.extend.generator.register(`asset_as_is-${base.concat(path).join("_")}`, (locals)=> {
        return {
            path: base.concat(path).join("/"),
            data: ()=>fs.createReadStream(source.source)
        };
    });
});