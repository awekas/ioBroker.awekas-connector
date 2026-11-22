/**
 *
 *      ioBroker AWEKAS weather data connector
 *
 *      (c) 2023-2026 AWEKAS GmbH
 *      MIT License
 *
 *  Reads live weather data and a forecast of the user's own AWEKAS weather station
 *  through the AWEKAS Stations API V2.1 (current.php every interval, station.php once a day).
 *  The AWEKAS API key can be found at https://my.awekas.at (requires AWEKAS Plus).
 *
 *  Protection of the AWEKAS servers:
 *   - one request at a time, never overlapping (setTimeout chain, no setInterval)
 *   - enforced minimum interval, random start delay and jitter so that installations
 *     do not hit the API at the same second
 *   - exponential back-off on network/server errors, Retry-After is honoured
 *   - polling stops completely on permanent errors (invalid key, AWEKAS Plus not active)
 *     until the configuration is changed (which restarts the instance)
 *   - fixed HTTPS endpoint, no redirects, request timeout, response size limit
 *   - identifying User-Agent so AWEKAS can see which client generates traffic
 *
 *  Protection of the user:
 *   - API key is stored encrypted (encryptedNative / protectedNative)
 *   - API key and request URL are never written to the log
 *   - no third-party HTTP library (uses Node's built-in fetch)
 */

"use strict";

const utils = require("@iobroker/adapter-core");
const { defs, channels } = require("./lib/states");
const pkg = require("./package.json");

const API_BASE = "https://api.awekas.at/";
const ENDPOINTS = { current: "current.php", station: "station.php" };
const USER_AGENT = `ioBroker.awekas-connector/${pkg.version}`;

const MIN_INTERVAL_S = 60; // hard lower limit, cannot be configured below
const DEFAULT_INTERVAL_S = 60;
const MAX_INTERVAL_S = 3600;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_STRING_LENGTH = 1024;
const JITTER = 0.1; // +/- 10 %

const BACKOFF_START_MS = 5 * 60_000;
const BACKOFF_MAX_MS = 60 * 60_000;
const QUOTA_WAIT_MS = 15 * 60_000;
const STATION_REFRESH_MS = 24 * 60 * 60_000; // station data rarely changes

// AWEKAS limits (API description V2.1): 240 requests per hour, 2 requests per second.
// With the minimum interval of 60 s the adapter uses at most 61 requests per hour.

const SUPPORTED_LANGUAGES = ["de", "en", "es", "it", "fr", "nl", "pl"];

const WIND_TEXT = {
	de: ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"],
	en: ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"],
	es: ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"],
	it: ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"],
	fr: ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"],
	nl: ["N", "NNO", "NO", "ONO", "O", "OZO", "ZO", "ZZO", "Z", "ZZW", "ZW", "WZW", "W", "WNW", "NW", "NNW"],
	pl: ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"],
};

/** errors after which polling is stopped until the configuration changes */
const PERMANENT_ERRORS = {
	"invalid key": "Invalid AWEKAS API key - please copy the correct key from https://my.awekas.at",
	"awekas plus not active":
		"AWEKAS Plus is not active - AWEKAS Plus is required for the Stations API. Please activate it in your AWEKAS user profile.",
};

class AwekasConnector extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options]
	 */
	constructor(options = {}) {
		super({
			...options,
			name: "awekas-connector",
		});
		/** @type {ioBroker.Timeout | undefined} */
		this.pollTimer = undefined;
		this.apiLanguage = "en";
		this.intervalMs = DEFAULT_INTERVAL_S * 1000;
		this.backoffMs = 0;
		/** @type {string} */
		this.token = "";
		this.stopped = false;
		this.lastLoggedError = "";
		this.lastStationFetch = 0;

		this.on("ready", this.onReady.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	async onReady() {
		await this.setState("info.connection", false, true);

		let token = typeof this.config.token === "string" ? this.config.token.trim() : "";
		// the key is base64; accept it also when it was copied URL-encoded (%2B, %2F, %3D)
		if (/%[0-9a-f]{2}/i.test(token)) {
			try {
				token = decodeURIComponent(token);
			} catch {
				// keep as entered, format check below reports the problem
			}
		}
		if (!token) {
			this.log.error("No AWEKAS API key configured. Please enter your key in the adapter settings.");
			return;
		}
		if (!/^[A-Za-z0-9+/=_-]{8,256}$/.test(token)) {
			this.log.error("The configured AWEKAS API key has an invalid format. Please check the adapter settings.");
			return;
		}
		/** @type {string} */
		this.token = token;

		let interval = Number(this.config.interval) || DEFAULT_INTERVAL_S;
		if (interval < MIN_INTERVAL_S) {
			this.log.warn(`Interval ${interval}s is below the minimum, using ${MIN_INTERVAL_S}s.`);
			interval = MIN_INTERVAL_S;
		}
		this.intervalMs = Math.min(interval, MAX_INTERVAL_S) * 1000;

		this.apiLanguage = await this.detectLanguage();

		await this.createObjects();

		// random start delay (5 s up to one interval) spreads restarts of many installations
		const startDelay = 5000 + Math.floor(Math.random() * Math.max(0, this.intervalMs - 5000));
		this.log.info(`AWEKAS connector started (interval ${this.intervalMs / 1000}s, language ${this.apiLanguage}).`);
		this.log.debug(`First request in ${Math.round(startDelay / 1000)}s`);
		this.schedule(startDelay);
	}

	/**
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			this.stopped = true;
			if (this.pollTimer) this.clearTimeout(this.pollTimer);
			callback();
		} catch {
			callback();
		}
	}

	/** @returns {Promise<string>} */
	async detectLanguage() {
		const configured = typeof this.config.language === "string" ? this.config.language : "";
		if (SUPPORTED_LANGUAGES.includes(configured)) return configured;
		try {
			const sys = await this.getForeignObjectAsync("system.config");
			const lang = sys && sys.common && sys.common.language;
			if (lang && SUPPORTED_LANGUAGES.includes(lang)) return lang;
		} catch (e) {
			this.log.debug(`Could not read system language: ${e}`);
		}
		return "en";
	}

	async createObjects() {
		for (const [id, name] of Object.entries(channels)) {
			await this.extendObject(id, { type: "channel", common: { name }, native: {} });
		}
		for (const def of defs) {
			/** @type {ioBroker.StateCommon} */
			const common = {
				name: def.name || def.id,
				type: def.type,
				role: def.role || "value",
				read: true,
				write: false,
			};
			if (def.unit) common.unit = def.unit;
			if (def.states) common.states = def.states;
			await this.extendObject(def.id, { type: "state", common, native: {} });
		}
	}

	/**
	 * Schedule the next request. Only one timer exists at any time.
	 * @param {number} delayMs
	 */
	schedule(delayMs) {
		if (this.stopped) return;
		if (this.pollTimer) this.clearTimeout(this.pollTimer);
		this.pollTimer = this.setTimeout(() => {
			this.pollTimer = undefined;
			this.poll().catch((e) => this.log.error(`Unexpected error: ${e}`));
		}, delayMs);
	}

	/** @param {number} ms */
	withJitter(ms) {
		return Math.round(ms * (1 - JITTER + Math.random() * 2 * JITTER));
	}

	async poll() {
		let nextDelay = this.withJitter(this.intervalMs);
		try {
			const data = await this.fetchData();
			const apiError = typeof data.error === "string" ? data.error.trim() : data.error ? String(data.error) : "";

			if (apiError) {
				await this.setState("info.error", apiError.slice(0, MAX_STRING_LENGTH), true);
				await this.setState("info.connection", false, true);
				const key = apiError.toLowerCase();
				if (PERMANENT_ERRORS[key]) {
					this.log.error(`${PERMANENT_ERRORS[key]} Polling stopped until the configuration is changed.`);
					this.stopped = true;
					return;
				}
				if (key.includes("quota")) {
					this.logOnce("quota", "AWEKAS API quota exceeded - waiting 15 minutes.");
					nextDelay = this.withJitter(QUOTA_WAIT_MS);
				} else {
					this.logOnce(key, `AWEKAS API reported an error: ${apiError}`);
					nextDelay = this.nextBackoff();
				}
				return;
			}

			await this.writeStates(data, "current");
			await this.setState("info.error", "", true);
			await this.setState("info.connection", true, true);
			if (this.backoffMs) this.log.info("Connection to AWEKAS restored.");
			this.backoffMs = 0;
			this.lastLoggedError = "";

			if (Date.now() - this.lastStationFetch > STATION_REFRESH_MS) {
				await this.updateStation();
			}
		} catch (e) {
			await this.setState("info.connection", false, true);
			if (e instanceof HttpError && e.retryAfterMs) {
				nextDelay = Math.min(Math.max(e.retryAfterMs, this.intervalMs), BACKOFF_MAX_MS);
			} else {
				nextDelay = this.nextBackoff();
			}
			this.logOnce(
				String(e && e.message),
				`AWEKAS server not reachable (${e && e.message}). Next try in ${Math.round(nextDelay / 60000)} min.`,
			);
		} finally {
			this.schedule(nextDelay);
		}
	}

	/** Station data is optional: errors are only logged, they never affect the polling. */
	async updateStation() {
		this.lastStationFetch = Date.now();
		try {
			// AWEKAS allows max. 2 requests per second
			if (typeof this.delay === "function") await this.delay(1500);
			else await sleep(1500);
			if (this.stopped) return;
			const data = await this.fetchData("station");
			if (data.error) {
				this.log.debug(`station.php reported: ${String(data.error).slice(0, 200)}`);
				return;
			}
			await this.writeStates(data, "station");
		} catch (e) {
			this.log.debug(`Could not read station data: ${e && e.message}`);
		}
	}

	nextBackoff() {
		this.backoffMs = this.backoffMs ? Math.min(this.backoffMs * 2, BACKOFF_MAX_MS) : BACKOFF_START_MS;
		return this.withJitter(this.backoffMs);
	}

	/**
	 * Log a warning only when the error changes, to avoid flooding the log.
	 * @param {string} key
	 * @param {string} message
	 */
	logOnce(key, message) {
		if (this.lastLoggedError === key) {
			this.log.debug(message);
		} else {
			this.log.warn(message);
			this.lastLoggedError = key;
		}
	}

	/**
	 * @param {keyof typeof ENDPOINTS} [endpoint]
	 * @returns {Promise<Record<string, any>>}
	 */
	async fetchData(endpoint = "current") {
		let url = `${API_BASE}${ENDPOINTS[endpoint]}?key=${encodeURIComponent(this.token)}`;
		if (endpoint === "current") url += `&lng=${this.apiLanguage}`;
		const res = await fetch(url, {
			method: "GET",
			redirect: "error",
			headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});

		if (!res.ok) {
			let retryAfterMs = 0;
			const ra = res.headers.get("retry-after");
			if (ra && /^\d+$/.test(ra)) retryAfterMs = Number(ra) * 1000;
			throw new HttpError(`HTTP ${res.status}`, retryAfterMs);
		}

		const length = Number(res.headers.get("content-length") || 0);
		if (length > MAX_RESPONSE_BYTES) throw new Error("response too large");
		const text = await res.text();
		if (text.length > MAX_RESPONSE_BYTES) throw new Error("response too large");

		// debug output helps analysing problems on user systems (contains no API key)
		this.log.debug(`AWEKAS ${endpoint} response (${text.length} bytes): ${text.slice(0, 4000)}`);

		let data;
		try {
			data = JSON.parse(text);
		} catch {
			throw new Error("invalid JSON response");
		}
		if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("unexpected response format");
		return data;
	}

	/**
	 * @param {Record<string, any>} data
	 * @param {string} endpoint
	 */
	async writeStates(data, endpoint) {
		for (const def of defs) {
			if (def.endpoint !== endpoint || def.id === "info.error") continue;
			let val;
			if (def.windText) {
				const deg = /** @type {number | null | undefined} */ (this.normalize(getPath(data, def.windText), "number"));
				if (deg === undefined) continue;
				val = deg === null ? null : this.windText(deg);
			} else if (def.path) {
				val = this.normalize(getPath(data, def.path), def.type);
				if (def.timestamp && typeof val === "number") val = toMilliseconds(val);
			}
			if (val === undefined) continue; // field not delivered: keep last value
			try {
				await this.setState(def.id, val, true);
			} catch (e) {
				this.log.debug(`Could not write ${def.id}: ${e}`);
			}
		}
	}

	/**
	 * Converts an API value to the expected type. Returns undefined if the
	 * field is missing and null if the station has no value for it.
	 * @param {unknown} raw
	 * @param {ioBroker.CommonType} type
	 * @returns {string | number | boolean | null | undefined}
	 */
	normalize(raw, type) {
		if (raw === undefined) return undefined;
		if (raw === null || raw === "" || raw === "-") return null;
		if (typeof raw === "object") return undefined;
		switch (type) {
			case "number": {
				const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
				return Number.isFinite(n) ? n : null;
			}
			case "boolean":
				if (typeof raw === "boolean") return raw;
				if (raw === 1 || raw === "1" || raw === "true") return true;
				if (raw === 0 || raw === "0" || raw === "false") return false;
				return null;
			default:
				return String(raw).slice(0, MAX_STRING_LENGTH);
		}
	}

	/** @param {number} deg */
	windText(deg) {
		if (deg < 0 || deg > 360) return null;
		const list = WIND_TEXT[this.apiLanguage] || WIND_TEXT.en;
		return list[Math.round(deg / 22.5) % 16];
	}
}

class HttpError extends Error {
	/**
	 * @param {string} message
	 * @param {number} retryAfterMs
	 */
	constructor(message, retryAfterMs) {
		super(message);
		this.retryAfterMs = retryAfterMs;
	}
}

/** @param {number} ms */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * AWEKAS delivers unix timestamps in seconds, ioBroker (role value.time) expects milliseconds.
 * @param {number} ts
 * @returns {number | null}
 */
function toMilliseconds(ts) {
	if (ts <= 0) return null;
	if (ts < 1e11) return ts * 1000; // seconds
	return ts; // already milliseconds
}

/**
 * @param {Record<string, any>} obj
 * @param {string[]} path
 */
function getPath(obj, path) {
	let cur = obj;
	for (const p of path) {
		if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
		cur = cur[p];
	}
	return cur;
}

if (require.main !== module) {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options]
	 */
	module.exports = (options) => new AwekasConnector(options);
} else {
	new AwekasConnector();
}
