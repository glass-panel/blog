const fs = require("fs");
const path = require("path");

const { Router } = require("itty-router");

const router = Router();

const page = String.raw`<html>
    <head>
        <script type="module">
            import mermaid from '/mermaid/mermaid.esm.mjs';
            addEventListener("load", async ()=> {
                try {
                    const payload = new URLSearchParams(location.search).get("payload");
                    const result = await mermaid.render("mermaid", payload);
                    console.log(result);
                    window.bridgeResolve(result);
                } catch(e) {
                    window.bridgeReject(e);
                }
            });
        </script>
    </head>
    <body>
    </body>
</html>
`

const mermaidPath = path.dirname(require.resolve("mermaid"));

router.get("/mermaid/:file", async (req)=> {
    return new Response(
        await fs.promises.readFile(path.join(mermaidPath, req.params.file)), {
            status: 200,
            headers: { "Content-Type": "text/javascript" }
        }
    );
});

router.get("/index.html", ()=> {
    return new Response(page, { status: 200, headers: {"Content-Type": "text/html"} });
});

/*
router.post("/result", async (req)=> {
    const body = await req.json();
    console.log(body);
    return new Response("OK", { status: 200 });
});
*/

router.all("*", ()=> {
    return new Response("Not Found", { status: 404 });
});

exports.router = router;