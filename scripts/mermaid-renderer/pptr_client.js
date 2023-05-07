const fs = require('fs');

const puppeteer = require('puppeteer');

const server = require('./server.js');

/** @type {puppeteer.Browser} */
let browser = null;
let running = false;

async function start(options) {
    if(!browser && !running) {
        running = Promise.resolve().then(async ()=> {
            console.log("Starting browser for mermaid render...");
            browser = await puppeteer.launch(options);
        });
        await running;
    } else if(!browser && running) {
        await running;
    }
}

async function stop() {
    console.log("Stopping browser for mermaid render...");
    if(browser)
        await browser.close();
    browser = null;
    running = false;
}

const localhost = "1145141919810mulimuli";

async function render(code) {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
        if(req.isInterceptResolutionHandled())
            return;
        //console.log(req.url());
        const url = new URL(req.url());
        if(url.hostname == localhost) {
            /** @type {Response} */
            const response = await server.router.handle(
                new Request(req.url(), {
                    method: req.method(),
                    headers: req.headers(),
                    body: req.postData()
                }
            ));
            req.respond({
                status: response.status, 
                headers: Object.fromEntries(response.headers), 
                body: await response.text()
            });
        } else
            req.continue();
    });
    const resPromise = new Promise((resolve, reject)=> {
        page.exposeFunction("bridgeResolve", async (value)=> {
            //console.log(value);
            resolve(value);
        });
        page.exposeFunction("bridgeReject", async (error)=> {
            //console.log(error);
            reject(error);
        });
    }).catch(err=> ({error: err}));
    await page.goto(
        `http://${localhost}/index.html?payload=${encodeURIComponent(code)}`, { 
            waitUntil: "networkidle0" 
        }
    );
    const result = await resPromise.finally(async ()=> {
        await page.close();
    });
    return result;
}

module.exports = {
    start,
    stop,
    render
};