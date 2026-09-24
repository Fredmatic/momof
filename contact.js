// Contact page: shows the salon on a map and, if the visitor allows it,
// how far away they are (updating live as they travel).
(function () {

    // ============================================================
    //  EDIT THIS: the salon's exact position.
    //  In Google Maps, right-click the salon's pin, then click the two
    //  numbers at the top of the menu (they copy). Paste them below.
    //  For now this is just the centre of Kampala.
    // ============================================================
    const SALON = {
        name: "MOMO's PALOR",
        lat: 0.3136,
        lng: 32.5811
    };

    const ARRIVED_METERS = 50;   // closer than this = "You've arrived"
    const VAGUE_METERS = 1500;   // GPS less accurate than this = show a warning

    const mapElement = document.getElementById("map");
    if (!mapElement) return; // this script was loaded on a page without a map

    const locateButton = document.getElementById("locateBtn");
    const directionsButton = document.getElementById("directionsBtn");
    const distanceMain = document.getElementById("distanceMain");
    const distanceNote = document.getElementById("distanceNote");

    const START_LABEL = '<i class="fas fa-location-crosshairs"></i> Show my distance';
    const STOP_LABEL = '<i class="fas fa-stop"></i> Stop tracking';
    const INTRO_TEXT = 'Tap "Show my distance" to see how far you are from us.';

    // Google Maps opens with the visitor's current position as the start,
    // and gives real road distance, time and traffic.
    directionsButton.href =
        "https://www.google.com/maps/dir/?api=1&destination=" +
        SALON.lat + "," + SALON.lng + "&travelmode=driving";

    // ---------- The map (Leaflet + OpenStreetMap) ----------
    let map = null;
    let youMarker = null;
    let routeLine = null;

    if (typeof L !== "undefined") {
        L.Icon.Default.imagePath = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/";

        map = L.map(mapElement, { scrollWheelZoom: false })
            .setView([SALON.lat, SALON.lng], 15);

        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors"
        }).addTo(map);

        L.marker([SALON.lat, SALON.lng])
            .addTo(map)
            .bindPopup("<strong>" + SALON.name + "</strong>")
            .openPopup();
    } else {
        mapElement.textContent = "The map couldn't load. Use \"Get directions\" instead.";
    }

    function showOnMap(lat, lng) {
        if (!map) return;

        if (!youMarker) {
            youMarker = L.circleMarker([lat, lng], {
                radius: 9, color: "#ffffff", weight: 3,
                fillColor: "#2b7cff", fillOpacity: 1
            }).addTo(map).bindTooltip("You are here");

            routeLine = L.polyline([[lat, lng], [SALON.lat, SALON.lng]], {
                color: "#ffaf1f", dashArray: "6 8"
            }).addTo(map);

            // Zoom out to fit both points, but only once, so we never
            // fight the visitor if they pan or zoom the map themselves.
            map.fitBounds(L.latLngBounds([[lat, lng], [SALON.lat, SALON.lng]]), { padding: [40, 40] });
        } else {
            youMarker.setLatLng([lat, lng]);
            routeLine.setLatLngs([[lat, lng], [SALON.lat, SALON.lng]]);
        }
    }

    function clearYouFromMap() {
        if (youMarker) { youMarker.remove(); youMarker = null; }
        if (routeLine) { routeLine.remove(); routeLine = null; }
        if (map) map.setView([SALON.lat, SALON.lng], 15);
    }

    // ---------- Distance maths ----------
    // Haversine formula: straight-line distance between two GPS points
    // on a sphere. Returns metres.
    function distanceMeters(lat1, lng1, lat2, lng2) {
        const EARTH_RADIUS = 6371000; // metres
        const toRadians = degrees => degrees * Math.PI / 180;

        const dLat = toRadians(lat2 - lat1);
        const dLng = toRadians(lng2 - lng1);

        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLng / 2) ** 2;

        return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
    }

    function formatDistance(meters) {
        return meters < 1000
            ? Math.round(meters) + " m"
            : (meters / 1000).toFixed(1) + " km";
    }

    // ---------- Live tracking ----------
    let watchId = null;

    function onPosition(position) {
        const { latitude, longitude, accuracy } = position.coords;
        const meters = distanceMeters(latitude, longitude, SALON.lat, SALON.lng);

        if (meters <= ARRIVED_METERS) {
            distanceMain.textContent = "You've arrived at " + SALON.name + "!";
            distanceNote.textContent = "";
        } else {
            distanceMain.textContent = formatDistance(meters) + " away";
            distanceNote.textContent = accuracy > VAGUE_METERS
                ? "Your location is only approximate (about " + formatDistance(accuracy) + "), so this may be off."
                : 'Straight-line distance. Tap "Get directions" for the road route.';
        }

        showOnMap(latitude, longitude);
    }

    function onError(error) {
        stopTracking();

        // error.code: 1 = permission denied, 2 = unavailable, 3 = timed out
        if (error.code === 1) {
            distanceMain.textContent = "Location access is blocked.";
            distanceNote.textContent = 'Allow location for this site in your browser settings, or tap "Get directions".';
        } else if (error.code === 2) {
            distanceMain.textContent = "We couldn't work out where you are.";
            distanceNote.textContent = "Check that GPS or mobile data is on, then try again.";
        } else if (error.code === 3) {
            distanceMain.textContent = "Finding your location took too long.";
            distanceNote.textContent = "Please try again.";
        } else {
            distanceMain.textContent = "Something went wrong finding your location.";
            distanceNote.textContent = "";
        }
    }

    function startTracking() {
        if (!("geolocation" in navigator)) {
            distanceMain.textContent = "Your browser can't share its location.";
            distanceNote.textContent = 'Tap "Get directions" instead.';
            return;
        }

        distanceMain.textContent = "Finding your location...";
        distanceNote.textContent = "Your browser will ask for permission.";
        locateButton.innerHTML = STOP_LABEL;

        // watchPosition calls onPosition now AND again whenever the visitor moves.
        watchId = navigator.geolocation.watchPosition(onPosition, onError, {
            enableHighAccuracy: true, // use GPS on phones
            maximumAge: 5000,         // accept a position up to 5 s old
            timeout: 20000            // give up waiting after 20 s
        });
    }

    function stopTracking() {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        locateButton.innerHTML = START_LABEL;
        clearYouFromMap();
    }

    locateButton.addEventListener("click", function () {
        if (watchId === null) {
            startTracking();
        } else {
            stopTracking();
            distanceMain.textContent = INTRO_TEXT;
            distanceNote.textContent = "";
        }
    });

})();