// ----- Map Configuration -----
const OVERPASS_API = 'https://overpass-api.de/api/interpreter';
const OSRM_ROUTE = 'https://router.project-osrm.org/route/v1/driving';

// Wait for the page to load before initializing the map
document.addEventListener('DOMContentLoaded', function() {
    // ----- Map setup -----
    const map = L.map('map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
     
    // Icons
    const icons = {
        hospital: L.icon({ 
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-red.png', 
            iconSize: [25,41], 
            iconAnchor: [12,41], 
            popupAnchor: [1,-34] 
        }),
        police: L.icon({ 
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-blue.png', 
            iconSize: [25,41], 
            iconAnchor: [12,41], 
            popupAnchor: [1,-34] 
        }),
        fire: L.icon({ 
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-orange.png', 
            iconSize: [25,41], 
            iconAnchor: [12,41], 
            popupAnchor: [1,-34] 
        }),
        shelter: L.icon({ 
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-green.png', 
            iconSize: [25,41], 
            iconAnchor: [12,41], 
            popupAnchor: [1,-34] 
        }),
        me: L.icon({ 
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-violet.png', 
            iconSize: [25,41], 
            iconAnchor: [12,41], 
            popupAnchor: [1,-34] 
        })
    };

    let meMarker = null;
    let placeMarkers = L.layerGroup().addTo(map);
    let routeLayer = null;

    const statusEl = document.getElementById('status');
    const resultsEl = document.getElementById('results');

    function setStatus(txt){ statusEl.textContent = 'Status: ' + txt }

    // Utility: Haversine formula
    function haversine(lat1, lon1, lat2, lon2){
        function toRad(x){ return x * Math.PI / 180; }
        const R = 6371000; // meters
        const dLat = toRad(lat2-lat1);
        const dLon = toRad(lon2-lon1);
        const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // Geolocation
    function startWatch(){
        if(!navigator.geolocation){ setStatus('Geolocation not supported'); return; }
        navigator.geolocation.watchPosition(pos => {
            const lat = pos.coords.latitude; 
            const lon = pos.coords.longitude;
            setStatus(`located at ${lat.toFixed(6)}, ${lon.toFixed(6)} (accuracy ${pos.coords.accuracy}m)`);
            if(!meMarker){ 
                meMarker = L.marker([lat,lon], {icon: icons.me}).addTo(map).bindPopup('You are here'); 
            } else { 
                meMarker.setLatLng([lat,lon]); 
            }
        }, err => { setStatus('Geo error: ' + err.message) }, { enableHighAccuracy:true, maximumAge: 3000 });
    }

    // Overpass query
    function buildOverpassQuery(lat, lon, radius){
        const tags = [
            'node(around:'+radius+','+lat+','+lon+')[amenity=hospital];',
            'node(around:'+radius+','+lat+','+lon+')[amenity=police];',
            'node(around:'+radius+','+lat+','+lon+')[amenity=fire_station];',
            'node(around:'+radius+','+lat+','+lon+')[emergency=shelter];',
            'node(around:'+radius+','+lat+','+lon+')[amenity=shelter];',
        ];
        return '[out:json][timeout:25];(' + tags.join('') + ');out center;';
    }

    async function fetchNearby(lat, lon, radius){
        setStatus('Searching nearby...');
        try{
            const q = buildOverpassQuery(lat, lon, radius);
            const url = OVERPASS_API + '?data=' + encodeURIComponent(q);
            const res = await fetch(url);
            if(!res.ok) throw new Error('Overpass error ' + res.status);
            const data = await res.json();
            return data.elements || [];
        }catch(e){ setStatus('Overpass failed: ' + e.message); return [] }
    }

    function classify(elem){
        const tags = elem.tags || {};
        if(tags.amenity === 'hospital') return 'hospital';
        if(tags.amenity === 'police') return 'police';
        if(tags.amenity === 'fire_station') return 'fire';
        if(tags.emergency === 'shelter' || tags.amenity === 'shelter') return 'shelter';
        return 'unknown';
    }

    function clearPlaces(){ placeMarkers.clearLayers(); resultsEl.innerHTML = ''; }

    function addPlaceToList(place, myLat, myLon){
        const div = document.createElement('div');
        div.className = 'result-item';
        const type = place.type;
        const name = (place.tags && (place.tags.name || place.tags['amenity'])) || 'Unnamed';
        const lat = place.lat; 
        const lon = place.lon;
        const dist = haversine(myLat,myLon,lat,lon);
        div.innerHTML = `<span class="type-badge">${type}</span><strong>${name}</strong><div class="small">${dist.toFixed(0)} m — ${lat.toFixed(5)}, ${lon.toFixed(5)}</div>`;
        div.addEventListener('click', ()=>{ map.setView([lat,lon], 16); routeTo(lat,lon); });
        resultsEl.appendChild(div);
    }

    async function routeTo(destLat, destLon){
        if(!meMarker) { setStatus('Current location unknown — allow location and try again'); return; }
        const from = meMarker.getLatLng();
        const url = `${OSRM_ROUTE}/${from.lng},${from.lat};${destLon},${destLat}?overview=full&geometries=geojson&steps=false`;
        setStatus('Requesting route...');
        try{
            const res = await fetch(url);
            if(!res.ok) throw new Error('Routing error ' + res.status);
            const j = await res.json();
            if(routeLayer) map.removeLayer(routeLayer);
            if(j.routes && j.routes.length){
                const geom = j.routes[0].geometry;
                routeLayer = L.geoJSON(geom).addTo(map);
                const dist = j.routes[0].distance;
                const dur = j.routes[0].duration;
                setStatus(`Route: ${(dist/1000).toFixed(2)} km — ${Math.round(dur/60)} min`);
                map.fitBounds(routeLayer.getBounds(), {padding:[40,40]});
            } else {
                setStatus('No route found');
            }
        }catch(e){ setStatus('Routing failed: ' + e.message); }
    }

    document.getElementById('clearRoute').addEventListener('click', ()=>{
        if(routeLayer) { map.removeLayer(routeLayer); routeLayer = null; setStatus('Route cleared'); }
    });

    async function scanNearby(){
        clearPlaces();
        if(!meMarker) { setStatus('No location yet'); return; }
        const latlng = meMarker.getLatLng();
        const radius = parseInt(document.getElementById('radius').value) || 2000;
        const elements = await fetchNearby(latlng.lat, latlng.lng, radius);
        if(!elements.length){ setStatus('No places found in radius'); return; }

        const okTypes = [];
        if(document.getElementById('show_hospital').checked) okTypes.push('hospital');
        if(document.getElementById('show_police').checked) okTypes.push('police');
        if(document.getElementById('show_fire').checked) okTypes.push('fire');
        if(document.getElementById('show_shelter').checked) okTypes.push('shelter');

        const myLat = latlng.lat; 
        const myLon = latlng.lng;
        const places = elements.map(e=>({
            id: e.id, 
            lat: e.lat, 
            lon: e.lon, 
            tags: e.tags || {}
        })).map(p=>({ ...p, type: classify(p)})).filter(p=>okTypes.includes(p.type));

        if(!places.length){ setStatus('No selected-type places found'); return; }

        places.forEach(p=> p.dist = haversine(myLat,myLon,p.lat,p.lon));
        places.sort((a,b)=> a.dist - b.dist);

        places.forEach(p=>{
            const marker = L.marker([p.lat,p.lon], {icon: icons[p.type] || icons.shelter}).addTo(placeMarkers);
            const name = p.tags.name || (p.tags.amenity || 'Unnamed');
            marker.bindPopup(`<strong>${name}</strong><br/>${p.type}<br/>${p.dist.toFixed(0)} m`).on('click', ()=>{ routeTo(p.lat,p.lon); });
            addPlaceToList(p, myLat, myLon);
        });

        setStatus(`Found ${places.length} place(s)`);
    }

    document.getElementById('scan').addEventListener('click', scanNearby);
    document.getElementById('locate').addEventListener('click', ()=>{
        if(meMarker) map.setView(meMarker.getLatLng(), 16);
        else setStatus('No location available yet');
    });

    startWatch();
});
// Data structures
const drills = {
  earthquake: {
    title: "Earthquake Drill",
    content: `
      <h6>Before:</h6>
      <img src="assets/imgs/before.png" alt="Earthquake Preparation" class="drill-img">
      <ul>
        <li>Secure heavy furniture and objects; anchor tall shelves.</li>
        <li>Store emergency kit with water (3 days), food, torch, radio, meds.</li>
        <li>Plan and practice two evacuation routes and assembly point.</li>
      </ul>
      <h6>During:</h6>
      <img src="assets/imgs/during.png" alt="Earthquake Safety" class="drill-img">
      <ul>
        <li>Drop, Cover and Hold On under a sturdy table or against an interior wall.</li>
        <li>If outside, move to an open area away from structures and power lines.</li>
      </ul>
      <h6>After:</h6>
      <img src="assets/imgs/after.png" alt="After Earthquake" class="drill-img">
      <ul>
        <li>Check for injuries and hazards (gas smell, structural damage).</li>
        <li>Expect aftershocks; evacuate if building is unsafe.</li>
      </ul>
    `,
    image: "assets/imgs/earthquake.jpg",
    buttonClass: "btn-primary"
  },
  tsunami: {
    title: "Tsunami Drill",
    content: `
      <h6>Before:</h6>
      <img src="assets/imgs/tsunamibefore.png" alt="Tsunami Preparation" class="drill-img">
      <ul>
        <li>Know evacuation routes to high ground and nearest shelters.</li>
        <li>Prepare a compact go-bag with essentials and a battery radio.</li>
      </ul>
      <h6>During:</h6>
      <img src="assets/imgs/tsunamiduring.png" alt="Tsunami Safety" class="drill-img">
      <ul>
        <li>If you feel a strong quake or see the sea recede — move inland and uphill immediately.</li>
        <li>Do NOT wait for official alerts if natural warnings are present.</li>
      </ul>
      <h6>After:</h6>
      <img src="assets/imgs/tsunamiafter.png" alt="After Tsunami" class="drill-img">
      <ul>
        <li>Stay away from the coast until authorities say it's safe.</li>
        <li>Report missing persons and follow relief instructions.</li>
      </ul>
    `,
    image: "assets/imgs/tsunami.jpg",
    buttonClass: "btn-info"
  },
  flood: {
    title: "Flood Simulation",
    content: `
      <h6>Before:</h6>
      <img src="assets/imgs/floodbefore.png" alt="Flood Preparation" class="drill-img">
      <ul>
        <li>Move valuables/electronics to higher places and seal documents.</li>
        <li>Prepare emergency supplies and know safe higher-ground locations.</li>
      </ul>
      <h6>During:</h6>
      <img src="assets/imgs/floodduring.png" alt="Flood Safety" class="drill-img">
      <ul>
        <li>Move to higher ground immediately; avoid walking/driving through floodwater.</li>
        <li>Turn off utilities only if it is safe to do so.</li>
      </ul>
      <h6>After:</h6>
      <img src="assets/imgs/floodafter.png" alt="After Flood" class="drill-img">
      <ul>
        <li>Beware of contaminated water; document damage for claims.</li>
        <li>Dry, clean and disinfect items exposed to floodwater.</li>
      </ul>
    `,
    image: "assets/imgs/flood.jpg",
    buttonClass: "btn-primary"
  },
  fire: {
    title: "Forest Fire Drill",
    content: `
      <h6>Before:</h6>
      <img src="assets/imgs/forestbefore.png" alt="Fire Preparation" class="drill-img">
      <ul>
        <li>Create defensible space by clearing leaves and dry brush near buildings.</li>
        <li>Keep an evacuation bag ready including masks for smoke.</li>
      </ul>
      <h6>During:</h6>
      <img src="assets/imgs/orest during.png" alt="Fire Safety" class="drill-img">
      <ul>
        <li>Evacuate immediately when ordered; wear protective clothing and mask.</li>
        <li>Close doors and windows if leaving by vehicle; keep windows closed while escaping smoke.</li>
      </ul>
      <h6>After:</h6>
      <img src="assets/imgs/forestafter.png" alt="After Fire" class="drill-img">
      <ul>
        <li>Return only after authorities confirm; watch for hotspots and structure damage.</li>
        <li>Seek medical attention for smoke inhalation.</li>
      </ul>
    `,
    image: "assets/imgs/forest fire.jpg",
    buttonClass: "btn-danger"
  },
  cyclone: {
    title: "Cyclone Drill",
    content: `
      <h6>Before:</h6>
      <img src="assets/imgs/cyclonebefore.png" alt="Cyclone Preparation" class="drill-img">
      <ul>
        <li>Secure loose outdoor objects; board up windows if advised.</li>
        <li>Stock up on water, food, medicine and charge devices.</li>
      </ul>
      <h6>During:</h6>
      <img src="assets/imgs/cycloneduring.png" alt="Cyclone Safety" class="drill-img">
      <ul>
        <li>Stay indoors in an interior room away from windows.</li>
        <li>Follow official broadcasts; do not travel unless safe.</li>
      </ul>
      <h6>After:</h6>
      <img src="assets/imgs/cycloneafter.png" alt="After Cyclone" class="drill-img">
      <ul>
        <li>Avoid downed power lines; inspect your property for hazards.</li>
        <li>Assist neighbors and report damage to authorities.</li>
      </ul>
    `,
    image: "assets/imgs/cyclone.jpg",
    buttonClass: "btn-warning"
  },
  landslide: {
    title: "Landslide Drill",
    content: `
      <h6>Before:</h6>
      <img src="assets/imgs/landbefore.png" alt="Landslide Preparation" class="drill-img">
      <ul>
        <li>Avoid building near steep slopes; maintain proper drainage around property.</li>
        <li>Prepare evacuation routes uphill and a go-bag.</li>
      </ul>
      <h6>During:</h6>
      <img src="assets/imgs/landduring.png" alt="Landslide Safety" class="drill-img">
      <ul>
        <li>If you hear rumbling or see moving earth, move uphill immediately.</li>
        <li>Help vulnerable people evacuate and keep away from river valleys.</li>
      </ul>
      <h6>After:</h6>
      <img src="assets/imgs/landafter.png" alt="After Landslide" class="drill-img">
      <ul>
        <li>Keep away from debris and report blocked roads or damaged structures.</li>
        <li>Watch for secondary slides and after-effects.</li>
      </ul>
    `,
    image: "assets/imgs/landslide.jpg",
    buttonClass: "btn-secondary"
  }
};

const resourcesData = {
  earthquake: { videos: [ "https://www.youtube.com/embed/BLEPakj1YTY", "https://www.youtube.com/embed/liw3hnAyV8U?si=k4eXH2IV24B5l3vV" ] },
  tsunami: { videos: [ "https://www.youtube.com/embed/7EDflnGzjTY?si=c1pHy3TU9KVsJ_TY", "https://www.youtube.com/embed/KOJdArJCQGI?si=yY3VNIUKTw0TVijx" ] },
  flood: { videos: [ "https://www.youtube.com/embed/cqCMXSOo8qc?si=s0vLs3G_ED9iYlgW", "https://www.youtube.com/embed/rV1iqRD9EKY?si=uTAzNDndIaZSwiae" ] },
  fire: { videos: [ "https://www.youtube.com/embed/Uc9uIZB4xvQ?si=9rSLdrPhiwI7hnWi", "https://www.youtube.com/embed/_bNLtjHG9dM?si=mPg06WLTNCtjWc4X" ] },
  cyclone: { videos: [ "https://www.youtube.com/embed/B9qR2e3xyJo?si=fAhV_Rht9XhxOcIT", "https://www.youtube.com/embed/xHRbnuB9F1I?si=JVVS9PkYd9h_vjLH" ] },
  landslide: { videos: [ "https://www.youtube.com/embed/VcgoZlpn1Y4?si=f5ad818FlJ6IxhPf", "https://www.youtube.com/embed/eSq6_rX_kOc?si=t0WRrpD-vXaG3kMT" ] }
};

// Generate drill cards
function generateDrillCards() {
  const container = document.getElementById('drill-cards');
  for (let key in drills) {
    const drill = drills[key];
    const card = `
      <div class="col-md-4">
        <div class="card shadow-sm h-100">
          <img src="${drill.image}" class="card-img-top" alt="${drill.title}">
          <div class="card-body">
            <h5 class="card-title"><i class="fas fa-${getIcon(key)} me-2"></i>${drill.title}</h5>
            <p class="card-text">${getDescription(key)}</p>
            <a href="#" class="btn ${drill.buttonClass} btn-sm" data-bs-toggle="modal" data-bs-target="#${key}Modal">View Steps</a>
          </div>
        </div>
      </div>
    `;
    container.innerHTML += card;
  }
}

function getIcon(key) {
  const icons = {
    earthquake: 'house-damage',
    tsunami: 'water',
    flood: 'house-flood-water',
    fire: 'fire',
    cyclone: 'wind',
    landslide: 'mountain'
  };
  return icons[key] || 'exclamation-triangle';
}

function getDescription(key) {
  const descriptions = {
    earthquake: 'Practice "Drop, Cover, and Hold On" to stay safe during an earthquake.',
    tsunami: 'Practice safe evacuation to high ground when a tsunami warning is issued.',
    flood: 'Prepare for rising water levels and practice safe evacuation to higher ground.',
    fire: 'Learn evacuation routes and practice fire safety strategies.',
    cyclone: 'Prepare for strong winds and follow safe shelter procedures.',
    landslide: 'Practice quick evacuation and slope safety awareness during landslides.'
  };
  return descriptions[key] || 'Learn important safety procedures.';
}

// Generate modals
function generateModals() {
  const container = document.getElementById("modals-container");
  for (let key in drills) {
    let modal = `
      <div class="modal fade" id="${key}Modal" tabindex="-1">
        <div class="modal-dialog modal-lg modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${drills[key].title}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">${drills[key].content}</div>
            <div class="modal-footer">
              <button class="btn btn-outline-primary" onclick="downloadPDF('${key}')">Download PDF</button>
              <button class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            </div>
          </div>
        </div>
      </div>
    `;
    container.innerHTML += modal;
  }
}

// PDF download function
async function downloadPDF(key) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("p", "pt", "a4");

  const modalBody = document.querySelector(`#${key}Modal .modal-body`);

  const canvas = await html2canvas(modalBody, { scale: 2 });
  const imgData = canvas.toDataURL("image/png");

  const imgProps = doc.getImageProperties(imgData);
  const pdfWidth = doc.internal.pageSize.getWidth() - 40;
  const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

  doc.addImage(imgData, "PNG", 20, 20, pdfWidth, pdfHeight);
  doc.save(drills[key].title + ".pdf");
}

// Render resource tabs content
function renderResources() {
  const container = document.getElementById('resources-content');
  container.innerHTML = '';

  for (const key of Object.keys(resourcesData)) {
    const res = resourcesData[key];
    const active = key === 'earthquake' ? 'show active' : '';
    const pane = document.createElement('div');
    pane.className = `tab-pane fade ${active}`;
    pane.id = key + 'Res';

    let html = '<div class="row justify-content-center mt-3">';
    res.videos.forEach(video => {
      html += `
        <div class="col-md-6 text-center mb-3">
          <div class="ratio ratio-16x9">
            <iframe src="${video}" title="YouTube video" allowfullscreen></iframe>
          </div>
        </div>`;
    });
    html += '</div>';

    pane.innerHTML = html;
    container.appendChild(pane);
  }
}

// Form validation
function setupFormValidation() {
  const form = document.getElementById('drillForm');
  form.addEventListener('submit', function (event) {
    if (!form.checkValidity()) {
      event.preventDefault()
      event.stopPropagation()
    } else {
      event.preventDefault();
      alert('Thank you for scheduling a drill! We will contact you shortly to confirm the details.');
      form.reset();
      form.classList.remove('was-validated');
    }
    form.classList.add('was-validated')
  }, false);
}

// Initialize everything
function init() {
  generateDrillCards();
  generateModals();
  renderResources();
  setupFormValidation();
}

// Call on load
document.addEventListener('DOMContentLoaded', init);

const popup = document.getElementById('popup');
        const enterBtn = document.getElementById('enterBtn');
        const closeBtn = document.getElementById('closeBtn');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('overlay');
        const toggleBtn = document.getElementById('toggleSidebar');

        // Sidebar toggle
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const isActive = sidebar.classList.toggle('active');
                overlay.classList.toggle('active');
                toggleBtn.setAttribute('aria-expanded', String(isActive));
            });
        }

        if (overlay) {
            overlay.addEventListener('click', () => {
                sidebar.classList.remove('active');
                overlay.classList.remove('active');
                toggleBtn && toggleBtn.setAttribute('aria-expanded', 'false');
            });
        }

        // Popup helpers
        function hidePopup(perList = true) {
            if (!popup) return;
            popup.style.display = 'none';
            popup.setAttribute('aria-hidden', 'true');
            if (perList) sessionStorage.setItem('respondr_seen_popup', '1');
        }

        if (sessionStorage.getItem('respondr_seen_popup')) {
            hidePopup(false);
        }

        enterBtn && enterBtn.addEventListener('click', () => hidePopup(true));
        closeBtn && closeBtn.addEventListener('click', () => hidePopup(false));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePopup(false); });

// SOS Emergency Module Functionality
// Get current location
async function fetchLocation() {
  if (!navigator.geolocation) throw new Error('Geolocation not supported');
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos.coords),
      err => reject(err)
    );
  });
}

// Build SOS message
function buildMessage(coords) {
  const ts = new Date().toLocaleString();
  const loc = `https://maps.google.com/?q=${coords.latitude},${coords.longitude}`;
  return `🚨 SOS! I need immediate help.\nTime: ${ts}\nLocation: ${loc}\nCoordinates: ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
}

// Open WhatsApp with message
function openWhatsApp(msg) {
  const encoded = encodeURIComponent(msg);
  const url = `https://wa.me/?text=${encoded}`;
  window.open(url, '_blank');
}

// SOS button click
document.getElementById('sosBtn').addEventListener('click', async () => {
  try {
    const coords = await fetchLocation();
    openWhatsApp(buildMessage(coords));
  } catch (e) {
    alert("Unable to fetch location. Please enable GPS/location services.");
  }
});

// Function to show modal
function showModal() {
    document.getElementById('successModal').style.display = 'flex';
}

// Function to close modal
function closeModal() {
    document.getElementById('successModal').style.display = 'none';
}

// Handle form submission
document.getElementById('resourceRequestForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const fullName = document.getElementById('fullName').value;
    const contactInfo = document.getElementById('contactInfo').value;
    const resourceType = document.getElementById('resourceType').value;
    const urgency = document.getElementById('urgency').value;
    const peopleCount = document.getElementById('peopleCount').value;
    const resourceDetails = document.getElementById('resourceDetails').value;
    const locationDetails = document.getElementById('locationDetailsForm').value;
    
    // In a real application, this would send the data to a server
    console.log('Resource Request:', {
        fullName,
        contactInfo,
        resourceType,
        urgency,
        peopleCount,
        resourceDetails,
        locationDetails
    });
    
    // Show success modal
    showModal();
    
    // Reset form
    this.reset();

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';
const OSRM_ROUTE = 'https://router.project-osrm.org/route/v1/driving';

document.addEventListener('DOMContentLoaded', function() {
    // ----- Map setup -----
    const map = L.map('map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Icons
    const icons = {
        hospital: L.icon({ 
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-red.png', 
            iconSize: [25,41], 
            iconAnchor: [12,41], 
            popupAnchor: [1,-34] 
        }),
        police: L.icon({ 
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-blue.png', 
            iconSize: [25,41], 
            iconAnchor: [12,41], 
            popupAnchor: [1,-34] 
        }),
        fire: L.icon({ 
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-orange.png', 
            iconSize: [25,41], 
            iconAnchor: [12,41], 
            popupAnchor: [1,-34] 
        }),
        shelter: L.icon({ 
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-green.png', 
            iconSize: [25,41], 
            iconAnchor: [12,41], 
            popupAnchor: [1,-34] 
        }),
        me: L.icon({ 
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-violet.png', 
            iconSize: [25,41], 
            iconAnchor: [12,41], 
            popupAnchor: [1,-34] 
        })
    };

    let meMarker = null;
    let placeMarkers = L.layerGroup().addTo(map);
    let routeLayer = null;

    const statusEl = document.getElementById('status');
    const resultsEl = document.getElementById('results');

    function setStatus(txt) { 
        statusEl.textContent = 'Status: ' + txt;
    }

    // Utility: Haversine formula
    function haversine(lat1, lon1, lat2, lon2) {
        function toRad(x) { return x * Math.PI / 180; }
        const R = 6371000; // meters
        const dLat = toRad(lat2-lat1);
        const dLon = toRad(lon2-lon1);
        const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // Geolocation
    function startWatch() {
        if (!navigator.geolocation) { 
            setStatus('Geolocation not supported'); 
            return; 
        }
        navigator.geolocation.watchPosition(pos => {
            const lat = pos.coords.latitude; 
            const lon = pos.coords.longitude;
            setStatus(`located at ${lat.toFixed(6)}, ${lon.toFixed(6)} (accuracy ${pos.coords.accuracy}m)`);
            if (!meMarker) { 
                meMarker = L.marker([lat,lon], {icon: icons.me}).addTo(map).bindPopup('You are here'); 
            } else { 
                meMarker.setLatLng([lat,lon]); 
            }
        }, err => { 
            setStatus('Geo error: ' + err.message); 
        }, { enableHighAccuracy: true, maximumAge: 3000 });
    }

    

    // Overpass query
    function buildOverpassQuery(lat, lon, radius) {
        const tags = [
            'node(around:'+radius+','+lat+','+lon+')[amenity=hospital];',
            'node(around:'+radius+','+lat+','+lon+')[amenity=police];',
            'node(around:'+radius+','+lat+','+lon+')[amenity=fire_station];',
            'node(around:'+radius+','+lat+','+lon+')[emergency=shelter];',
            'node(around:'+radius+','+lat+','+lon+')[amenity=shelter];',
        ];
        return '[out:json][timeout:25];(' + tags.join('') + ');out center;';
    }

    async function fetchNearby(lat, lon, radius) {
        setStatus('Searching nearby...');
        try {
            const q = buildOverpassQuery(lat, lon, radius);
            const url = OVERPASS_API + '?data=' + encodeURIComponent(q);
            const res = await fetch(url);
            if (!res.ok) throw new Error('Overpass error ' + res.status);
            const data = await res.json();
            return data.elements || [];
        } catch (e) { 
            setStatus('Overpass failed: ' + e.message); 
            return [];
        }
    }

    function classify(elem) {
        const tags = elem.tags || {};
        if (tags.amenity === 'hospital') return 'hospital';
        if (tags.amenity === 'police') return 'police';
        if (tags.amenity === 'fire_station') return 'fire';
        if (tags.emergency === 'shelter' || tags.amenity === 'shelter') return 'shelter';
        return 'unknown';
    }

    function clearPlaces() { 
        placeMarkers.clearLayers(); 
        resultsEl.innerHTML = ''; 
    }

    function addPlaceToList(place, myLat, myLon) {
        const div = document.createElement('div');
        div.className = 'result-item';
        const type = place.type;
        const name = (place.tags && (place.tags.name || place.tags['amenity'])) || 'Unnamed';
        const lat = place.lat; 
        const lon = place.lon;
        const dist = haversine(myLat, myLon, lat, lon);
        div.innerHTML = `<span class="type-badge">${type}</span><strong>${name}</strong><div class="small">${dist.toFixed(0)} m — ${lat.toFixed(5)}, ${lon.toFixed(5)}</div>`;
        div.addEventListener('click', () => { 
            map.setView([lat,lon], 16); 
            routeTo(lat,lon); 
        });
        resultsEl.appendChild(div);
    }

    async function routeTo(destLat, destLon) {
        if (!meMarker) { 
            setStatus('Current location unknown — allow location and try again'); 
            return; 
        }
        const from = meMarker.getLatLng();
        const url = `${OSRM_ROUTE}/${from.lng},${from.lat};${destLon},${destLat}?overview=full&geometries=geojson&steps=false`;
        setStatus('Requesting route...');
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Routing error ' + res.status);
            const j = await res.json();
            if (routeLayer) map.removeLayer(routeLayer);
            if (j.routes && j.routes.length) {
                const geom = j.routes[0].geometry;
                routeLayer = L.geoJSON(geom).addTo(map);
                const dist = j.routes[0].distance;
                const dur = j.routes[0].duration;
                setStatus(`Route: ${(dist/1000).toFixed(2)} km — ${Math.round(dur/60)} min`);
                map.fitBounds(routeLayer.getBounds(), {padding: [40,40]});
            } else {
                setStatus('No route found');
            }
        } catch (e) { 
            setStatus('Routing failed: ' + e.message); 
        }
    }

    document.getElementById('clearRoute').addEventListener('click', () => {
        if (routeLayer) { 
            map.removeLayer(routeLayer); 
            routeLayer = null; 
            setStatus('Route cleared'); 
        }
    });

    async function scanNearby() {
        clearPlaces();
        if (!meMarker) { 
            setStatus('No location yet'); 
            return; 
        }
        const latlng = meMarker.getLatLng();
        const radius = parseInt(document.getElementById('radius').value) || 2000;
        const elements = await fetchNearby(latlng.lat, latlng.lng, radius);
        if (!elements.length) { 
            setStatus('No places found in radius'); 
            return; 
        }

        const okTypes = [];
        if (document.getElementById('show_hospital').checked) okTypes.push('hospital');
        if (document.getElementById('show_police').checked) okTypes.push('police');
        if (document.getElementById('show_fire').checked) okTypes.push('fire');
        if (document.getElementById('show_shelter').checked) okTypes.push('shelter');

        const myLat = latlng.lat; 
        const myLon = latlng.lng;
        const places = elements.map(e => ({
            id: e.id, 
            lat: e.lat, 
            lon: e.lon, 
            tags: e.tags || {}
        })).map(p => ({ ...p, type: classify(p) })).filter(p => okTypes.includes(p.type));

        if (!places.length) { 
            setStatus('No selected-type places found'); 
            return; 
        }

        places.forEach(p => p.dist = haversine(myLat, myLon, p.lat, p.lon));
        places.sort((a, b) => a.dist - b.dist);

        places.forEach(p => {
            const marker = L.marker([p.lat, p.lon], {icon: icons[p.type] || icons.shelter}).addTo(placeMarkers);
            const name = p.tags.name || (p.tags.amenity || 'Unnamed');
            marker.bindPopup(`<strong>${name}</strong><br/>${p.type}<br/>${p.dist.toFixed(0)} m`).on('click', () => { 
                routeTo(p.lat, p.lon); 
            });
            addPlaceToList(p, myLat, myLon);
        });

        setStatus(`Found ${places.length} place(s)`);
    }

    document.getElementById('scan').addEventListener('click', scanNearby);
    document.getElementById('locate').addEventListener('click', () => {
        if (meMarker) map.setView(meMarker.getLatLng(), 16);
        else setStatus('No location available yet');
    });

    startWatch();

    // Chatbot toggle
        const chatbotBtn = document.getElementById("chatbotToggle");
        const chatWindow = document.getElementById("chatWindow");
        const chatClose = document.getElementById("chatClose");
        const chatBody = document.getElementById("chatBody");
        const chatInput = document.getElementById("chatInput");
        const chatSend = document.getElementById("chatSend");

        chatbotBtn.addEventListener("click", () => {
            chatWindow.style.display = "flex";
            chatbotBtn.style.display = "none";
        });

        chatClose.addEventListener("click", () => {
            chatWindow.style.display = "none";
            chatbotBtn.style.display = "flex";
        });

        // Send message
        chatSend.addEventListener("click", sendMessage);
        chatInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") sendMessage();
        });

        function sendMessage() {
            const msg = chatInput.value.trim();
            if (!msg) return;

            // Show user message
            const userMsg = document.createElement("div");
            userMsg.className = "user-message";
            userMsg.innerText = msg;
            chatBody.appendChild(userMsg);

            // Real Gemini API response
            fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=AIzaSyB2aJU1KG-Y191BXVDNpi6QjwiCAZddkW0", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: msg }] }]
                }),
            })
                .then(res => res.json())
                .then(data => {
                    const botMsg = document.createElement("div");
                    botMsg.className = "bot-message";

                    // Extract AI text
                    if (data.candidates && data.candidates[0].content.parts[0].text) {
                        botMsg.innerText = data.candidates[0].content.parts[0].text;
                    } else {
                        botMsg.innerText = "⚠ No response received.";
                    }

                    chatBody.appendChild(botMsg);
                    chatBody.scrollTop = chatBody.scrollHeight;
                })
                .catch(err => {
                    const botMsg = document.createElement("div");
                    botMsg.className = "bot-message";
                    botMsg.innerText = "❌ Error: " + err.message;
                    chatBody.appendChild(botMsg);
                    chatBody.scrollTop = chatBody.scrollHeight;
                });

            chatInput.value = "";
            chatBody.scrollTop = chatBody.scrollHeight;
        }

    // SOS Emergency Module Functionality
    async function fetchLocation() {
        if (!navigator.geolocation) throw new Error('Geolocation not supported');
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                pos => resolve(pos.coords),
                err => reject(err)
            );
        });
    }

    function buildMessage(coords) {
        const ts = new Date().toLocaleString();
        const loc = `https://maps.google.com/?q=${coords.latitude},${coords.longitude}`;
        return `🚨 SOS! I need immediate help.\nTime: ${ts}\nLocation: ${loc}\nCoordinates: ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
    }

    function openWhatsApp(msg) {
        const encoded = encodeURIComponent(msg);
        const url = `https://wa.me/?text=${encoded}`;
        window.open(url, '_blank');
    }

    document.getElementById('sosBtn').addEventListener('click', async () => {
        try {
            const coords = await fetchLocation();
            openWhatsApp(buildMessage(coords));
        } catch (e) {
            alert("Unable to fetch location. Please enable GPS/location services.");
        }
    });

    function showModal() {
        document.getElementById('successModal').style.display = 'flex';
    }

    function closeModal() {
        document.getElementById('successModal').style.display = 'none';
    }

    document.getElementById('resourceRequestForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const fullName = document.getElementById('fullName').value;
        const contactInfo = document.getElementById('contactInfo').value;
        const resourceType = document.getElementById('resourceType').value;
        const urgency = document.getElementById('urgency').value;
        const peopleCount = document.getElementById('peopleCount').value;
        const resourceDetails = document.getElementById('resourceDetails').value;
        const locationDetails = document.getElementById('locationDetailsForm').value;
        console.log('Resource Request:', {
            fullName,
            contactInfo,
            resourceType,
            urgency,
            peopleCount,
            resourceDetails,
            locationDetails
        });
        showModal();
        this.reset();
    });

    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    const toggleBtn = document.getElementById('toggleSidebar');

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const isActive = sidebar.classList.toggle('active');
            overlay.classList.toggle('active');
            toggleBtn.setAttribute('aria-expanded', String(isActive));
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('active');
            overlay.classList.remove('active');
            toggleBtn && toggleBtn.setAttribute('aria-expanded', 'false');
        });
    }
});
});