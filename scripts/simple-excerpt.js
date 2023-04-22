/*
    Extract the first line of the article as the excerpt if the excerpt is not set.
*/

hexo.extend.filter.register("after_post_render", (data)=> {
    //console.log(data.updated);
    data.excerpt = data.excerpt? data.excerpt : data.content.split(/\r?\n/)[0];
    return data;
});
