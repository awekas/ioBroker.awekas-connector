"use strict";

/**
 * State definitions for the AWEKAS weather connector.
 *
 * Each entry describes one ioBroker state:
 *   id    - state id below the adapter instance (channel.state)
 *   path  - path of the value in the response of https://api.awekas.at/current.php
 *   type  - ioBroker common.type
 *   unit  - optional unit
 *   wind  - if set, the state is a compass text derived from the given path (degrees)
 */

/** @typedef {{id: string, path?: string[], type: ioBroker.CommonType, unit?: string, role?: string, name?: string, windText?: string[], timestamp?: boolean, endpoint?: string, states?: Record<string, string>}} StateDef */

const UNIT_ROLES = {
	"°C": "value.temperature",
	"%": "value.humidity",
	hPa: "value.pressure",
	"km/h": "value.speed.wind",
	"°": "value.direction.wind",
	mm: "value.precipitation",
	"mm/h": "value.precipitation.hour",
	"W/m²": "value.radiation",
	Lux: "value.brightness",
	idx: "value.uv",
	cm: "value",
	h: "value",
	cbar: "value",
	"µg/m³": "value",
};

/** @type {StateDef[]} */
const defs = [];

/**
 * @param {string} id
 * @param {string[]} path
 * @param {ioBroker.CommonType} type
 * @param {string} [unit]
 * @param {string} [name]
 */
function add(id, path, type, unit, name) {
	defs.push({ id, path, type, unit, name });
}

// ---------- general / info ----------
add("info.fetchdate", ["fetchdate"], "number", undefined, "Time of last data fetch (unix timestamp)");
add("info.error", ["error"], "string", undefined, "Error reported by the AWEKAS API");

// ---------- current values ----------
const current = [
	["datatimestamp", "number", undefined, "Timestamp of the measured data"],
	["timeoffset", "number", "s", "Station time offset to UTC"],
	["conditiontimestamp", "number", undefined, "Timestamp of the weather condition"],
	["condition", "number", undefined, "Weather condition code"],
	["temperature", "number", "°C", "Temperature"],
	["dewpoint", "number", "°C", "Dew point"],
	["windchill", "number", "°C", "Wind chill"],
	["wetbulbtemperature", "number", "°C", "Wet bulb temperature"],
	["humidity", "number", "%", "Humidity"],
	["airpress_rel", "number", "hPa", "Relative air pressure"],
	["tendency", "number", undefined, "Air pressure tendency"],
	["precipitation", "number", "mm", "Precipitation today"],
	["rainrate", "number", "mm/h", "Rain rate"],
	["itsraining", "boolean", undefined, "It is raining"],
	["windspeed", "number", "km/h", "Wind speed"],
	["gustspeed", "number", "km/h", "Gust speed"],
	["winddirection", "number", "°", "Wind direction"],
	["uv", "number", "idx", "UV index"],
	["solar", "number", "W/m²", "Solar radiation"],
	["brightness", "number", "Lux", "Brightness"],
	["suntime", "number", "h", "Sunshine duration"],
	["snowheighttimestamp", "number", undefined, "Timestamp of snow height"],
	["snowheight", "number", "cm", "Snow height"],
	["temp1", "number", "°C", "Extra temperature 1"],
	["temp2", "number", "°C", "Extra temperature 2"],
	["temp3", "number", "°C", "Extra temperature 3"],
	["temp4", "number", "°C", "Extra temperature 4"],
	["humidity1", "number", "%", "Extra humidity 1"],
	["humidity2", "number", "%", "Extra humidity 2"],
	["humidity3", "number", "%", "Extra humidity 3"],
	["humidity4", "number", "%", "Extra humidity 4"],
	["soilmoisture1", "number", "cbar", "Soil moisture 1"],
	["soilmoisture2", "number", "cbar", "Soil moisture 2"],
	["soilmoisture3", "number", "cbar", "Soil moisture 3"],
	["soilmoisture4", "number", "cbar", "Soil moisture 4"],
	["leafwetness1", "number", undefined, "Leaf wetness 1"],
	["leafwetness2", "number", undefined, "Leaf wetness 2"],
	["indoortemperature", "number", "°C", "Indoor temperature"],
	["indoorhumidity", "number", "%", "Indoor humidity"],
	["airquality_pm1", "number", "µg/m³", "Air quality PM1"],
	["airquality_pm2", "number", "µg/m³", "Air quality PM2.5"],
	["airquality_pm10", "number", "µg/m³", "Air quality PM10"],
];
for (const [key, type, unit, name] of current) {
	add(`current.${key}`, ["current", key], /** @type {ioBroker.CommonType} */ (type), unit, name);
}
defs.push({
	id: "current.winddirection_text",
	type: "string",
	name: "Wind direction (text)",
	windText: ["current", "winddirection"],
});
add("current.precipitation_1h", ["1h", "precipitation_1h"], "number", "mm", "Precipitation last hour");

// ---------- daily min/max values ----------
/** @type {[string, string|undefined, string][]} */
const dayMinMax = [
	["temp", "°C", "temperature"],
	["dewpoint", "°C", "dew point"],
	["hum", "%", "humidity"],
	["airp_rel", "hPa", "relative air pressure"],
	["windspeed", "km/h", "wind speed"],
	["gustspeed", "km/h", "gust speed"],
	["intemp", "°C", "indoor temperature"],
	["inhum", "%", "indoor humidity"],
];
for (const [key, unit, label] of dayMinMax) {
	for (const mm of ["min", "max"]) {
		add(`day.${key}_${mm}`, ["day", `${key}_${mm}`], "number", unit, `Day ${mm} ${label}`);
		add(`day.${key}_${mm}_ts`, ["day", `${key}_${mm}_ts`], "number", undefined, `Time of day ${mm} ${label}`);
	}
}
/** @type {[string, string|undefined, string, boolean][]} */
const dayMax = [
	["rainrate_max", "mm/h", "Day max rain rate", true],
	["brightness_max", "Lux", "Day max brightness", true],
	["solar_max", "W/m²", "Day max solar radiation", true],
	["uv_max", "idx", "Day max UV index", true],
	["precipitation_24h", "mm", "Precipitation last 24h", false],
	["gustdir_max", "°", "Direction of day max gust", false],
	["winddir_max", "°", "Direction of day max wind", false],
	["airquality_pm1", "µg/m³", "Day air quality PM1", false],
	["airquality_pm2", "µg/m³", "Day air quality PM2.5", false],
	["airquality_pm10", "µg/m³", "Day air quality PM10", false],
];
for (const [key, unit, name, withTs] of dayMax) {
	add(`day.${key}`, ["day", key], "number", unit, name);
	if (withTs) {
		add(`day.${key}_ts`, ["day", `${key}_ts`], "number", undefined, `Time of ${name.toLowerCase()}`);
	}
}
defs.push({ id: "day.gustdir_max_text", type: "string", name: "Direction of day max gust (text)", windText: ["day", "gustdir_max"] });
defs.push({ id: "day.winddir_max_text", type: "string", name: "Direction of day max wind (text)", windText: ["day", "winddir_max"] });

// ---------- forecast day0 .. day5 ----------
const FORECAST_DAYS = 6;
const forecast = [
	["code", "fc_code", "number", undefined, "Forecast code"],
	["icon", "fc_icon", "number", undefined, "Forecast icon code"],
	["text", "fc_text", "string", undefined, "Forecast text"],
	["temp_min", "fc_temp_min", "number", "°C", "Forecast min temperature"],
	["temp_max", "fc_temp_max", "number", "°C", "Forecast max temperature"],
	["rainsum", "fc_rainsum", "number", "mm", "Forecast precipitation"],
	["rain_possibility", "fc_rain_possibility", "number", "%", "Forecast rain probability"],
];
for (let d = 0; d < FORECAST_DAYS; d++) {
	for (const [key, apiKey, type, unit, name] of forecast) {
		add(
			`forecast.day${d}.${key}`,
			["forecast", `day${d}`, /** @type {string} */ (apiKey)],
			/** @type {ioBroker.CommonType} */ (type),
			unit,
			`${name} (day ${d})`,
		);
	}
}

// ---------- station data (https://api.awekas.at/station.php, fetched once a day) ----------
/** @type {[string, string[], ioBroker.CommonType, string|undefined, string][]} */
const station = [
	["station.id", ["station", "id"], "number", undefined, "AWEKAS station id"],
	["station.location", ["station", "location"], "string", undefined, "Location"],
	["station.country", ["station", "country_iso"], "string", undefined, "Country (ISO)"],
	["station.longitude", ["station", "londec"], "number", "°", "Longitude"],
	["station.latitude", ["station", "latdec"], "number", "°", "Latitude"],
	["station.elevation", ["station", "elevation"], "number", "m", "Elevation"],
	["station.software", ["station", "software"], "string", undefined, "Weather station software"],
	["station.hardware", ["station", "hardware"], "string", undefined, "Weather station hardware"],
	["station.timezone", ["station", "timezone"], "string", undefined, "Time zone"],
	["station.awekasplus", ["station", "AWEKASplus"], "boolean", undefined, "AWEKAS Plus active"],
	["station.stationsweb_enabled", ["stationsweb", "enabled"], "boolean", undefined, "Stationsweb active (required for forecast)"],
	["station.stationsweb_period", ["stationsweb", "period"], "string", undefined, "Stationsweb subscription valid until"],
];
for (const [id, path, type, unit, name] of station) {
	defs.push({ id, path, type, unit, name, endpoint: "station" });
}

// value lists from the API description (tables 4 and 5)
const STATES = {
	"current.condition": {
		0: "no report", 1: "clear", 2: "sunny sky", 3: "partly cloudy", 4: "cloudy", 5: "heavy cloudy",
		6: "overcast sky", 7: "fog", 8: "rain showers", 9: "heavy rain showers", 10: "light rain", 11: "rain",
		12: "heavy rain", 13: "light snow", 14: "snow", 15: "light snow showers", 16: "snow showers", 17: "sleet",
		18: "hail", 19: "thunderstorm", 20: "storm", 21: "freezing rain", 23: "drizzle", 24: "heavy snow",
		25: "heavy snow showers", 31: "storm > 8 Bft warning", 32: "heavy rain warning", 33: "heavy fog warning",
		34: "extreme heat >35°C warning", 35: "extreme cold <-20°C warning", 36: "glaze warning",
		37: "heavy snowfall warning", 38: "snowdrift warning", 39: "squalls warning",
		40: "hurricane/tornado > 11 Bft warning", 41: "constant rain warning", 42: "flooding warning",
		43: "sleet warning", 44: "hail warning",
	},
	"current.tendency": { "-2": "high falling", "-1": "falling", 0: "steady", 1: "rising", 2: "high rising" },
};
for (const def of defs) {
	if (STATES[def.id]) def.states = STATES[def.id];
	if (!def.endpoint) def.endpoint = "current";
}

// specific roles (https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/stateroles.md)
const SPECIFIC_ROLES = {
	"current.dewpoint": "value.temperature.dewpoint",
	"current.windchill": "value.temperature.windchill",
	"station.longitude": "value.gps.longitude",
	"station.latitude": "value.gps.latitude",
	"station.elevation": "value.gps.elevation",
	"station.location": "location",
	"current.winddirection_text": "weather.direction.wind",
	"day.gustdir_max_text": "weather.direction.wind",
	"day.winddir_max_text": "weather.direction.wind",
	"day.temp_min": "value.temperature.min",
	"day.temp_max": "value.temperature.max",
	"day.hum_min": "value.humidity.min",
	"day.hum_max": "value.humidity.max",
	"day.precipitation_24h": "value.precipitation.day",
};
const FORECAST_ROLES = {
		text: "weather.title.forecast",
	temp_min: "value.temperature.min.forecast",
	temp_max: "value.temperature.max.forecast",
	rainsum: "value.precipitation.forecast",
	rain_possibility: "value.precipitation.chance.forecast",
};
for (const def of defs) {
	if (SPECIFIC_ROLES[def.id]) def.role = SPECIFIC_ROLES[def.id];
	const fc = def.id.match(/^forecast\.day(\d)\.(\w+)$/);
	if (fc && FORECAST_ROLES[fc[2]]) def.role = `${FORECAST_ROLES[fc[2]]}.${fc[1]}`;
	// unix timestamps (seconds in the API) are converted to milliseconds -> value.time
	if (/(_ts|timestamp|^info\.fetchdate)$/.test(def.id)) {
		def.role = "value.time";
		def.timestamp = true;
	}
}

// derive remaining roles
for (const def of defs) {
	if (def.role) continue;
	if (def.windText || def.type === "string") def.role = "text";
	else if (def.type === "boolean") def.role = "indicator";
	else if (def.unit && UNIT_ROLES[def.unit]) def.role = UNIT_ROLES[def.unit];
	else def.role = "value";
}

/** channels that are created before the states */
const channels = {
	info: "Information",
	current: "Current values",
	day: "Daily values",
	station: "Station",
	forecast: "Forecast",
};
for (let d = 0; d < FORECAST_DAYS; d++) {
	channels[`forecast.day${d}`] = `Forecast day ${d}`;
}

module.exports = { defs, channels };
