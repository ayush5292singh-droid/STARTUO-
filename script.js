/* =========================================================
   NEXORA MAP
   Real OpenStreetMap + Overpass powered discovery
   ========================================================= */


/* -----------------------------
   APP STATE
----------------------------- */

const state = {
  map: null,

  userLocation: null,
  userMarker: null,
  accuracyCircle: null,

  markers: [],
  places: [],

  selectedPlace: null,

  favourites: JSON.parse(
    localStorage.getItem("nexora_favourites") || "[]"
  ),

  activeCategory: "all",

  currentLayer: null,

  searchController: null
};


/* -----------------------------
   ELEMENTS
----------------------------- */

const $ = id => document.getElementById(id);

const searchInput = $("searchInput");
const searchBtn = $("searchBtn");
const clearSearch = $("clearSearch");

const exploreBtn = $("exploreBtn");
const whatsHereBtn = $("whatsHereBtn");
const intelligenceBtn = $("intelligenceBtn");
const layersBtn = $("layersBtn");

const locateBtn = $("locateBtn");

const status = $("status");
const statusText = $("statusText");

const resultsPanel = $("resultsPanel");
const resultsList = $("resultsList");
const resultsTitle = $("resultsTitle");

const placeModal = $("placeModal");
const intelligenceModal = $("intelligenceModal");
const layersModal = $("layersModal");

const toast = $("toast");


/* -----------------------------
   MAP
----------------------------- */

function initMap() {

  state.map = L.map("map", {
    zoomControl: false
  }).setView([26.8467, 80.9462], 13);

  state.currentLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
    }
  ).addTo(state.map);

  L.control.zoom({
    position: "bottomright"
  }).addTo(state.map);

  state.map.on("moveend", () => {
    /*
      We intentionally don't automatically query every map movement.
      This keeps the app faster and avoids excessive requests.
    */
  });
}


/* -----------------------------
   STATUS
----------------------------- */

function showStatus(message) {

  statusText.textContent = message;
  status.classList.remove("hidden");
}

function hideStatus() {
  status.classList.add("hidden");
}


/* -----------------------------
   TOAST
----------------------------- */

let toastTimer;

function showToast(message) {

  toast.textContent = message;

  toast.classList.remove("hidden");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 2600);
}


/* -----------------------------
   LOCATION
----------------------------- */

function locateUser() {

  if (!navigator.geolocation) {
    showToast("Location is not supported on this device.");
    return;
  }

  showStatus("Finding your location...");

  navigator.geolocation.getCurrentPosition(

    position => {

      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const accuracy = position.coords.accuracy;

      state.userLocation = {
        lat,
        lng
      };

      if (state.userMarker) {
        state.map.removeLayer(state.userMarker);
      }

      if (state.accuracyCircle) {
        state.map.removeLayer(state.accuracyCircle);
      }

      state.userMarker = L.marker([lat, lng])
        .addTo(state.map)
        .bindPopup("📍 You are here");

      state.accuracyCircle = L.circle(
        [lat, lng],
        {
          radius: accuracy,
          color: "#31e981",
          fillOpacity: 0.08
        }
      ).addTo(state.map);

      state.map.setView([lat, lng], 15);

      hideStatus();

      showToast("Location found.");
    },

    error => {

      hideStatus();

      if (error.code === 1) {
        showToast("Please allow location permission.");
      } else {
        showToast("Couldn't find your location.");
      }
    },

    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    }
  );
}


/* -----------------------------
   CATEGORY TAGS
----------------------------- */

const CATEGORY_TAGS = {

  all: `
    node["name"](${bbox});
    way["name"](${bbox});
    relation["name"](${bbox});
  `,

  food: `
    node["amenity"~"restaurant|fast_food|cafe|food_court"](${bbox});
    way["amenity"~"restaurant|fast_food|cafe|food_court"](${bbox});
  `,

  shopping: `
    node["shop"](${bbox});
    way["shop"](${bbox});
  `,

  health: `
    node["amenity"~"hospital|clinic|pharmacy|doctors|dentist"](${bbox});
    way["amenity"~"hospital|clinic|pharmacy|doctors|dentist"](${bbox});
  `,

  education: `
    node["amenity"~"school|college|university|kindergarten"](${bbox});
    way["amenity"~"school|college|university|kindergarten"](${bbox});
  `,

  fuel: `
    node["amenity"="fuel"](${bbox});
    way["amenity"="fuel"](${bbox});
  `,

  hotel: `
    node["tourism"~"hotel|hostel|guest_house|motel"](${bbox});
    way["tourism"~"hotel|hostel|guest_house|motel"](${bbox});
  `,

  services: `
    node["craft"](${bbox});
    way["craft"](${bbox});
    node["amenity"~"bank|post_office|police|fire_station"](${bbox});
    way["amenity"~"bank|post_office|police|fire_station"](${bbox});
  `
};


/* -----------------------------
   SEARCH ALIASES
----------------------------- */

const SEARCH_ALIASES = {

  restaurant: "food",
  restaurants: "food",
  food: "food",
  cafe: "food",
  cafes: "food",

  shop: "shopping",
  shops: "shopping",
  shopping: "shopping",

  hospital: "health",
  hospitals: "health",
  pharmacy: "health",
  pharmacies: "health",
  doctor: "health",
  doctors: "health",
  clinic: "health",
  clinics: "health",

  school: "education",
  schools: "education",
  college: "education",
  university: "education",

  petrol: "fuel",
  petrolpump: "fuel",
  petrolpump: "fuel",
  fuel: "fuel",
  "fuel station": "fuel",

  hotel: "hotel",
  hotels: "hotel",
  hostel: "hotel",

  plumber: "services",
  electrician: "services",
  carpenter: "services",
  mechanic: "services",
  locksmith: "services",
  services: "services"
};


/* -----------------------------
   BOUNDING BOX
----------------------------- */

function getBoundingBox() {

  const bounds = state.map.getBounds();

  return [
    bounds.getSouth(),
    bounds.getWest(),
    bounds.getNorth(),
    bounds.getEast()
  ];
}


/* -----------------------------
   OVERPASS QUERY
----------------------------- */

async function queryOverpass(category = "all") {

  const [
    south,
    west,
    north,
    east
  ] = getBoundingBox();

  const bboxString =
    `${south},${west},${north},${east}`;

  let query;

  if (category === "all") {

    query = `
      [out:json][timeout:20];

      (
        node["name"](${bboxString});
        way["name"](${bboxString});
      );

      out center tags;
    `;

  } else {

    let tags = CATEGORY_TAGS[category];

    if (!tags) {
      tags = CATEGORY_TAGS.all;
    }

    tags = tags.replaceAll("${bbox}", bboxString);

    query = `
      [out:json][timeout:20];

      (
        ${tags}
      );

      out center tags;
    `;
  }

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ];

  let lastError;

  for (const endpoint of endpoints) {

    try {

      const controller =
        new AbortController();

      state.searchController = controller;

      const timeout =
        setTimeout(
          () => controller.abort(),
          25000
        );

      const response = await fetch(
        endpoint,
        {
          method: "POST",
          body: query,
          signal: controller.signal
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(
          `Server error ${response.status}`
        );
      }

      return await response.json();

    } catch (error) {

      lastError = error;
    }
  }

  throw lastError || new Error("Search failed");
}


/* -----------------------------
   NORMALIZE DATA
----------------------------- */

function normalizePlaces(data) {

  const results = [];

  const seen = new Set();

  for (const item of data.elements || []) {

    const tags = item.tags || {};

    const name =
      tags.name ||
      tags["name:en"];

    if (!name) continue;

    const lat =
      item.lat ??
      item.center?.lat;

    const lng =
      item.lon ??
      item.center?.lon;

    if (
      typeof lat !== "number" ||
      typeof lng !== "number"
    ) {
      continue;
    }

    const unique =
      `${name.toLowerCase()}-${lat.toFixed(5)}-${lng.toFixed(5)}`;

    if (seen.has(unique)) continue;

    seen.add(unique);

    results.push({
      id:
        item.type +
        "-" +
        item.id,

      name,

      lat,
      lng,

      tags,

      category:
        detectCategory(tags),

      address:
        buildAddress(tags),

      phone:
        tags.phone ||
        tags["contact:phone"] ||
        "",

      website:
        tags.website ||
        tags["contact:website"] ||
        "",

      opening:
        tags.opening_hours ||
        "",

      rating:
        tags.stars ||
        "",

      distance:
        getDistanceFromUser(lat, lng)
    });
  }

  results.sort(
    (a, b) =>
      (a.distance ?? Infinity) -
      (b.distance ?? Infinity)
  );

  return results.slice(0, 150);
}


/* -----------------------------
   CATEGORY DETECTION
----------------------------- */

function detectCategory(tags) {

  if (
    tags.amenity === "restaurant" ||
    tags.amenity === "fast_food" ||
    tags.amenity === "cafe"
  ) {
    return "Food";
  }

  if (tags.shop) {
    return "Shopping";
  }

  if (
    [
      "hospital",
      "clinic",
      "pharmacy",
      "doctors",
      "dentist"
    ].includes(tags.amenity)
  ) {
    return "Health";
  }

  if (
    [
      "school",
      "college",
      "university",
      "kindergarten"
    ].includes(tags.amenity)
  ) {
    return "Education";
  }

  if (tags.amenity === "fuel") {
    return "Fuel";
  }

  if (
    [
      "hotel",
      "hostel",
      "guest_house",
      "motel"
    ].includes(tags.tourism)
  ) {
    return "Hotel";
  }

  if (tags.craft) {
    return "Service";
  }

  return "Place";
}


/* -----------------------------
   ADDRESS
----------------------------- */

function buildAddress(tags) {

  const parts = [];

  if (tags["addr:housenumber"]) {
    parts.push(tags["addr:housenumber"]);
  }

  if (tags["addr:street"]) {
    parts.push(tags["addr:street"]);
  }

  if (tags["addr:suburb"]) {
    parts.push(tags["addr:suburb"]);
  }

  if (tags["addr:city"]) {
    parts.push(tags["addr:city"]);
  }

  if (tags["addr:postcode"]) {
    parts.push(tags["addr:postcode"]);
  }

  return parts.join(", ");
}


/* -----------------------------
   DISTANCE
----------------------------- */

function getDistanceFromUser(lat, lng) {

  if (!state.userLocation) {
    return null;
  }

  const R = 6371;

  const dLat =
    toRadians(
      lat -
      state.userLocation.lat
    );

  const dLng =
    toRadians(
      lng -
      state.userLocation.lng
    );

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(
      toRadians(state.userLocation.lat)
    ) *
    Math.cos(toRadians(lat)) *
    Math.sin(dLng / 2) ** 2;

  const c =
    2 * Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function formatDistance(distance) {

  if (distance == null) {
    return "";
  }

  if (distance < 1) {
    return `${Math.round(distance * 1000)} m away`;
  }

  return `${distance.toFixed(1)} km away`;
}


/* -----------------------------
   ICONS
----------------------------- */

function getIcon(place) {

  const category =
    place.category.toLowerCase();

  if (category.includes("food")) return "🍔";
  if (category.includes("shopping")) return "🛍️";
  if (category.includes("health")) return "🏥";
  if (category.includes("education")) return "🎓";
  if (category.includes("fuel")) return "⛽";
  if (category.includes("hotel")) return "🏨";
  if (category.includes("service")) return "🔧";

  return "📍";
}


/* -----------------------------
   MARKERS
----------------------------- */

function clearMarkers() {

  state.markers.forEach(
    marker => state.map.removeLayer(marker)
  );

  state.markers = [];
}


function displayMarkers(places) {

  clearMarkers();

  places.forEach(place => {

    const marker =
      L.marker([
        place.lat,
        place.lng
      ]).addTo(state.map);

    marker.bindTooltip(
      place.name,
      {
        direction: "top",
        offset: [0, -10]
      }
    );

    marker.on(
      "click",
      () => openPlace(place)
    );

    state.markers.push(marker);
  });
}


/* -----------------------------
   SEARCH / DISCOVERY
----------------------------- */

async function discover(
  category = state.activeCategory,
  title = "Nearby Places"
) {

  try {

    showStatus("Finding real places...");

    const data =
      await queryOverpass(category);

    const places =
      normalizePlaces(data);

    state.places = places;

    displayMarkers(places);

    renderResults(places, title);

    hideStatus();

    if (!places.length) {
      showToast(
        "No mapped places found in this area."
      );
    }

  } catch (error) {

    console.error(error);

    hideStatus();

    showToast(
      "Search server is busy. Try again."
    );
  }
}


/* -----------------------------
   TEXT SEARCH
----------------------------- */

async function performSearch() {

  const query =
    searchInput.value.trim();

  if (!query) {
    showToast("Type something to search.");
    return;
  }

  const lower =
    query.toLowerCase();

  if (SEARCH_ALIASES[lower]) {

    state.activeCategory =
      SEARCH_ALIASES[lower];

    await discover(
      state.activeCategory,
      `Nearby ${query}`
    );

    return;
  }

  try {

    showStatus(`Searching for "${query}"...`);

    /*
      First search the current visible map
      for a matching place name.
    */

    const data =
      await queryOverpass("all");

    let places =
      normalizePlaces(data);

    const terms =
      lower
        .split(/\s+/)
        .filter(Boolean);

    places =
      places.filter(place => {

        const text =
          [
            place.name,
            place.category,
            place.address,
            place.tags.shop,
            place.tags.amenity,
            place.tags.tourism,
            place.tags.craft
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        return terms.every(
          term => text.includes(term)
        );
      });

    state.places = places;

    displayMarkers(places);

    renderResults(
      places,
      `Search: ${query}`
    );

    hideStatus();

    if (!places.length) {

      showToast(
        "Nothing matching that search was found in the current map area."
      );
    }

  } catch (error) {

    console.error(error);

    hideStatus();

    showToast(
      "Search failed. Please try again."
    );
  }
}


/* -----------------------------
   RESULTS UI
----------------------------- */

function renderResults(
  places,
  title = "Nearby Places"
) {

  resultsTitle.textContent =
    `${title} (${places.length})`;

  resultsList.innerHTML = "";

  if (!places.length) {

    resultsList.innerHTML = `
      <div class="result-card">
        <div class="result-icon">🔎</div>
        <div class="result-info">
          <h3>No places found</h3>
          <p>Move the map and try Explore Here.</p>
        </div>
      </div>
    `;

    resultsPanel.classList.remove("hidden");

    return;
  }

  places.forEach(place => {

    const card =
      document.createElement("div");

    card.className = "result-card";

    card.innerHTML = `
      <div class="result-icon">
        ${getIcon(place)}
      </div>

      <div class="result-info">

        <h3>${escapeHtml(place.name)}</h3>

        <p>
          ${
            escapeHtml(
              place.address ||
              place.category ||
              "Address unavailable"
            )
          }
        </p>

        ${
          place.distance != null
            ? `<div class="result-distance">
                 ${formatDistance(place.distance)}
               </div>`
            : ""
        }

      </div>

      <button>›</button>
    `;

    card.addEventListener(
      "click",
      () => openPlace(place)
    );

    resultsList.appendChild(card);
  });

  resultsPanel.classList.remove("hidden");
}


/* -----------------------------
   PLACE MODAL
----------------------------- */

function openPlace(place) {

  state.selectedPlace = place;

  $("placeIcon").textContent =
    getIcon(place);

  $("placeType").textContent =
    place.category.toUpperCase();

  $("placeName").textContent =
    place.name;

  $("placeAddress").textContent =
    place.address ||
    "Address information unavailable.";

  const meta =
    $("placeMeta");

  meta.innerHTML = "";

  if (place.distance != null) {

    addMeta(
      meta,
      formatDistance(place.distance)
    );
  }

  if (place.opening) {

    addMeta(
      meta,
      `🕐 ${place.opening}`
    );
  }

  if (place.rating) {

    addMeta(
      meta,
      `⭐ ${place.rating}`
    );
  }

  $("callBtn").style.display =
    place.phone ? "block" : "none";

  $("websiteBtn").style.display =
    place.website ? "block" : "none";

  placeModal.classList.remove("hidden");

  state.map.setView(
    [place.lat, place.lng],
    Math.max(
      state.map.getZoom(),
      16
    ),
    {
      animate: true
    }
  );
}

function addMeta(container, text) {

  const chip =
    document.createElement("div");

  chip.className = "meta-chip";

  chip.textContent = text;

  container.appendChild(chip);
}


/* -----------------------------
   SAVE
----------------------------- */

function isSaved(place) {

  return state.favourites.some(
    item => item.id === place.id
  );
}

function saveSelectedPlace() {

  const place =
    state.selectedPlace;

  if (!place) return;

  if (isSaved(place)) {

    state.favourites =
      state.favourites.filter(
        item => item.id !== place.id
      );

    showToast("Removed from saved places.");

  } else {

    state.favourites.push(place);

    showToast("Place saved ❤️");
  }

  localStorage.setItem(
    "nexora_favourites",
    JSON.stringify(
      state.favourites
    )
  );
}


/* -----------------------------
   DIRECTIONS
----------------------------- */

function openDirections() {

  const place =
    state.selectedPlace;

  if (!place) return;

  const url =
    `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;

  window.open(
    url,
    "_blank",
    "noopener"
  );
}


/* -----------------------------
   CALL
----------------------------- */

function callSelectedPlace() {

  const place =
    state.selectedPlace;

  if (!place?.phone) return;

  window.location.href =
    `tel:${place.phone}`;
}


/* -----------------------------
   WEBSITE
----------------------------- */

function openWebsite() {

  const place =
    state.selectedPlace;

  if (!place?.website) return;

  let url =
    place.website.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  window.open(
    url,
    "_blank",
    "noopener"
  );
}


/* -----------------------------
   MAP INTELLIGENCE
----------------------------- */

function openIntelligence() {

  const places =
    state.places;

  const counts = {};

  places.forEach(place => {

    const category =
      place.category;

    counts[category] =
      (counts[category] || 0) + 1;
  });

  const stats =
    $("intelligenceStats");

  stats.innerHTML = "";

  const total =
    document.createElement("div");

  total.className = "stat";

  total.innerHTML = `
    <strong>${places.length}</strong>
    <span>Mapped places found</span>
  `;

  stats.appendChild(total);

  Object.entries(counts)
    .sort((a,b) => b[1] - a[1])
    .forEach(([category, count]) => {

      const box =
        document.createElement("div");

      box.className = "stat";

      box.innerHTML = `
        <strong>${count}</strong>
        <span>${escapeHtml(category)}</span>
      `;

      stats.appendChild(box);
    });

  intelligenceModal.classList.remove("hidden");
}


/* -----------------------------
   MAP LAYERS
----------------------------- */

const satelliteLayer =
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution:
        "Tiles &copy; Esri"
    }
  );


function setMapLayer(type) {

  if (state.currentLayer) {
    state.map.removeLayer(
      state.currentLayer
    );
  }

  if (type === "satellite") {

    state.currentLayer =
      satelliteLayer;

  } else {

    state.currentLayer =
      L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution:
            '&copy; OpenStreetMap contributors'
        }
      );
  }

  state.currentLayer.addTo(
    state.map
  );

  showToast(
    type === "satellite"
      ? "Satellite layer enabled."
      : "Standard map enabled."
  );

  layersModal.classList.add(
    "hidden"
  );
}


/* -----------------------------
   CATEGORY BUTTONS
----------------------------- */

document
  .querySelectorAll(".category")
  .forEach(button => {

    button.addEventListener(
      "click",
      async () => {

        document
          .querySelectorAll(".category")
          .forEach(btn =>
            btn.classList.remove("active")
          );

        button.classList.add("active");

        state.activeCategory =
          button.dataset.type;

        if (
          state.activeCategory === "all"
        ) {

          await discover(
            "all",
            "Everything Here"
          );

        } else {

          await discover(
            state.activeCategory,
            button.textContent.trim()
          );
        }
      }
    );
  });


/* -----------------------------
   EVENTS
----------------------------- */

searchBtn.addEventListener(
  "click",
  performSearch
);

searchInput.addEventListener(
  "keydown",
  event => {

    if (event.key === "Enter") {
      performSearch();
    }
  }
);

clearSearch.addEventListener(
  "click",
  () => {
    searchInput.value = "";
    $("suggestions").innerHTML = "";
  }
);

locateBtn.addEventListener(
  "click",
  locateUser
);

exploreBtn.addEventListener(
  "click",
  () =>
    discover(
      state.activeCategory,
      "Explore Here"
    )
);

whatsHereBtn.addEventListener(
  "click",
  () =>
    discover(
      "all",
      "What's Here"
    )
);

intelligenceBtn.addEventListener(
  "click",
  openIntelligence
);

layersBtn.addEventListener(
  "click",
  () =>
    layersModal.classList.remove(
      "hidden"
    )
);

$("closeResults").addEventListener(
  "click",
  () =>
    resultsPanel.classList.add(
      "hidden"
    )
);

$("closeModal").addEventListener(
  "click",
  () =>
    placeModal.classList.add(
      "hidden"
    )
);

$("closeIntelligence").addEventListener(
  "click",
  () =>
    intelligenceModal.classList.add(
      "hidden"
    )
);

$("closeLayers").addEventListener(
  "click",
  () =>
    layersModal.classList.add(
      "hidden"
    )
);

$("saveBtn").addEventListener(
  "click",
  saveSelectedPlace
);

$("directionBtn").addEventListener(
  "click",
  openDirections
);

$("callBtn").addEventListener(
  "click",
  callSelectedPlace
);

$("websiteBtn").addEventListener(
  "click",
  openWebsite
);

document
  .querySelectorAll(
    ".layer-options button"
  )
  .forEach(button => {

    button.addEventListener(
      "click",
      () =>
        setMapLayer(
          button.dataset.layer
        )
    );
  });


/* -----------------------------
   SUGGESTIONS
----------------------------- */

searchInput.addEventListener(
  "input",
  () => {

    const value =
      searchInput.value
        .trim()
        .toLowerCase();

    const box =
      $("suggestions");

    box.innerHTML = "";

    if (!value) return;

    const suggestions = [
      "restaurants",
      "shops",
      "hospitals",
      "pharmacies",
      "schools",
      "petrol pumps",
      "hotels",
      "plumbers",
      "electricians",
      "mechanics"
    ]
      .filter(item =>
        item.includes(value)
      )
      .slice(0, 5);

    suggestions.forEach(item => {

      const div =
        document.createElement("div");

      div.className =
        "suggestion";

      div.textContent =
        `🔎 ${item}`;

      div.addEventListener(
        "click",
        () => {

          searchInput.value =
            item;

          box.innerHTML = "";

          performSearch();
        }
      );

      box.appendChild(div);
    });
  }
);


/* -----------------------------
   ESCAPE HTML
----------------------------- */

function escapeHtml(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* -----------------------------
   START
----------------------------- */

initMap();

setTimeout(() => {

  showToast(
    "Welcome to NEXORA MAP 🚀"
  );

}, 900);
