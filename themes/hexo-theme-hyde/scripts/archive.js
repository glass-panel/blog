const pagination = require('hexo-pagination');
hexo.extend.generator.register('archive', function(locals){
	return pagination('archives', locals.posts.sort('date', 'desc'), {
		perPage: 5,
		layout: ['archive', 'index'],
		data: {}
	});
});
