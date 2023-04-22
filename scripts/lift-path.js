/*
    Lift the path of the post if its parent folder's name is the same as the title.
    Works under the configuration:
        pretty_urls:
            trailing_index: true
            trailing_html: true
*/

hexo.extend.filter.register("post_permalink", (data)=> {
    const format = hexo.config.permalink.split("/");
    const path = data.split("/");
    const base = [];
    while(format.length && path.length && format[0] != ':title') {
        base.push(format.shift());
        path.shift();
    }
    if(path.length < 2)
        return data;
    if(path[0] == path[1])
        path.shift();
    else if(path[1] == "index")
        path.splice(1, 1);
    return base.concat(path).join("/");
});
