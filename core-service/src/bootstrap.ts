#!/usr/bin/env node

/**
 * Bootstrap wrapper — clears SAP BAS / BTP system proxy env vars
 * BEFORE any library (dotenv, undici, pi-ai, openai SDK) is imported.
 *
 * In ES modules all static `import` statements are hoisted, so clearing
 * env vars inside main.ts is too late — the pi-ai library's http-proxy.js
 * has already read HTTP_PROXY and created an EnvHttpProxyAgent by then.
 *
 * This file uses a dynamic `import()` so that the cleanup runs first.
 */

// Peek at .env to check PROX before dotenv loads (dotenv is in main.ts).
import { readFileSync } from "fs";
import { resolve } from "path";

let prox = process.env.PROX;  // check system env first
if (!prox) {
	try {
		const envContent = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
		const match = envContent.match(/^PROX\s*=\s*(.+)/m);
		if (match) prox = match[1].trim();
	} catch { /* .env not found — fine */ }
}

// On SAP BAS/BTP the platform injects HTTP_PROXY / HTTPS_PROXY pointing
// to an internal proxy (e.g. http://127.0.0.1:8887) that cannot reach
// external LLM endpoints.  When our own PROX var is absent we don't
// want *any* proxy, so strip them before anything else loads.
if (!prox) {
	for (const key of [
		"HTTP_PROXY", "HTTPS_PROXY",
		"http_proxy", "https_proxy",
	]) {
		delete process.env[key];
	}
	process.env.NO_PROXY = "*";
	process.env.no_proxy = "*";
	console.log("[bootstrap] Cleared system proxy env vars, set NO_PROXY=* (PROX not set)");
} else {
	console.log(`[bootstrap] PROX detected (${prox}), keeping proxy env vars`);
}

// Now load the real entry point — all its static imports will see the
// cleaned environment.
await import("./main.js");
