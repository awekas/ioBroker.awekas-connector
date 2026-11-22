"use strict";

/**
 * Unit tests for the AWEKAS connector.
 * The adapter runs against a stubbed @iobroker/adapter-core and a stubbed fetch,
 * so no ioBroker installation and no network access are needed.
 */

const { expect } = require("chai");
const EventEmitter = require("events");
const proxyquire = require("proxyquire").noCallThru();
const { defs, channels } = require("../lib/states");

const KEY = "UwPBC8YStcrI3hFJLqiSE+fWABvkjvljdsf668x0eVLcwkVCuq+xCDeZVyla0q5F+yOp9arW4ppQH880g==";

/** example response from the AWEKAS Stations API description V2.1 (shortened) */
const CURRENT = {
	fetchdate: 1671208622,
	error: null,
	current: {
		datatimestamp: 1671208560,
		timeoffset: 3600,
		conditiontimestamp: null,
		condition: 0,
		temperature: 0,
		dewpoint: -0.5,
		humidity: 96,
		airpress_rel: 1011.8,
		tendency: 1,
		itsraining: false,
		windspeed: 1.4,
		winddirection: 348,
		brightness: null,
		temp1: 5,
	},
	"1h": { precipitation_1h: null },
	day: { temp_min: -1.3, temp_min_ts: 1671162660, winddir_max: 118, gustdir_max: 118 },
	forecast: {
		day0: { fc_code: 1225, fc_icon: 338, fc_text: "starker Schneefall", fc_temp_min: -6.5, fc_temp_max: 1.8 },
	},
};
const STATION = {
	fetchdate: 1596303120,
	error: null,
	station: { id: 5, location: "Micheldorf Test", londec: 14.13, latdec: 47.87, elevation: 480, AWEKASplus: 1 },
	stationsweb: { enabled: 1, period: "2021-12-31" },
};

class FakeAdapter extends EventEmitter {
	constructor(options) {
		super();
		this.name = options.name;
		this.config = FakeAdapter.config;
		this.objects = {};
		this.states = {};
		this.logs = [];
		this.timers = [];
		const log = (level) => (msg) => this.logs.push(`${level}: ${msg}`);
		this.log = { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") };
	}
	async extendObject(id, obj) {
		this.objects[id] = obj;
	}
	async setState(id, val, ack) {
		if (ack !== true) throw new Error("ack missing");
		if (val === undefined) throw new Error(`undefined value for ${id}`);
		this.states[id] = val;
	}
	async getForeignObjectAsync() {
		return { common: { language: "de" } };
	}
	async delay() {}
	setTimeout(fn, ms) {
		const t = { fn, ms };
		this.timers.push(t);
		return t;
	}
	clearTimeout(t) {
		this.timers = this.timers.filter((x) => x !== t);
	}
}

/**
 * @param {Record<string, any>} config
 * @param {(url: string) => any} responder
 */
async function startAdapter(config, responder) {
	FakeAdapter.config = config;
	const requests = [];
	global.fetch = async (url, opts) => {
		requests.push({ url, opts });
		const r = responder(url);
		if (r instanceof Error) throw r;
		return {
			ok: r.status === 200,
			status: r.status,
			headers: { get: (h) => (r.headers || {})[h.toLowerCase()] || null },
			text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
		};
	};
	const factory = proxyquire("../main.js", { "@iobroker/adapter-core": { Adapter: FakeAdapter } });
	const adapter = factory({});
	await adapter.listeners("ready")[0]();
	return { adapter, requests };
}

/** run the next scheduled poll */
async function tick(adapter) {
	const t = adapter.timers.shift();
	if (!t) return undefined;
	await t.fn();
	await new Promise((r) => setImmediate(r));
	await new Promise((r) => setImmediate(r));
	return t.ms;
}

const ok = (url) => ({ status: 200, body: url.includes("station.php") ? STATION : CURRENT });

describe("state definitions", () => {
	it("has unique ids", () => {
		const ids = defs.map((d) => d.id);
		expect(new Set(ids).size).to.equal(ids.length);
	});
	it("every state belongs to a channel and has type and role", () => {
		for (const def of defs) {
			const channel = def.id.split(".").slice(0, -1).join(".");
			expect(channels, def.id).to.have.property(channel);
			expect(def.type, def.id).to.be.oneOf(["number", "string", "boolean"]);
			expect(def.role, def.id).to.be.a("string").and.not.equal("");
		}
	});
});

describe("AWEKAS connector", () => {
	afterEach(() => {
		delete global.fetch;
	});

	it("writes the example response of the API description with correct types", async () => {
		const { adapter } = await startAdapter({ token: KEY, interval: 60 }, ok);
		await tick(adapter);
		const s = adapter.states;
		expect(s["info.connection"]).to.equal(true);
		expect(s["current.temperature"]).to.equal(0);
		expect(s["current.itsraining"]).to.equal(false);
		expect(s["current.brightness"]).to.equal(null);
		expect(s["current.winddirection_text"]).to.equal("NNW");
		expect(s["day.winddir_max_text"]).to.equal("OSO");
		expect(s["info.fetchdate"]).to.equal(1671208622000);
		expect(s["day.temp_min_ts"]).to.equal(1671162660000);
		expect(s["forecast.day0.icon"]).to.equal(338);
		expect(s["forecast.day0.text"]).to.equal("starker Schneefall");
		expect(s["station.location"]).to.equal("Micheldorf Test");
		expect(s["station.awekasplus"]).to.equal(true);
		for (const [id, val] of Object.entries(s)) {
			if (val === null || !adapter.objects[id]) continue;
			expect(typeof val, id).to.equal(adapter.objects[id].common.type);
		}
	});

	it("never writes the API key to the log and only calls the AWEKAS API via https", async () => {
		const { adapter, requests } = await startAdapter({ token: KEY, interval: 60 }, ok);
		await tick(adapter);
		expect(adapter.logs.join("\n")).to.not.include(KEY);
		expect(adapter.logs.join("\n")).to.not.include(encodeURIComponent(KEY));
		for (const r of requests) {
			expect(r.url.startsWith("https://api.awekas.at/")).to.equal(true);
			expect(r.opts.redirect).to.equal("error");
			expect(r.opts.signal).to.exist;
		}
	});

	it("accepts a URL-encoded key", async () => {
		const { requests, adapter } = await startAdapter({ token: encodeURIComponent(KEY), interval: 60 }, ok);
		await tick(adapter);
		expect(requests[0].url).to.include(`key=${encodeURIComponent(KEY)}&`);
	});

	it("enforces the minimum interval of 60 s", async () => {
		const { adapter } = await startAdapter({ token: KEY, interval: 10 }, ok);
		const delay = await tick(adapter);
		expect(delay).to.be.at.most(60_000);
		expect(adapter.timers[0].ms).to.be.at.least(54_000);
	});

	it("does not query without API key", async () => {
		const { adapter, requests } = await startAdapter({ token: "", interval: 60 }, ok);
		expect(adapter.timers).to.have.length(0);
		expect(requests).to.have.length(0);
	});

	it("stops polling on an invalid key", async () => {
		const { adapter, requests } = await startAdapter({ token: KEY }, () => ({
			status: 200,
			body: { error: "invalid key" },
		}));
		await tick(adapter);
		expect(adapter.timers).to.have.length(0);
		expect(requests).to.have.length(1);
		expect(adapter.states["info.connection"]).to.equal(false);
	});

	it("stops polling if AWEKAS Plus is not active", async () => {
		const { adapter } = await startAdapter({ token: KEY }, () => ({
			status: 200,
			body: { error: "AWEKAS plus not active" },
		}));
		await tick(adapter);
		expect(adapter.timers).to.have.length(0);
	});

	it("waits 15 minutes when the quota is exceeded", async () => {
		const { adapter } = await startAdapter({ token: KEY }, () => ({
			status: 200,
			body: { error: "maximum quota exceeded" },
		}));
		await tick(adapter);
		expect(adapter.timers[0].ms).to.be.within(13.5 * 60_000, 16.5 * 60_000);
	});

	it("backs off exponentially when the server is not reachable", async () => {
		const { adapter } = await startAdapter({ token: KEY }, () => new Error("fetch failed"));
		await tick(adapter);
		const delays = [];
		for (let i = 0; i < 6; i++) delays.push(await tick(adapter));
		expect(delays[0]).to.be.within(4.5 * 60_000, 5.5 * 60_000);
		expect(delays[1]).to.be.within(9 * 60_000, 11 * 60_000);
		expect(delays[5]).to.be.at.most(66 * 60_000);
		expect(adapter.logs.filter((l) => l.startsWith("warn")).length).to.equal(1);
	});

	it("honours Retry-After", async () => {
		const { adapter } = await startAdapter({ token: KEY }, () => ({
			status: 429,
			headers: { "retry-after": "1200" },
			body: "",
		}));
		await tick(adapter);
		expect(adapter.timers[0].ms).to.equal(1_200_000);
	});

	it("rejects invalid and oversized responses", async () => {
		const bodies = ["<html>", "x".repeat(600_000), "[1,2]"];
		const { adapter } = await startAdapter({ token: KEY }, () => ({ status: 200, body: bodies.shift() }));
		for (let i = 0; i < 3; i++) await tick(adapter);
		expect(adapter.states["info.connection"]).to.equal(false);
		expect(Object.keys(adapter.states).filter((k) => k.startsWith("current."))).to.have.length(0);
	});
});
