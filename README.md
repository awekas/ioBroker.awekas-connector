![Logo](admin/awekas-weather-connector.png)

# ioBroker.awekas-connector


[![NPM](https://nodei.co/npm/iobroker.awekas-connector.png?downloads=true)](https://nodei.co/npm/iobroker.awekas-connector/)

**Tests:** ![Test and Release](https://github.com/awekas/ioBroker.awekas-connector/workflows/Test%20and%20Release/badge.svg)

## awekas-connector adapter for ioBroker

fetch weather data from your AWEKAS weather station

This adapter is developed and maintained by AWEKAS GmbH, the operator of the AWEKAS weather network ([www.awekas.at](https://www.awekas.at)).
It reads the data of your own weather station from the AWEKAS Stations API.

### Requirements

- ioBroker js-controller 6.0.11 or newer, Admin 7.6.17 or newer, Node.js 22 or newer (automated tests run on 22, 24 and 26)
- a weather station registered at AWEKAS with active **AWEKAS Plus** (required for the Stations API)

### Configuration

| Setting | Description |
|---|---|
| AWEKAS API key | Your personal API key from https://my.awekas.at. It is stored encrypted and never written to the log. |
| Request interval | Seconds between two requests. Minimum 60 s, default 60 s. |
| Language | Language for forecast text and wind direction. Default: ioBroker system language (de, en, es, it, fr, nl, pl; otherwise English). |

### States

| Channel | Content |
|---|---|
| `info` | `connection` (API reachable), `error` (last API error), `fetchdate` |
| `current` | current measurements (temperature, humidity, pressure, wind, rain, solar, extra sensors, air quality, ...) |
| `day` | daily minimum/maximum values and their timestamps |
| `forecast.day0` … `forecast.day5` | forecast for today and the next five days (only with active AWEKAS Stationsweb subscription) |
| `station` | station data (location, position, hardware, software, AWEKAS Plus / Stationsweb status), refreshed once a day |

Values that your station does not measure stay empty (`null`). Timestamps are stored in milliseconds (role `value.time`).

### Fair use of the AWEKAS API

The AWEKAS Stations API allows 240 requests per hour and 2 requests per second. The adapter stays well below these limits and protects the AWEKAS servers:

- never more than one request at a time and never more often than every 60 seconds
- random start delay and ±10 % jitter so that many installations do not query at the same moment
- on connection or server errors the interval is increased step by step (5, 10, 20, 40, max. 60 min)
- if the quota is exceeded the adapter waits 15 minutes; a `Retry-After` header is respected
- with an invalid key or inactive AWEKAS Plus the adapter stops querying until the settings are changed

## Changelog

<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->
### 0.2.0 (2026-11-22)

- (awekas) requires js-controller >= 6.0.11, admin >= 7.6.17 and Node.js >= 22
- (awekas) development tooling updated (shared ioBroker ESLint config, release-script 5, testing 6), tests now also on Node.js 26

### 0.1.1 (2026-11-22)

- (awekas) translations of the settings page for Portuguese, Russian, Ukrainian and Chinese
- (awekas) releases are now published via npm trusted publishing (no npm token)

### 0.1.0 (2026-11-22)

- (awekas) complete rework: the adapter now starts correctly (adapter name matched io-package.json)
- (awekas) removed axios (was not declared as dependency) - uses built-in fetch, no runtime dependency besides adapter-core
- (awekas) API key stored encrypted, never logged - **please re-enter your API key in the adapter settings after the update**
- (awekas) configurable interval (min. 60 s), language selection
- (awekas) load protection for the AWEKAS API: jitter, back-off, Retry-After, stop on permanent errors
- (awekas) missing values no longer abort the update of all following states
- (awekas) states structured in channels `info`, `current`, `day`, `forecast.dayN`, `station` with proper roles
- (awekas) new: station data from station.php (once a day), value lists for condition and pressure tendency, Polish language
- (awekas) requires js-controller >= 5.0.19, admin >= 6.17.14, Node.js >= 20

### 0.0.4 (2.9.2023)

- change adapter name
- changed to async object write
- changed main structure

Older changes: [CHANGELOG_OLD.md](CHANGELOG_OLD.md)

## License

MIT License

Copyright (c) 2023-2026 AWEKAS GmbH <mail@awekas.at> https://www.awekas.at

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
