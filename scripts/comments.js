/*
    This script is used to generate comments.json for each post that allows to comment. 
    Works under the configuration:
        pretty_urls:
            trailing_index: true
            trailing_html: true
*/

const fs = require("fs");
const path = require("path");

hexo.extend.generator.register("generate-comments", async (locals)=> {
    return locals.posts.data.map(async (data)=> {
        //console.log(data.path);
        const publicPath = path.join(hexo.public_dir, "comments", data.path);
        if(!data.comments || path.extname(data.path) != "") {
            // Comments forbidden or not a folder, do nothing
            return;
        }
        // by default, comments are empty json array
        let content = "[]";
        if(await fs.promises.stat(path.join(publicPath, "comments.json")).catch(()=> false)) {
            // comments.json already exists
            console.log(`Comments.json found in ${publicPath}, using it.`);
            content = await fs.promises.readFile(path.join(publicPath, "comments.json"));
        }
        // register generator to generate comments.json in public folder
        console.log(`Generating comments.json for ${data.path}`);
        return {
            path: path.join("comments", data.path, "comments.json"),
            data: content,
        };
    })
}, );