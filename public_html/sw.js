// dump1090 offline service worker
// ---------------------------------
// Two jobs:
//   1. Pre-cache the application shell (HTML/CSS/JS/images) on install so the
//      page itself loads with no network.
//   2. Cache OpenStreetMap map tiles as they are fetched while online, so any
//      area you have already browsed keeps rendering when the host is offline.
//
// Live aircraft data (/data.json) is always fetched from the network and never
// cached, so the plane list is real-time whenever a connection exists.

var SHELL_CACHE = 'dump1090-shell-v1';
var TILE_CACHE  = 'dump1090-tiles-v1';

// Same-origin assets that make up the application shell. Served by dump1090's
// own HTTP server, so these paths are relative to the service worker scope.
var APP_SHELL = [
	'./',
	'gmap.html',
	'config.js',
	'script.js',
	'planeObject.js',
	'options.js',
	'extension.js',
	'style.css',
	'lib/leaflet.js',
	'lib/leaflet.css',
	'lib/jquery.js',
	'lib/jquery-ui.js',
	'lib/jquery-ui.css',
	'lib/images/layers.png',
	'lib/images/layers-2x.png',
	'lib/images/marker-icon.png',
	'lib/images/marker-icon-2x.png',
	'lib/images/marker-shadow.png',
	'coolclock/excanvas.js',
	'coolclock/coolclock.js',
	'coolclock/moreskins.js'
];

function isTileRequest(url) {
	return /\.tile\.openstreetmap\.org\//.test(url) ||
	       /tile\.openstreetmap\.org\//.test(url);
}

self.addEventListener('install', function(event) {
	event.waitUntil(
		caches.open(SHELL_CACHE).then(function(cache) {
			// Cache each shell file individually so one missing/optional file
			// (e.g. an excanvas shim) does not abort the whole install.
			return Promise.all(APP_SHELL.map(function(url) {
				return cache.add(url).catch(function(err) {
					console.log('SW: could not cache ' + url, err);
				});
			}));
		}).then(function() {
			return self.skipWaiting();
		})
	);
});

self.addEventListener('activate', function(event) {
	event.waitUntil(
		caches.keys().then(function(keys) {
			return Promise.all(keys.map(function(key) {
				if (key !== SHELL_CACHE && key !== TILE_CACHE) {
					return caches.delete(key);
				}
			}));
		}).then(function() {
			return self.clients.claim();
		})
	);
});

self.addEventListener('fetch', function(event) {
	var req = event.request;

	// Only handle GETs; let everything else hit the network untouched.
	if (req.method !== 'GET') {
		return;
	}

	// Map tiles: serve from cache first; on a miss fetch from the network and
	// store a copy for offline use. This is the "cache while you browse" path.
	if (isTileRequest(req.url)) {
		event.respondWith(
			caches.open(TILE_CACHE).then(function(cache) {
				return cache.match(req).then(function(cached) {
					if (cached) {
						return cached;
					}
					return fetch(req).then(function(resp) {
						// Tiles are cross-origin (opaque) responses; cache them as-is.
						if (resp && (resp.status === 200 || resp.type === 'opaque')) {
							cache.put(req, resp.clone());
						}
						return resp;
					}).catch(function() {
						// Offline and not cached: let the tile fail (blank square).
						return cached;
					});
				});
			})
		);
		return;
	}

	// Never cache the live aircraft feed.
	if (/\/data\.json/.test(req.url)) {
		return;
	}

	// Application shell (same origin): cache-first, falling back to the network
	// and refreshing the cache when reachable.
	var url = new URL(req.url);
	if (url.origin === self.location.origin) {
		event.respondWith(
			caches.match(req).then(function(cached) {
				var network = fetch(req).then(function(resp) {
					if (resp && resp.status === 200) {
						var copy = resp.clone();
						caches.open(SHELL_CACHE).then(function(cache) {
							cache.put(req, copy);
						});
					}
					return resp;
				}).catch(function() {
					return cached;
				});
				return cached || network;
			})
		);
	}
});
