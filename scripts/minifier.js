const htmlMinify = require('html-minifier-terser').minify;
const cssMinify = require('csso').minify;
const jsMinify = require('uglify-js').minify;


hexo.extend.filter.register('after_render:html',(data)=> {
    return htmlMinify(data);
});

hexo.extend.filter.register('after_render:css',(data)=> {
    return cssMinify(data).css;
});

hexo.extend.filter.register('after_render:js',(data)=> {
    return jsMinify(data).code;
});

