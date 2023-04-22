const fs = require('fs');
const child_process = require('child_process');

const moment = require('moment');

hexo.extend.filter.register("before_post_render", async (data)=> {
    try {
        const stat = await fs.promises.stat(`./source/${data.source}`);
        if(data.date.isSame(stat.birthtime)) {  // the post is using the default date
            const gitTime = parseInt(
                child_process.execSync(`git log --follow --format=%ad --date unix -1 -- ./source/${data.source}`)
                .toString().trim()
            );
            if(isNaN(gitTime)) {
                console.log(`No git commit date for ${data.source}, using default`);
                return data;
            }
            const date = new Date(gitTime*1000);
            data.date = moment(date);
            console.log(`Replaced the default create date of ${data.source} to git commit date: ${date.toJSON()}`);
        }
    } catch(e) {
        console.log(`Failed to get/set git commit date of ${data.source}: ${e}`);
    }
    return data;
});