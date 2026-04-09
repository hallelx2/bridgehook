const http = require("node:http");

const server = http.createServer((req, res) => {
	// CORS headers — required for BridgeHook to forward requests
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "*");

	// Handle CORS preflight
	if (req.method === "OPTIONS") {
		res.writeHead(204);
		res.end();
		return;
	}

	// Collect request body
	let body = "";
	req.on("data", (chunk) => {
		body += chunk;
	});
	req.on("end", () => {
		console.log(`\n📨 ${req.method} ${req.url}`);
		console.log(`   Headers: ${JSON.stringify(req.headers, null, 2).split("\n").join("\n   ")}`);
		if (body) console.log(`   Body: ${body}`);

		// Respond
		const response = {
			received: true,
			method: req.method,
			path: req.url,
			timestamp: new Date().toISOString(),
			echo: body ? JSON.parse(body) : null,
		};

		console.log("   ✅ Responding 200 OK");

		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(response, null, 2));
	});
});

server.listen(5000, () => {
	console.log("🚀 Test server running on http://localhost:5000");
	console.log("   Waiting for webhooks from BridgeHook...\n");
});
