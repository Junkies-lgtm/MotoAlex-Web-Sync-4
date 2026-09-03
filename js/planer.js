/**
 * MotoAlex Navigation - Routenplaner
 * Reines Vanilla JavaScript mit MapLibre GL JS & BRouter API
 */

// ==========================================================================
// 1. ZENTRALE KONSTANTEN (KONFIGURATION)
// ==========================================================================

// Adresse des Kartenstils (eigener Kachelserver)
const MAP_STYLE_URL = 'https://tiles.motoalex-navigation.de/assets/style-bright.json';

// Begrenzung des Kartenausschnitts und Zoomlevels (Mitteleuropa / Nachbarländer)
const MAP_MIN_ZOOM = 3;
const MAP_MAX_BOUNDS = [[-5.0, 40.0], [25.0, 62.0]];

// Pfad zur vereinfachten Europa-Hintergrundebene
const EUROPA_GEOJSON_URL = 'data/europa.geojson';

// Basisadresse des BRouter-Routendienstes (eigener Server)
const ROUTING_SERVICE_URL = 'https://brouter.motoalex-navigation.de/brouter';

// BRouter-Profil-ID
const PROFILE_ID = 'motorcycle';

// Zuordnung der vier Routing-Modi zu BRouter-Profilparametern (profile:name=wert)
const MODE_PARAMETERS = {
  schnellste: {
    avoid_motorways: 0,
    consider_town: 0,
    curviness: 0
  },
  schnell: {
    avoid_motorways: 1,
    consider_town: 0,
    curviness: 0
  },
  kurvig: {
    avoid_motorways: 1,
    consider_town: 1,
    curviness: 1
  },
  extra_kurvig: {
    avoid_motorways: 1,
    consider_town: 1,
    curviness: 2
  }
};

// ==========================================================================
// 2. ANWENDUNGSZUSTAND (STATE)
// ==========================================================================
const state = {
  waypoints: [], // Array von { lng: number, lat: number, marker: MarkerInstance }
  segmentModes: [], // Array von String-Modi je Abschnitt (Länge = waypoints.length - 1)
  currentRouteGeoJSON: null,
  currentRouteProperties: null,
  selectedMode: 'kurvig', // Standardprofil: 'kurvig' ('schnellste', 'schnell', 'kurvig', 'extra_kurvig')
  isLoading: false
};

// DOM-Elemente & Kontextmenü-Status
let map;
let domElements = {};
let activeContextMenu = null;
let lastContextMenuOpenTimestamp = 0;
let draggedWaypointIndex = null;

/**
 * Prueft, ob das Geraet ein Touchscreen oder ein mobiles Geraet ist
 */
function isTouchOrMobileDevice() {
  return window.matchMedia('(max-width: 880px)').matches ||
         window.matchMedia('(pointer: coarse)').matches ||
         ('ontouchstart' in window) ||
         (navigator.maxTouchPoints > 0);
}

// Profil-Beschreibungen
const PROFILE_EXPLANATIONS = {
  schnellste: {
    icon: '🚀',
    title: 'Schnellste',
    desc: 'Kürzeste Fahrzeit. Nutzt Autobahnen und Hauptverkehrsachsen.'
  },
  schnell: {
    icon: '💨',
    title: 'Schnell',
    desc: 'Direkter Weg ohne Autobahn. Durchfährt Städte, wenn es Fahrzeit spart.'
  },
  kurvig: {
    icon: '🏍️',
    title: 'Kurvig',
    desc: 'Kurvenreiche Landstraßen ohne Autobahn. Meidet größere Städte für mehr Fahrspaß (kann länger dauern).'
  },
  extra_kurvig: {
    icon: '⚡',
    title: 'Extra kurvig',
    desc: 'Sehr kurvige Land- & Nebenstraßen ohne Autobahn. Maximale Kurvenanzahl abseits großer Städte.'
  }
};

/**
 * Aktualisiert die Erklaerung des ausgewaehlten Routenprofils
 */
function updateProfileExplanation(modeKey) {
  const profile = PROFILE_EXPLANATIONS[modeKey] || PROFILE_EXPLANATIONS.kurvig;
  if (domElements.profileInfoIcon) domElements.profileInfoIcon.textContent = profile.icon;
  if (domElements.profileInfoTitle) domElements.profileInfoTitle.textContent = profile.title;
  if (domElements.profileInfoDesc) domElements.profileInfoDesc.textContent = profile.desc;
}

/**
 * Initialisiert das Beta-Hinweis-Popup ueber der Karte
 * Wird bei jedem Besuch der Seite angezeigt (keine dauerhafte Speicherung im localStorage).
 */
function initBetaPopup() {
  try {
    localStorage.removeItem('motoalex_beta_popup_dismissed');
    localStorage.removeItem('motoalex_beta_hint_closed');
  } catch (_) {}

  if (domElements.betaInfoPopup) {
    domElements.betaInfoPopup.style.display = 'block';
    domElements.betaInfoPopup.style.opacity = '1';
    domElements.betaInfoPopup.style.transform = 'none';
  }

  const dismissPopup = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (domElements.betaInfoPopup) {
      domElements.betaInfoPopup.style.opacity = '0';
      domElements.betaInfoPopup.style.transform = 'translateY(-8px)';
      setTimeout(() => {
        if (domElements.betaInfoPopup) {
          domElements.betaInfoPopup.style.display = 'none';
        }
      }, 200);
    }
  };

  if (domElements.btnCloseBetaPopup) {
    domElements.btnCloseBetaPopup.addEventListener('click', dismissPopup);
    domElements.btnCloseBetaPopup.addEventListener('touchend', dismissPopup);
  }
  if (domElements.btnAckBetaPopup) {
    domElements.btnAckBetaPopup.addEventListener('click', dismissPopup);
    domElements.btnAckBetaPopup.addEventListener('touchend', dismissPopup);
  }
}

/**
 * Initialisiert den schliessbaren Karten-Bedienhinweis
 */
function initMapHint() {
  const dismissMapHint = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (domElements.mapClickHint) {
      domElements.mapClickHint.style.opacity = '0';
      domElements.mapClickHint.style.transform = 'translateY(-6px)';
      setTimeout(() => {
        if (domElements.mapClickHint) {
          domElements.mapClickHint.style.display = 'none';
        }
      }, 200);
    }
  };

  if (domElements.btnCloseMapHint) {
    domElements.btnCloseMapHint.addEventListener('click', dismissMapHint);
    domElements.btnCloseMapHint.addEventListener('touchend', dismissMapHint);
  }
}

// ==========================================================================
// 3. INITIALISIERUNG
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  // DOM-Referenzen cachen
  domElements = {
    modeSelect: document.getElementById('routing-mode'),
    profileInfoBox: document.getElementById('profile-info-box'),
    profileInfoIcon: document.getElementById('profile-info-icon'),
    profileInfoTitle: document.getElementById('profile-info-title'),
    profileInfoDesc: document.getElementById('profile-info-desc'),
    betaInfoPopup: document.getElementById('beta-info-popup'),
    btnCloseBetaPopup: document.getElementById('btn-close-beta-popup'),
    btnAckBetaPopup: document.getElementById('btn-ack-beta-popup'),
    mapClickHint: document.getElementById('map-click-hint'),
    btnCloseMapHint: document.getElementById('btn-close-map-hint'),
    waypointsList: document.getElementById('waypoints-list'),
    emptyWaypointsHint: document.getElementById('empty-waypoints-hint'),
    statusBanner: document.getElementById('status-banner'),
    routeSummaryBox: document.getElementById('route-summary'),
    routeDistance: document.getElementById('route-distance'),
    routeDuration: document.getElementById('route-duration'),
    btnCalculate: document.getElementById('btn-calculate'),
    btnShareRoute: document.getElementById('btn-share-route'),
    btnGpxDownload: document.getElementById('btn-gpx-download'),
    btnClearRoute: document.getElementById('btn-clear-route'),
    shareModal: document.getElementById('share-modal'),
    btnCloseShareModal: document.getElementById('btn-close-share-modal'),
    btnCloseShareModalFooter: document.getElementById('btn-close-share-modal-footer'),
    shareUrlInput: document.getElementById('share-url-input'),
    btnCopyShareUrl: document.getElementById('btn-copy-share-url'),
    shareCopyFeedback: document.getElementById('share-copy-feedback'),
    shareQrContainer: document.getElementById('share-qrcode'),
    addressSearchInput: document.getElementById('address-search-input'),
    btnClearSearch: document.getElementById('btn-clear-search'),
    searchResultsDropdown: document.getElementById('search-results-dropdown'),
    mapErrorNotice: document.getElementById('map-error-notice')
  };

  initMap();
  initEventListeners();
  initAddressSearch();
  initBetaPopup();
  initMapHint();
  updateProfileExplanation(state.selectedMode || 'kurvig');
  checkUrlParamsOnLoad();
});

/**
 * Blendet den dezenten Fehlerhinweis ueber der Karte ein
 */
function showMapErrorBanner() {
  const el = domElements.mapErrorNotice || document.getElementById('map-error-notice');
  if (el) {
    el.style.display = 'flex';
  }
}

/**
 * Blendet den dezenten Fehlerhinweis wieder aus
 */
function hideMapErrorBanner() {
  const el = domElements.mapErrorNotice || document.getElementById('map-error-notice');
  if (el) {
    el.style.display = 'none';
  }
}

/**
 * Zeigt einen deutlich sichtbaren Hinweis im Kartenbereich an
 */
function showMapNotice(title, message, isError = false) {
  const mapContainer = document.getElementById('map');
  if (!mapContainer) return;
  mapContainer.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 24px; text-align: center; background-color: var(--surface); color: var(--text);">
      <div style="font-size: 2.2rem; margin-bottom: 12px;">${isError ? '⚠️' : '🗺️'}</div>
      <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 8px; color: ${isError ? 'var(--color-error)' : 'var(--accent)'};">${title}</h3>
      <p style="max-width: 500px; font-size: 0.95rem; color: var(--text-dim); line-height: 1.6; margin-bottom: 16px;">${message}</p>
      <div style="background-color: var(--surface-light); border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 10px 16px; font-family: monospace; font-size: 0.85rem; color: var(--text);">
        const MAP_STYLE_URL = 'https://api.maptiler.com/maps/streets-v4/style.json?key=...';
      </div>
    </div>
  `;
}

/**
 * Initialisiert die MapLibre-Karte
 */
function initMap() {
  // Pruefen, ob noch ein Platzhalter-Schluessel aktiv ist
  if (MAP_STYLE_URL.includes('yourapikey') || MAP_STYLE_URL.includes('DEIN_SCHLUESSEL')) {
    showMapNotice(
      'Kein Kartenschlüssel hinterlegt',
      'In js/planer.js ist noch der Platzhalter yourapikey für den MapTiler-Kartenstil eingetragen. Bitte trage dort deinen persönlichen MapTiler API-Schlüssel ein, um die Karte zu laden.'
    );
    return;
  }

  try {
    map = new maplibregl.Map({
      container: 'map',
      style: MAP_STYLE_URL,
      center: [10.4515, 51.1657], // Geografische Mitte Deutschlands
      zoom: 6,
      minZoom: MAP_MIN_ZOOM,
      maxBounds: MAP_MAX_BOUNDS,
      attributionControl: true,
      antialias: true
    });

    // Navigations-Bedienelemente (Zoom / Kompass) hinzufuegen
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');

    // Skala hinzufuegen
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    // Klick auf die Karte: auf mobilen Geraeten oeffnet ein Tippen das Menue, auf Desktop schliesst es dieses
    map.on('click', (e) => {
      if (isTouchOrMobileDevice()) {
        openContextMenu(e);
      } else {
        closeContextMenu();
      }
    });

    // Kontextmenü mit Rechtsklick öffnen
    map.on('contextmenu', (e) => {
      e.originalEvent.preventDefault();
      openContextMenu(e);
    });

    map.on('movestart', () => {
      closeContextMenu();
    });

    // Nach dem Laden des Kartenstils Hintergrund- und Routing-Ebenen vorbereiten
    map.on('load', () => {
      setupEuropaBackgroundLayer();
      setupRouteLayers();
      map.resize();
    });

    window.addEventListener('resize', () => {
      if (map) {
        map.resize();
      }
    });
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        if (map) {
          map.resize();
        }
      }, 100);
    });

    // Fehlerbehandlung für die Karte: Listener für das error-Ereignis
    map.on('error', (e) => {
      const errorText = (e && e.error && (e.error.message || e.error.statusText)) || (e && e.message) || (e && e.error) || 'Unbekannter Fehler';
      const errorUrl = (e && (e.url || (e.error && (e.error.url || e.error.statusText)) || (e.tile && (e.tile.url || (e.tile.canonical && e.tile.canonical.url))) || (e.source && e.source.url))) || (e && e.resource && e.resource.url) || 'Unbekannte Adresse';

      console.error(`Kartenfehler: ${errorText} | Adresse: ${errorUrl}`, e);

      showMapErrorBanner();

      if (e && e.error && (e.error.status === 401 || e.error.status === 403 || e.error.status === 404)) {
        showMapNotice(
          'Fehler beim Laden des Kartenstils',
          `Der Kartendienst konnte nicht geladen werden (HTTP ${e.error.status || 'Fehler'}). Bitte überprüfe den hinterlegten API-Schlüssel in js/planer.js.`,
          true
        );
      }
    });

    // Sobald Kacheln oder Kartendaten wieder erfolgreich geladen werden, Hinweis ausblenden
    map.on('data', (e) => {
      if (e.dataType === 'source' || e.dataType === 'tile' || e.dataType === 'style') {
        hideMapErrorBanner();
      }
    });

    map.on('sourcedata', (e) => {
      if (e.isSourceLoaded) {
        hideMapErrorBanner();
      }
    });

    map.on('idle', () => {
      hideMapErrorBanner();
    });
  } catch (err) {
    console.error('Fehler bei der Karteninitialisierung:', err);
    showMapNotice(
      'Karteninitialisierung fehlgeschlagen',
      'Die Karte konnte nicht geladen werden. Bitte überprüfe die Konfiguration in js/planer.js.',
      true
    );
  }
}

/**
 * Schliesst das offene Kontextmenü auf der Karte
 */
function closeContextMenu() {
  if (activeContextMenu && activeContextMenu.parentNode) {
    activeContextMenu.parentNode.removeChild(activeContextMenu);
    activeContextMenu = null;
  }
}

/**
 * Oeffnet das 3-Felder-Kontextmenue ("als Start", "als Via", "als Ziel")
 */
function openContextMenu(e) {
  closeContextMenu();
  lastContextMenuOpenTimestamp = Date.now();

  const lng = e.lngLat.lng;
  const lat = e.lngLat.lat;
  const point = e.point;

  const mapContainer = map.getContainer();
  const rect = mapContainer.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.className = 'map-context-menu';

  // Positionierung innerhalb der sichtbaren Karte sicherstellen
  let left = point.x + 6;
  let top = point.y + 6;
  if (left + 165 > rect.width) {
    left = Math.max(8, point.x - 160);
  }
  if (top + 150 > rect.height) {
    top = Math.max(8, point.y - 140);
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  menu.innerHTML = `
    <button type="button" class="context-menu-item" data-action="start">
      <span class="context-menu-dot dot-start"></span>
      <span>als Start</span>
    </button>
    <button type="button" class="context-menu-item" data-action="via">
      <span class="context-menu-dot dot-via"></span>
      <span>als Via</span>
    </button>
    <button type="button" class="context-menu-item" data-action="ziel">
      <span class="context-menu-dot dot-end"></span>
      <span>als Ziel</span>
    </button>
  `;

  menu.addEventListener('click', (evt) => {
    evt.stopPropagation();
    const btn = evt.target.closest('.context-menu-item');
    if (!btn) return;
    const action = btn.dataset.action;
    closeContextMenu();

    if (action === 'start') {
      addWaypointAsStart(lng, lat);
    } else if (action === 'via') {
      addWaypointAsVia(lng, lat);
    } else if (action === 'ziel') {
      addWaypointAsZiel(lng, lat);
    }
  });

  menu.addEventListener('contextmenu', (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
  });

  mapContainer.appendChild(menu);
  activeContextMenu = menu;
}

/**
 * Registriert Event Listener fuer Benutzerinteraktionen
 */
function initEventListeners() {
  // Klick ausserhalb des Menüs schliesst dieses
  document.addEventListener('click', (e) => {
    if (Date.now() - lastContextMenuOpenTimestamp < 100) {
      return;
    }
    if (activeContextMenu && !activeContextMenu.contains(e.target)) {
      closeContextMenu();
    }
  });

  // Modus-Aenderung (Hauptauswahl aendert alle Abschnitte und den Standardmodus)
  if (domElements.modeSelect) {
    domElements.modeSelect.addEventListener('change', (e) => {
      state.selectedMode = e.target.value;
      updateProfileExplanation(state.selectedMode);
      // Alle Segmente auf den neu gewählten globalen Modus aktualisieren
      for (let i = 0; i < state.segmentModes.length; i++) {
        state.segmentModes[i] = state.selectedMode;
      }
      renderWaypointsList();
      if (state.waypoints.length >= 2) {
        calculateRoute();
      }
    });
  }

  // Route berechnen
  if (domElements.btnCalculate) {
    domElements.btnCalculate.addEventListener('click', () => {
      calculateRoute();
    });
  }

  // GPX-Download
  if (domElements.btnGpxDownload) {
    domElements.btnGpxDownload.addEventListener('click', () => {
      downloadGpxFile();
    });
  }

  // Route teilen
  if (domElements.btnShareRoute) {
    domElements.btnShareRoute.addEventListener('click', () => {
      openShareModal();
    });
  }

  // Modal schliessen
  if (domElements.btnCloseShareModal) {
    domElements.btnCloseShareModal.addEventListener('click', () => {
      closeShareModal();
    });
  }

  if (domElements.btnCloseShareModalFooter) {
    domElements.btnCloseShareModalFooter.addEventListener('click', () => {
      closeShareModal();
    });
  }

  if (domElements.shareModal) {
    domElements.shareModal.addEventListener('click', (e) => {
      if (e.target === domElements.shareModal) {
        closeShareModal();
      }
    });
  }

  // ESC-Taste schliesst das Modal und Kontextmenü
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeContextMenu();
      if (domElements.shareModal && domElements.shareModal.style.display !== 'none') {
        closeShareModal();
      }
    }
  });

  // Link kopieren
  if (domElements.btnCopyShareUrl) {
    domElements.btnCopyShareUrl.addEventListener('click', () => {
      copyShareUrl();
    });
  }

  // Alles zuruecksetzen
  if (domElements.btnClearRoute) {
    domElements.btnClearRoute.addEventListener('click', () => {
      clearAllWaypointsAndRoute();
    });
  }
}

// ==========================================================================
// 4b. OFFLINE-STÄDTE-, PASS- & ORTSSUCHE
// ==========================================================================

/**
 * Wandelt HTML-Sonderzeichen zur sicheren Ausgabe um
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Normalisiert Zeichenketten fuer tolerante Suche (Umlaute, Sonderzeichen, Kleinschreibung)
 * Wandelt Umlaute sowohl direkt als auch in zerlegter Form um (z. B. Köln -> koln, koeln)
 */
function normalizeSearchString(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Initialisiert die Offline-Städte- und Ortssuche
 */
function initAddressSearch() {
  const input = domElements.addressSearchInput;
  const clearBtn = domElements.btnClearSearch;
  const dropdown = domElements.searchResultsDropdown;

  if (!input || !dropdown) return;

  // Sofortige Suche beim Tippen (ohne Server-Latenz)
  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (clearBtn) {
      clearBtn.style.display = query.length > 0 ? 'block' : 'none';
    }

    if (query.length < 1) {
      hideSearchResults();
      return;
    }

    performLocalPlacesSearch(query);
  });

  // Beim Fokussieren bestehende Suche wieder einblenden
  input.addEventListener('focus', () => {
    const query = input.value.trim();
    if (query.length >= 1) {
      performLocalPlacesSearch(query);
    }
  });

  // Enter-Taste waehlt erstes Ergebnis
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const firstItem = dropdown.querySelector('.search-result-item');
      if (firstItem) {
        firstItem.click();
      }
    } else if (e.key === 'Escape') {
      hideSearchResults();
    }
  });

  // Klick auf Leeren-Button
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      input.value = '';
      clearBtn.style.display = 'none';
      hideSearchResults();
      input.focus();
    });
  }

  // Klick ausserhalb schliesst Dropdown
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box-container')) {
      hideSearchResults();
    }
  });
}

/**
 * Durchsucht die integrierte Orte- und Pässedatenbank lokal im Browser
 */
function performLocalPlacesSearch(query) {
  const dropdown = domElements.searchResultsDropdown;
  if (!dropdown) return;

  const places = window.MOTOALEX_PLACES || [];
  if (places.length === 0) {
    dropdown.style.display = 'block';
    dropdown.innerHTML = '<div class="search-empty-hint">Ortsdatenbank wird geladen...</div>';
    return;
  }

  const normQuery = normalizeSearchString(query);
  const rawQueryLower = query.toLowerCase().trim();

  if (!normQuery && !rawQueryLower) {
    hideSearchResults();
    return;
  }

  // Relevanz-Scoring
  const matches = [];

  for (let i = 0; i < places.length; i++) {
    const item = places[i]; // [name, lat, lng, type, zipOrDesc]
    const name = item[0] || '';
    const lat = item[1];
    const lng = item[2];
    const type = item[3] || 'stadt';
    const desc = item[4] || '';

    const normName = normalizeSearchString(name);
    const normDesc = normalizeSearchString(desc);
    const rawNameLower = name.toLowerCase();
    const rawDescLower = desc.toLowerCase();

    let score = 0;

    if (rawNameLower.startsWith(rawQueryLower) || normName.startsWith(normQuery)) {
      // Exakter Wortanfang im Namen = hoechste Prioritaet
      score = 100 - Math.abs(normName.length - normQuery.length);
    } else if (rawNameLower.includes(rawQueryLower) || normName.includes(normQuery)) {
      // Name enthaelt Suchbegriff
      score = 60;
    } else if (rawDescLower.startsWith(rawQueryLower) || normDesc.startsWith(normQuery)) {
      // PLZ oder Zusatz beginnt mit Suchbegriff (z.B. "50667")
      score = 50;
    } else if (rawDescLower.includes(rawQueryLower) || normDesc.includes(normQuery)) {
      // PLZ / Bundesland enthaelt Suchbegriff
      score = 30;
    }

    // Pässe oder POIs bei speziellem Keyword boosten
    if ((normQuery.includes('pass') || normQuery.includes('joch')) && type === 'pass') {
      score += 25;
    }

    if (score > 0) {
      matches.push({ name, lat, lng, type, desc, score });
    }
  }

  // Nach Score absteigend sortieren
  matches.sort((a, b) => b.score - a.score);

  // Maximal 8 beste Treffer
  const topMatches = matches.slice(0, 8);

  renderSearchResults(topMatches, query);
}

/**
 * Rendert die Trefferliste im Dropdown
 */
function renderSearchResults(items, query) {
  const dropdown = domElements.searchResultsDropdown;
  if (!dropdown) return;

  if (!items || items.length === 0) {
    dropdown.style.display = 'block';
    dropdown.innerHTML = `<div class="search-empty-hint">Kein Ort oder Pass für „${escapeHtml(query)}“ gefunden</div>`;
    return;
  }

  dropdown.innerHTML = '';
  dropdown.style.display = 'block';

  items.forEach((item) => {
    let icon = '📍';
    if (item.type === 'pass') icon = '🏔️';
    else if (item.type === 'poi') icon = '🏍️';
    else if (item.type === 'stadt') icon = '🏙️';

    const itemEl = document.createElement('div');
    itemEl.className = 'search-result-item';
    itemEl.innerHTML = `
      <div class="search-result-primary">${icon} ${escapeHtml(item.name)}</div>
      ${item.desc ? `<div class="search-result-secondary">${escapeHtml(item.desc)}</div>` : ''}
    `;

    itemEl.addEventListener('click', (e) => {
      e.stopPropagation();
      onSearchResultSelected(item.lng, item.lat, item.name);
    });

    dropdown.appendChild(itemEl);
  });
}

/**
 * Behandelt die Auswahl eines Suchtreffers
 */
function onSearchResultSelected(lng, lat, name) {
  hideSearchResults();
  if (domElements.addressSearchInput) {
    domElements.addressSearchInput.value = '';
    if (domElements.btnClearSearch) {
      domElements.btnClearSearch.style.display = 'none';
    }
  }

  // Karte auf den Punkt zentrieren
  if (map) {
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), 12),
      essential: true
    });
  }

  // Logik: 
  // 1. Wenn noch kein Wegpunkt existiert -> Als Start setzen
  // 2. Wenn 1 Wegpunkt existiert -> Als Ziel setzen (Route wird sofort berechnet)
  // 3. Wenn bereits Start & Ziel existieren -> Als neues Zwischenziel / Ziel anfügen
  if (state.waypoints.length === 0) {
    addWaypointAsStart(lng, lat);
    showStatus(`Startpunkt gesetzt: ${name}`, 'success');
  } else if (state.waypoints.length === 1) {
    addWaypointAsZiel(lng, lat);
  } else {
    // Als weiteres Zwischenziel/Ziel anfügen
    addWaypointAsZiel(lng, lat);
  }
}

/**
 * Schließt das Such-Dropdown
 */
function hideSearchResults() {
  const dropdown = domElements.searchResultsDropdown;
  if (dropdown) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }
}

// ==========================================================================
// 5. WEGPUNKT-MANAGEMENT & SORTIERUNG
// ==========================================================================

/**
 * Erstellt ein neues Wegpunkt-Objekt inklusive verschiebbarem Kartenmarker
 */
function createWaypointObject(lng, lat) {
  const container = document.createElement('div');
  container.className = 'map-marker-container';

  const pin = document.createElement('div');
  pin.className = 'custom-map-pin';
  container.appendChild(pin);

  const marker = new maplibregl.Marker({
    element: container,
    draggable: true,
    anchor: 'bottom'
  })
    .setLngLat([lng, lat])
    .addTo(map);

  const waypointObj = {
    lng,
    lat,
    marker
  };

  // Touch Long-Press Erkennung fuer mobile Geraete
  let touchStartPos = { x: 0, y: 0 };
  let isLongPressActive = false;
  let longPressTimer = null;

  container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      isLongPressActive = false;

      longPressTimer = setTimeout(() => {
        isLongPressActive = true;
        container.classList.add('marker-is-dragging');
        if (navigator.vibrate) {
          try { navigator.vibrate(35); } catch (_) {}
        }
      }, 250);
    }
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (longPressTimer && !isLongPressActive && e.touches.length > 0) {
      const dx = Math.abs(e.touches[0].clientX - touchStartPos.x);
      const dy = Math.abs(e.touches[0].clientY - touchStartPos.y);
      if (dx > 8 || dy > 8) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }
  }, { passive: true });

  const clearTouchState = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    container.classList.remove('marker-is-dragging');
  };

  container.addEventListener('touchend', clearTouchState, { passive: true });
  container.addEventListener('touchcancel', clearTouchState, { passive: true });

  marker.on('dragstart', () => {
    closeContextMenu();
    container.classList.add('marker-is-dragging');
  });

  // Marker verschiebbar mit Linksklick oder Touch-Drag
  marker.on('dragend', () => {
    clearTouchState();
    const newLngLat = marker.getLngLat();
    waypointObj.lng = newLngLat.lng;
    waypointObj.lat = newLngLat.lat;
    renderWaypointsList();
    if (state.waypoints.length >= 2) {
      calculateRoute();
    }
  });

  return waypointObj;
}

/**
 * Synchronisiert das segmentModes Array mit der aktuellen Anzahl an Wegpunkten
 */
function syncSegmentModes() {
  const numSegments = Math.max(0, state.waypoints.length - 1);
  const defaultMode = state.selectedMode || 'kurvig';
  
  while (state.segmentModes.length < numSegments) {
    state.segmentModes.push(defaultMode);
  }
  if (state.segmentModes.length > numSegments) {
    state.segmentModes.length = numSegments;
  }
}

/**
 * Fuegt einen Wegpunkt an einem bestimmten Index ein
 */
function insertWaypointAt(lng, lat, targetIndex) {
  const waypointObj = createWaypointObject(lng, lat);

  if (targetIndex <= 0) {
    state.waypoints.unshift(waypointObj);
    if (state.waypoints.length > 1) {
      state.segmentModes.unshift(state.selectedMode || 'kurvig');
    }
  } else if (targetIndex >= state.waypoints.length) {
    state.waypoints.push(waypointObj);
    if (state.waypoints.length > 1) {
      state.segmentModes.push(state.selectedMode || 'kurvig');
    }
  } else {
    state.waypoints.splice(targetIndex, 0, waypointObj);
    state.segmentModes.splice(targetIndex, 0, state.selectedMode || 'kurvig');
  }

  syncSegmentModes();
  updateMarkerLabels();
  renderWaypointsList();

  if (state.waypoints.length >= 2) {
    calculateRoute();
  }
}

/**
 * 'als Start' setzen:
 * Fuegt den Punkt an den Anfang ein (neuer Startpunkt)
 */
function addWaypointAsStart(lng, lat) {
  insertWaypointAt(lng, lat, 0);
}

/**
 * 'als Via' setzen:
 * Fuegt den Punkt zwischen Start und Ziel ein (bzw. vor das letzte Ziel)
 */
function addWaypointAsVia(lng, lat) {
  if (state.waypoints.length >= 2) {
    insertWaypointAt(lng, lat, state.waypoints.length - 1);
  } else {
    insertWaypointAt(lng, lat, state.waypoints.length);
  }
}

/**
 * 'als Ziel' setzen:
 * Fuegt den Punkt am Ende an
 */
function addWaypointAsZiel(lng, lat) {
  insertWaypointAt(lng, lat, state.waypoints.length);
}

/**
 * Standard-Hinzufuegen (z.B. URL-Parameter)
 */
function addWaypoint(lng, lat) {
  insertWaypointAt(lng, lat, state.waypoints.length);
}

/**
 * Verschiebt einen Wegpunkt innerhalb der Liste
 */
function moveWaypoint(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.waypoints.length || toIndex >= state.waypoints.length) return;
  const [moved] = state.waypoints.splice(fromIndex, 1);
  state.waypoints.splice(toIndex, 0, moved);
  syncSegmentModes();
  updateMarkerLabels();
  renderWaypointsList();
  if (state.waypoints.length >= 2) {
    calculateRoute();
  }
}

/**
 * Entfernt einen einzelnen Wegpunkt anhand seines Index
 */
function removeWaypoint(index) {
  if (index < 0 || index >= state.waypoints.length) return;

  state.waypoints[index].marker.remove();
  state.waypoints.splice(index, 1);
  if (state.segmentModes.length > 0) {
    const segIdxToRemove = Math.min(index, state.segmentModes.length - 1);
    state.segmentModes.splice(segIdxToRemove, 1);
  }
  syncSegmentModes();

  updateMarkerLabels();
  renderWaypointsList();

  if (state.waypoints.length >= 2) {
    calculateRoute();
  } else {
    cancelRunningCalculation();
    clearRouteLayer();
    hideStatus();
  }
}

/**
 * Aktualisiert die Beschriftung und Farbgebung der Karten-Marker
 * Start = "Start" (grün), Ziel = "Ziel" (rot), Via = "1", "2"... (orange)
 */
function updateMarkerLabels() {
  const total = state.waypoints.length;
  state.waypoints.forEach((wp, idx) => {
    const container = wp.marker.getElement();
    const pin = container.querySelector('.custom-map-pin') || container;
    pin.className = 'custom-map-pin';

    if (idx === 0) {
      pin.classList.add('marker-start');
      pin.innerText = 'Start';
    } else if (idx === total - 1 && total > 1) {
      pin.classList.add('marker-end');
      pin.innerText = 'Ziel';
    } else {
      pin.classList.add('marker-via');
      pin.innerText = String(idx);
    }
  });
}

/**
 * Ändert das Profil für ein einzelnes Strecken-Segment
 */
function setSegmentMode(segmentIndex, modeKey) {
  if (segmentIndex < 0 || segmentIndex >= state.segmentModes.length) return;
  state.segmentModes[segmentIndex] = modeKey;
  if (state.waypoints.length >= 2) {
    calculateRoute();
  }
}

/**
 * Berechnet großzügig den Einfügeslot (0 bis items.length) basierend auf der vertikalen Position (Maus oder Touch).
 * Deckt den gesamten Bereich kontinuierlich ab (inklusive Konnektoren und Zwischenräume),
 * sodass keine toten Zonen entstehen und die orange Linie stabil sichtbar bleibt.
 */
function calculateGenerousDropSlot(listElement, clientY) {
  if (!listElement) return 0;
  const items = Array.from(listElement.querySelectorAll('.waypoint-item'));
  if (items.length === 0) return 0;

  // Mittelpunkte aller Wegpunkte ermitteln
  const mids = items.map(el => {
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2;
  });

  // Oberhalb des ersten Wegpunkts: Slot 0 (ganz oben)
  if (clientY < mids[0]) {
    return 0;
  }

  // Unterhalb des letzten Wegpunkts: Slot = items.length (ganz unten)
  if (clientY >= mids[mids.length - 1]) {
    return items.length;
  }

  // Zwischen zwei Wegpunkten (deckt auch den Abschnitts-Wähler / Konnektor vollständig ab)
  for (let k = 0; k < mids.length - 1; k++) {
    if (clientY >= mids[k] && clientY < mids[k + 1]) {
      return k + 1;
    }
  }

  return items.length;
}

/**
 * Wandelt den Einfügeslot (0 .. N) in den passenden Zielindex für moveWaypoint(fromIndex, toIndex) um.
 */
function slotToTargetIndex(slot, fromIndex, totalItems) {
  if (fromIndex === null || fromIndex === undefined || totalItems <= 1) {
    return slot;
  }
  if (slot <= fromIndex) {
    return slot;
  }
  return Math.min(totalItems - 1, slot - 1);
}

/**
 * Entfernt alle Drag-Over- und Drop-Klassen aus der Wegpunkt-Liste.
 */
function clearAllDropIndicators(listElement) {
  if (!listElement) return;
  listElement.querySelectorAll('.waypoint-item').forEach(item => {
    item.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  listElement.querySelectorAll('.segment-connector').forEach(conn => {
    conn.classList.remove('is-drop-target');
  });
}

/**
 * Aktualisiert die visuelle Anzeige der auffälligen orangefarbenen Einfügelinie.
 */
function updateDropIndicatorUI(listElement, slot, fromIndex) {
  clearAllDropIndicators(listElement);
  if (slot === null || slot === undefined || !listElement) return;

  const items = Array.from(listElement.querySelectorAll('.waypoint-item'));
  const connectors = Array.from(listElement.querySelectorAll('.segment-connector'));
  if (items.length === 0) return;

  if (slot === 0) {
    if (items[0]) items[0].classList.add('drag-over-top');
  } else if (slot >= items.length) {
    if (items[items.length - 1]) items[items.length - 1].classList.add('drag-over-bottom');
  } else {
    // Einfügen zwischen item slot-1 und item slot
    if (items[slot]) items[slot].classList.add('drag-over-top');
    if (connectors[slot - 1]) connectors[slot - 1].classList.add('is-drop-target');
  }
}

/**
 * Rendert die Wegpunkteliste in der Seitenleiste mit großzügigem Touch-Drag & Drop,
 * Sortierknöpfen und interaktiven Abschnitts-Profilwählern zwischen den Wegpunkten
 */
function renderWaypointsList() {
  const list = domElements.waypointsList;
  const emptyHint = domElements.emptyWaypointsHint;

  if (!list) return;
  list.innerHTML = '';

  const total = state.waypoints.length;
  syncSegmentModes();

  if (total === 0) {
    if (emptyHint) emptyHint.style.display = 'block';
    if (domElements.btnCalculate) domElements.btnCalculate.disabled = true;
    if (domElements.btnShareRoute) domElements.btnShareRoute.disabled = true;
    return;
  }

  if (emptyHint) emptyHint.style.display = 'none';
  if (domElements.btnCalculate) {
    domElements.btnCalculate.disabled = total < 2;
  }
  if (domElements.btnShareRoute) {
    domElements.btnShareRoute.disabled = total < 2;
  }

  // Container-Level Dragover & Drop für unterbrechungsfreies Ziehen
  if (!list._dragListenersAttached) {
    list._dragListenersAttached = true;
    list.addEventListener('dragover', (e) => {
      if (draggedWaypointIndex === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const slot = calculateGenerousDropSlot(list, e.clientY);
      updateDropIndicatorUI(list, slot, draggedWaypointIndex);
    });

    list.addEventListener('drop', (e) => {
      if (draggedWaypointIndex === null) return;
      e.preventDefault();
      const slot = calculateGenerousDropSlot(list, e.clientY);
      clearAllDropIndicators(list);
      const fromIdx = draggedWaypointIndex;
      const toIdx = slotToTargetIndex(slot, fromIdx, state.waypoints.length);
      if (fromIdx !== null && toIdx !== null && fromIdx !== toIdx) {
        moveWaypoint(fromIdx, toIdx);
      }
      draggedWaypointIndex = null;
    });
  }

  state.waypoints.forEach((wp, index) => {
    // 1. Wenn nicht erster Wegpunkt: Profil-Wähler für den Abschnitt davor einfügen
    if (index > 0) {
      const segIndex = index - 1;
      const currentSegMode = state.segmentModes[segIndex] || state.selectedMode || 'kurvig';
      
      const connectorEl = document.createElement('div');
      connectorEl.className = 'segment-connector';
      connectorEl.innerHTML = `
        <div class="segment-connector-content">
          <span class="segment-label">Abschnitt ${segIndex + 1}:</span>
          <select class="segment-mode-select" data-seg-index="${segIndex}" title="Profil für diesen Streckenabschnitt anpassen">
            <option value="schnellste" ${currentSegMode === 'schnellste' ? 'selected' : ''}>🚀 Schnellste</option>
            <option value="schnell" ${currentSegMode === 'schnell' ? 'selected' : ''}>💨 Schnell</option>
            <option value="kurvig" ${currentSegMode === 'kurvig' ? 'selected' : ''}>🏍️ Kurvig</option>
            <option value="extra_kurvig" ${currentSegMode === 'extra_kurvig' ? 'selected' : ''}>⚡ Extra kurvig</option>
          </select>
        </div>
      `;

      const selectEl = connectorEl.querySelector('.segment-mode-select');
      selectEl.addEventListener('change', (e) => {
        setSegmentMode(segIndex, e.target.value);
      });

      // Lückenlose Drag-Zonen auch über Konnektoren hinweg
      connectorEl.addEventListener('dragover', (e) => {
        if (draggedWaypointIndex === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const slot = calculateGenerousDropSlot(list, e.clientY);
        updateDropIndicatorUI(list, slot, draggedWaypointIndex);
      });

      connectorEl.addEventListener('drop', (e) => {
        if (draggedWaypointIndex === null) return;
        e.preventDefault();
        const slot = calculateGenerousDropSlot(list, e.clientY);
        clearAllDropIndicators(list);
        const fromIdx = draggedWaypointIndex;
        const toIdx = slotToTargetIndex(slot, fromIdx, total);
        if (fromIdx !== null && toIdx !== null && fromIdx !== toIdx) {
          moveWaypoint(fromIdx, toIdx);
        }
        draggedWaypointIndex = null;
      });

      list.appendChild(connectorEl);
    }

    // 2. Wegpunkt-Zeile
    const li = document.createElement('li');
    li.className = 'waypoint-item is-draggable';
    li.draggable = true;
    li.dataset.index = String(index);

    let roleLabel = '';
    let badgeClass = '';
    let badgeText = '';

    if (index === 0) {
      roleLabel = 'Start';
      badgeClass = 'marker-start';
      badgeText = 'Start';
    } else if (index === total - 1 && total > 1) {
      roleLabel = 'Ziel';
      badgeClass = 'marker-end';
      badgeText = 'Ziel';
    } else {
      roleLabel = `Via ${index}`;
      badgeClass = 'marker-via';
      badgeText = String(index);
    }

    // Großzügiger Drag-Bereich (.waypoint-drag-zone): umfasst Handle, Badge, Text ("VIA", "Start", "Ziel") und Koordinaten
    li.innerHTML = `
      <div class="waypoint-drag-zone" title="Wegpunkt gedrückt halten zum Verschieben">
        <span class="waypoint-drag-handle" aria-hidden="true">⠿</span>
        <span class="waypoint-badge ${badgeClass}">${badgeText}</span>
        <span class="waypoint-label">${roleLabel}</span>
        <span class="waypoint-coords" title="${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}">
          ${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}
        </span>
      </div>
      <div class="waypoint-reorder-actions">
        <button type="button" class="btn-move-wp btn-move-up" title="Nach oben verschieben" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="btn-move-wp btn-move-down" title="Nach unten verschieben" ${index === total - 1 ? 'disabled' : ''}>▼</button>
      </div>
      <button type="button" class="btn-remove-wp" title="Wegpunkt entfernen" aria-label="${roleLabel} entfernen">
        &times;
      </button>
    `;

    // Up / Down Knöpfe
    const btnUp = li.querySelector('.btn-move-up');
    if (btnUp) {
      btnUp.addEventListener('click', (e) => {
        e.stopPropagation();
        moveWaypoint(index, index - 1);
      });
    }

    const btnDown = li.querySelector('.btn-move-down');
    if (btnDown) {
      btnDown.addEventListener('click', (e) => {
        e.stopPropagation();
        moveWaypoint(index, index + 1);
      });
    }

    // Entfernen-Knopf
    const btnRemove = li.querySelector('.btn-remove-wp');
    btnRemove.addEventListener('click', (e) => {
      e.stopPropagation();
      removeWaypoint(index);
    });

    // --- Touch Drag & Drop für mobile Geräte (Smartphones / Tablets) ---
    const dragZone = li.querySelector('.waypoint-drag-zone');
    let touchTimer = null;
    let isTouchDraggingThis = false;
    let touchStartPos = { x: 0, y: 0 };

    if (dragZone) {
      const onWindowTouchMove = (e) => {
        if (!isTouchDraggingThis || !e.touches || e.touches.length === 0) return;
        if (e.cancelable) e.preventDefault();
        const slot = calculateGenerousDropSlot(list, e.touches[0].clientY);
        updateDropIndicatorUI(list, slot, index);
      };

      const finishTouchDrag = (e) => {
        window.removeEventListener('touchmove', onWindowTouchMove);
        window.removeEventListener('touchend', finishTouchDrag);
        window.removeEventListener('touchcancel', finishTouchDrag);

        if (touchTimer) {
          clearTimeout(touchTimer);
          touchTimer = null;
        }

        if (isTouchDraggingThis) {
          isTouchDraggingThis = false;
          li.classList.remove('is-dragging');
          document.body.style.userSelect = '';
          document.body.style.webkitUserSelect = '';

          let endY = touchStartPos.y;
          if (e && e.changedTouches && e.changedTouches.length > 0) {
            endY = e.changedTouches[0].clientY;
          }
          const finalSlot = calculateGenerousDropSlot(list, endY);
          clearAllDropIndicators(list);

          const toIndex = slotToTargetIndex(finalSlot, index, total);
          if (toIndex !== null && toIndex !== index) {
            moveWaypoint(index, toIndex);
          }
          draggedWaypointIndex = null;
        }
      };

      dragZone.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        isTouchDraggingThis = false;

        touchTimer = setTimeout(() => {
          isTouchDraggingThis = true;
          draggedWaypointIndex = index;
          li.classList.add('is-dragging');
          document.body.style.userSelect = 'none';
          document.body.style.webkitUserSelect = 'none';

          if (navigator.vibrate) {
            try { navigator.vibrate(35); } catch (_) {}
          }

          const slot = calculateGenerousDropSlot(list, touchStartPos.y);
          updateDropIndicatorUI(list, slot, index);

          window.addEventListener('touchmove', onWindowTouchMove, { passive: false });
          window.addEventListener('touchend', finishTouchDrag, { passive: true });
          window.addEventListener('touchcancel', finishTouchDrag, { passive: true });
        }, 180);
      }, { passive: true });

      dragZone.addEventListener('touchmove', (e) => {
        if (e.touches.length === 0) return;
        if (touchTimer && !isTouchDraggingThis) {
          const dx = Math.abs(e.touches[0].clientX - touchStartPos.x);
          const dy = Math.abs(e.touches[0].clientY - touchStartPos.y);
          if (dx > 10 || dy > 10) {
            clearTimeout(touchTimer);
            touchTimer = null;
          }
        }
      }, { passive: true });

      dragZone.addEventListener('touchend', () => {
        if (touchTimer && !isTouchDraggingThis) {
          clearTimeout(touchTimer);
          touchTimer = null;
        }
      }, { passive: true });

      dragZone.addEventListener('touchcancel', () => {
        if (touchTimer && !isTouchDraggingThis) {
          clearTimeout(touchTimer);
          touchTimer = null;
        }
      }, { passive: true });
    }

    // --- HTML5 Drag & Drop Events (Maus / Desktop) ---
    li.addEventListener('dragstart', (e) => {
      if (touchTimer) {
        clearTimeout(touchTimer);
        touchTimer = null;
      }
      isTouchDraggingThis = false;
      draggedWaypointIndex = index;
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    });

    li.addEventListener('dragend', () => {
      li.classList.remove('is-dragging');
      clearAllDropIndicators(list);
      draggedWaypointIndex = null;
    });

    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const slot = calculateGenerousDropSlot(list, e.clientY);
      updateDropIndicatorUI(list, slot, draggedWaypointIndex);
    });

    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const slot = calculateGenerousDropSlot(list, e.clientY);
      clearAllDropIndicators(list);
      const fromIdx = draggedWaypointIndex;
      const toIdx = slotToTargetIndex(slot, fromIdx, total);
      if (fromIdx !== null && toIdx !== null && fromIdx !== toIdx) {
        moveWaypoint(fromIdx, toIdx);
      }
      draggedWaypointIndex = null;
    });

    list.appendChild(li);
  });
}

/**
 * Loescht alle Wegpunkte und die aktuelle Route
 */
function clearAllWaypointsAndRoute() {
  cancelRunningCalculation();
  closeContextMenu();
  state.waypoints.forEach(wp => wp.marker.remove());
  state.waypoints = [];
  state.segmentModes = [];
  state.currentRouteGeoJSON = null;
  state.currentRouteProperties = null;

  segmentCache.clear();

  renderWaypointsList();
  clearRouteLayer();
  hideStatus();
  if (domElements.routeSummaryBox) {
    domElements.routeSummaryBox.classList.remove('is-visible');
  }
}

// ==========================================================================
// 6. ROUTENBERECHNUNG (BRouter API)
// ==========================================================================

/**
 * Richtet die schemenhafte Europa-Hintergrundebene als Fallback unter allen Vektorkacheln ein
 */
function setupEuropaBackgroundLayer() {
  if (map.getSource('europa-source')) return;

  // Hintergrundfarbe der Karte (Meer/Wasser) auf ein klares, sanftes Hellblau (#D8E8F8) setzen
  if (map.getLayer('background')) {
    map.setPaintProperty('background', 'background-color', '#D8E8F8');
  }

  // Zusätzliche GeoJSON-Quelle mit europäischen Landmassen und separaten Staatsgrenzen
  map.addSource('europa-source', {
    type: 'geojson',
    data: EUROPA_GEOJSON_URL
  });

  // Erste vorhandene Ebene nach 'background' ermitteln, um die Ebenen direkt darüber einzufügen
  const layers = map.getStyle().layers || [];
  let firstLayerId = null;
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].type !== 'background') {
      firstLayerId = layers[i].id;
      break;
    }
  }

  // Falls der Vektorstil keinen Background-Layer hatte, Basisebene für Wasser einfügen
  if (!map.getLayer('background') && !map.getLayer('europa-water-background')) {
    map.addLayer({
      id: 'europa-water-background',
      type: 'background',
      paint: {
        'background-color': '#D8E8F8'
      }
    }, firstLayerId);
  }

  // 1. Füllebene: Land- und Küstenflächen (#FDFBF7 - noch hellerer, weißerer Hintergrund mit dezentem warmen Beige)
  map.addLayer({
    id: 'europa-land-fill',
    type: 'fill',
    source: 'europa-source',
    filter: ['match', ['get', 'class'], ['land', 'coastline'], true, false],
    paint: {
      'fill-color': '#FDFBF7',
      'fill-outline-color': '#FDFBF7',
      'fill-antialias': true
    }
  }, firstLayerId);

  // 2. Linienebene: Binnengrenzen / Länderlinien (gestrichelt, weiches Schiefergrau #9DA8B3)
  // Als separate Schicht gerendert – verhindert Doppel-Linien-Effekte zwischen Nachbarstaaten
  map.addLayer({
    id: 'europa-land-borders',
    type: 'line',
    source: 'europa-source',
    filter: ['==', ['get', 'class'], 'boundary'],
    layout: {
      'line-join': 'round',
      'line-cap': 'round'
    },
    paint: {
      'line-color': '#9DA8B3',
      'line-opacity': 0.7,
      'line-width': 0.9,
      'line-dasharray': [3, 2]
    }
  }, firstLayerId);

  // Harmonisierung vorhandener Gewässer- und Grenzschichten im Vektorstil
  // Wellenmuster und Kachel-Offsets deaktivieren für eine absolut ruhige, gleichmäßige Wasserfläche
  if (map.getLayer('water-pattern')) {
    map.setLayoutProperty('water-pattern', 'visibility', 'none');
  }
  if (map.getLayer('water-offset')) {
    map.setLayoutProperty('water-offset', 'visibility', 'none');
  }
  if (map.getLayer('water')) {
    map.setPaintProperty('water', 'fill-color', '#D8E8F8');
  }
  if (map.getLayer('water-intermittent')) {
    map.setPaintProperty('water-intermittent', 'fill-color', '#D8E8F8');
  }
  if (map.getLayer('boundary-land-level-2')) {
    map.setPaintProperty('boundary-land-level-2', 'line-color', '#9DA8B3');
    map.setPaintProperty('boundary-land-level-2', 'line-opacity', 0.7);
    map.setPaintProperty('boundary-land-level-2', 'line-dasharray', [3, 2]);
  }
  if (map.getLayer('boundary-water')) {
    map.setLayoutProperty('boundary-water', 'visibility', 'none');
  }
}

/**
 * Richtet die MapLibre-Vektor-Layer fuer die Routenanzeige ein
 */
function setupRouteLayers() {
  if (map.getSource('route-source')) return;

  map.addSource('route-source', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  // Unterer weisser Rand (Casing) fuer optimale Sichtbarkeit auf jedem Untergrund
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route-source',
    layout: {
      'line-join': 'round',
      'line-cap': 'round'
    },
    paint: {
      'line-color': '#ffffff',
      'line-width': 8,
      'line-opacity': 0.95
    }
  });

  // Hauptlinie in dunklem Orange
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route-source',
    layout: {
      'line-join': 'round',
      'line-cap': 'round'
    },
    paint: {
      'line-color': '#d94800',
      'line-width': 5,
      'line-opacity': 1.0
    }
  });
}

/**
 * Loescht die Route auf der Karte
 */
function clearRouteLayer() {
  if (map && map.getSource('route-source')) {
    map.getSource('route-source').setData({
      type: 'FeatureCollection',
      features: []
    });
  }
  if (domElements.routeSummaryBox) {
    domElements.routeSummaryBox.classList.remove('is-visible');
  }
}

/**
 * Baut die BRouter-Anfrage-URL zusammen
 */
function buildBRouterUrl(waypoints, profileId, params = null) {
  const lonlatsParam = waypoints
    .map(wp => `${wp.lng.toFixed(6)},${wp.lat.toFixed(6)}`)
    .join('|');

  let url = `${ROUTING_SERVICE_URL}?lonlats=${encodeURIComponent(lonlatsParam)}&profile=${encodeURIComponent(profileId)}&format=geojson`;

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url += `&profile:${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }
  }

  return url;
}

/**
 * Baut die BRouter-Anfrage-URL fuer ein Segment zwischen zwei Wegpunkten zusammen
 */
function getSegmentUrl(wpA, wpB, modeKey) {
  const modeParams = MODE_PARAMETERS[modeKey] || MODE_PARAMETERS.kurvig;
  return buildBRouterUrl([wpA, wpB], PROFILE_ID, modeParams);
}

// Zwischenspeicher fuer Segmente (Map auf Modulebene: Schluessel = vollstaendige BRouter-URL, Wert = geparste GeoJSON-Antwort)
const MAX_SEGMENT_CACHE_SIZE = 100;
const segmentCache = new Map();

/**
 * Speichert ein berechnetes Segment im Zwischenspeicher (max. 100 Eintraege, aeltester faellt raus)
 */
function saveToSegmentCache(url, data) {
  if (segmentCache.has(url)) {
    segmentCache.delete(url);
  } else if (segmentCache.size >= MAX_SEGMENT_CACHE_SIZE) {
    const oldestKey = segmentCache.keys().next().value;
    segmentCache.delete(oldestKey);
  }
  segmentCache.set(url, data);
}

// ==========================================================================
// 6a. LERNENDE RESTZEIT-SCHÄTZUNG & BERECHNUNGS-STATISTIK
// ==========================================================================

const STATS_STORAGE_KEY = 'motoalex_calc_stats';
const DEFAULT_GRUNDLAST = 5.0; // 5 Sekunden Startwert
const DEFAULT_FAKTOR = 0.015;  // 0.015 Startwert

// Standardwerte für Grundlast & Startfaktor je Modus
const MODE_CALC_CONFIG = {
  kurvig: { grundlast: 5.0, defaultFaktor: 0.015 },
  schnell: { grundlast: 5.0, defaultFaktor: 0.015 },
  schnellste: { grundlast: 5.0, defaultFaktor: 0.015 },
  extra_kurvig: { grundlast: 5.0, defaultFaktor: 0.015 }
};

/**
 * Berechnet die Großkreis-Luftliniendistanz zwischen zwei Koordinaten in Kilometern
 */
function getHaversineDistanceKm(coordA, coordB) {
  const R = 6371; // Erdradius in km
  const dLat = (coordB.lat - coordA.lat) * (Math.PI / 180);
  const dLng = (coordB.lng - coordA.lng) * (Math.PI / 180);
  const lat1 = coordA.lat * (Math.PI / 180);
  const lat2 = coordB.lat * (Math.PI / 180);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Berechnet die Summe aller Luftlinien der Segmente in Kilometern
 */
function calculateTotalAirDistanceKm(waypoints) {
  let totalKm = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    totalKm += getHaversineDistanceKm(waypoints[i], waypoints[i + 1]);
  }
  return totalKm;
}

/**
 * Lädt die Berechnungsstatistiken aus dem localStorage
 */
function getCalcStats() {
  try {
    const raw = localStorage.getItem(STATS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * Speichert die Berechnungsstatistiken in den localStorage
 */
function saveCalcStats(stats) {
  try {
    localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(stats));
  } catch (err) {
    console.warn('Fehler beim Speichern von motoalex_calc_stats:', err);
  }
}

/**
 * Speichert je Modus die letzten 20 Messungen als Paare aus km und Sekunden.
 * Messungen unter 300 ms sind Treffer im Servercache und werden nicht gespeichert.
 */
function recordCalculationMeasurement(mode, km, seconds) {
  // Messungen unter 300 ms (Servercache) werden nicht gespeichert
  if (!seconds || seconds * 1000 < 300) {
    return;
  }
  if (!km || km <= 0 || seconds <= 0) {
    return;
  }

  const modeKey = mode || 'kurvig';
  const allStats = getCalcStats();
  const list = Array.isArray(allStats[modeKey]) ? allStats[modeKey] : [];

  list.push({
    km: Math.round(km * 100) / 100,
    s: Math.round(seconds * 1000) / 1000
  });

  // Nur die letzten 20 Messungen je Modus behalten
  while (list.length > 20) {
    list.shift();
  }

  allStats[modeKey] = list;
  saveCalcStats(allStats);
}

/**
 * Leitet den Faktor aus dem Median der Messungen ab (Dauer = Grundlast + Faktor * km^1.3)
 */
function getLearnedFactorForMode(mode) {
  const modeKey = mode || 'kurvig';
  const config = MODE_CALC_CONFIG[modeKey] || { grundlast: DEFAULT_GRUNDLAST, defaultFaktor: DEFAULT_FAKTOR };
  const allStats = getCalcStats();
  const list = allStats[modeKey];

  if (!Array.isArray(list) || list.length === 0) {
    return config.defaultFaktor;
  }

  const impliedFactors = [];
  for (const item of list) {
    let km = 0;
    let s = 0;
    if (typeof item === 'object' && item !== null) {
      km = typeof item.km === 'number' ? item.km : (Array.isArray(item) ? item[0] : 0);
      s = typeof item.s === 'number' ? item.s : (Array.isArray(item) ? item[1] : 0);
    }
    // Messungen, bei denen die gemessene Zeit kleiner oder gleich der Grundlast ist,
    // werden übersprungen und fließen nicht in den Median ein.
    if (km <= 0 || s <= config.grundlast) {
      continue;
    }

    const denom = Math.pow(km, 1.3);
    if (denom > 0) {
      const factor = (s - config.grundlast) / denom;
      impliedFactors.push(factor);
    }
  }

  // Bleibt danach keine Messung übrig, gilt der Standardfaktor des Modus
  if (impliedFactors.length === 0) {
    return config.defaultFaktor;
  }

  // Median berechnen (nicht Mittelwert)
  impliedFactors.sort((a, b) => a - b);
  const mid = Math.floor(impliedFactors.length / 2);
  const medianFactor = (impliedFactors.length % 2 !== 0)
    ? impliedFactors[mid]
    : (impliedFactors[mid - 1] + impliedFactors[mid]) / 2;

  return medianFactor;
}

/**
 * Liefert die Grundlast für einen Modus
 */
function getGrundlastForMode(mode) {
  const modeKey = mode || 'kurvig';
  return MODE_CALC_CONFIG[modeKey]?.grundlast ?? DEFAULT_GRUNDLAST;
}

/**
 * Schätzung vor dem Start:
 * Schätzt nur noch die Segmente, die tatsächlich neu abgerufen werden (nicht im Zwischenspeicher).
 * Setzt die Grundlast nur einmal je Berechnung an, nicht je Segment:
 * Dauer = Grundlast + Summe über alle neu zu rechnenden Segmente aus Faktor * Segmentluftlinie^1.3.
 * Liegen alle Segmente im Speicher, wird die Fortschrittsanzeige gar nicht erst gestartet.
 */
function estimateRouteCalculationSeconds(waypoints, segmentModes, segmentUrls = null, defaultMode = 'kurvig') {
  if (!waypoints || waypoints.length < 2) {
    return {
      durationSeconds: DEFAULT_GRUNDLAST,
      totalAirKm: 0,
      allCached: false,
      uncachedCount: 0,
      mode: defaultMode
    };
  }

  // Segment-URLs ermitteln, falls nicht explizit übergeben
  const urls = Array.isArray(segmentUrls) ? segmentUrls : [];
  if (urls.length === 0) {
    for (let i = 0; i < waypoints.length - 1; i++) {
      const mode = (segmentModes && segmentModes[i]) || defaultMode;
      urls.push(getSegmentUrl(waypoints[i], waypoints[i + 1], mode));
    }
  }

  // Ermittle Segmente, die tatsächlich neu berechnet werden müssen
  const uncachedIndices = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const url = urls[i];
    if (!url || !segmentCache.has(url)) {
      uncachedIndices.push(i);
    }
  }

  // Liegen alle Segmente im Speicher, wird die Fortschrittsanzeige gar nicht erst gestartet
  if (uncachedIndices.length === 0) {
    return {
      durationSeconds: 0,
      totalAirKm: 0,
      allCached: true,
      uncachedCount: 0,
      mode: defaultMode
    };
  }

  // Grundlast nur einmal je Berechnung ansetzen, nicht je Segment
  const firstUncachedMode = (segmentModes && segmentModes[uncachedIndices[0]]) || defaultMode;
  const grundlast = getGrundlastForMode(firstUncachedMode);

  let summe = 0;
  let totalUncachedAirKm = 0;

  for (const idx of uncachedIndices) {
    const wpA = waypoints[idx];
    const wpB = waypoints[idx + 1];
    const segMode = (segmentModes && segmentModes[idx]) || defaultMode;
    const segKm = getHaversineDistanceKm(wpA, wpB);
    const faktor = getLearnedFactorForMode(segMode);

    totalUncachedAirKm += segKm;
    summe += faktor * Math.pow(segKm, 1.3);
  }

  const duration = grundlast + summe;

  return {
    durationSeconds: Math.max(1.0, duration),
    totalAirKm: totalUncachedAirKm,
    allCached: false,
    uncachedCount: uncachedIndices.length,
    mode: firstUncachedMode
  };
}

// ==========================================================================
// 6b. NEBENLÄUFIGKEIT & RESTZEITANZEIGE (FORTSCHRITTS-PILLE)
// ==========================================================================

let currentCalculationId = 0;
let currentCalculationAbortController = null;

let isProgressActive = false;
let progressStartTime = 0;
let progressEstimatedDurationMs = 5000;
let progressAnimFrame = null;
let currentProgressPercent = 0;

/**
 * Startet oder aktualisiert die Fortschrittsanzeige in der Pille
 * (ohne Flackern oder Ein-/Ausblenden bei laufender Berechnung)
 */
function startOrUpdateCalculationProgress(estimatedSeconds) {
  const estimatedMs = Math.max(800, estimatedSeconds * 1000);
  progressEstimatedDurationMs = estimatedMs;
  progressStartTime = performance.now();

  const banner = domElements.statusBanner;
  if (!banner) return;

  if (!isProgressActive) {
    isProgressActive = true;
    currentProgressPercent = 0;
    banner.className = 'status-banner is-loading has-progress';
    banner.style.display = 'block';
    banner.style.padding = '0';
    banner.style.position = 'relative';
    banner.style.overflow = 'hidden';
    banner.style.backgroundColor = '#1a1a1a';
    banner.innerHTML = `
      <div class="status-progress-fill" id="status-progress-fill" style="position: absolute; top: 0; bottom: 0; left: 0; height: 100%; width: 0%; background: linear-gradient(90deg, rgba(255, 85, 0, 0.28) 0%, rgba(255, 115, 30, 0.42) 100%); border-right: 2px solid #ff7733; box-shadow: 2px 0 10px rgba(255, 85, 0, 0.45); pointer-events: none; z-index: 1; transition: width 0.12s linear;"></div>
      <div class="status-banner-content" style="position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; height: 100%; min-height: 40px; padding: 10px 12px; box-sizing: border-box; white-space: nowrap; pointer-events: none;">
        <div class="status-banner-main" style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; overflow: hidden;">
          <span class="status-banner-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #ff5500; box-shadow: 0 0 6px #ff5500; flex-shrink: 0;"></span>
          <span class="status-banner-text" style="color: #ffffff; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">Berechne optimale Route</span>
        </div>
        <span class="status-banner-percent" id="status-banner-percent" style="font-family: monospace; font-weight: 700; color: #ffffff; font-size: 13px; flex-shrink: 0; text-align: right; min-width: 38px; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">0%</span>
      </div>
    `;
  } else {
    // Bei einer neuen Berechnung während einer laufenden bleibt die Anzeige sichtbar
    // und wird nur mit der neuen Schätzung neu befüllt, kein Aus- und Einblenden, kein Flackern.
    currentProgressPercent = 0;
    updateProgressUI(0);
  }

  if (progressAnimFrame) {
    cancelAnimationFrame(progressAnimFrame);
    progressAnimFrame = null;
  }

  function tick() {
    if (!isProgressActive) return;

    const elapsed = performance.now() - progressStartTime;
    // Fortschrittsberechnung bis max. 95%
    // Läuft die Zeit über die Schätzung, bleibt die Linie bei 95 Prozent stehen.
    const ratio = Math.min(1.0, elapsed / progressEstimatedDurationMs);
    const targetPercent = Math.min(95, Math.floor(ratio * 95));

    currentProgressPercent = targetPercent;
    updateProgressUI(currentProgressPercent);

    if (elapsed < progressEstimatedDurationMs) {
      progressAnimFrame = requestAnimationFrame(tick);
    } else {
      currentProgressPercent = 95;
      updateProgressUI(95);
    }
  }

  progressAnimFrame = requestAnimationFrame(tick);
}

/**
 * Aktualisiert die visuelle Füllung und den Prozenttext
 */
function updateProgressUI(percent) {
  const fillEl = document.getElementById('status-progress-fill');
  const percentEl = document.getElementById('status-banner-percent');
  if (fillEl) fillEl.style.width = `${percent}%`;
  if (percentEl) percentEl.textContent = `${percent}%`;
}

/**
 * Schließt die Berechnung mit 100% ab und blendet die Pille nach kurzem Moment aus
 */
function finishCalculationProgress(onComplete) {
  if (!isProgressActive) {
    if (onComplete) onComplete();
    return;
  }

  if (progressAnimFrame) {
    cancelAnimationFrame(progressAnimFrame);
    progressAnimFrame = null;
  }

  updateProgressUI(100);

  setTimeout(() => {
    stopCalculationProgress();
    if (onComplete) onComplete();
  }, 220);
}

/**
 * Beendet die Fortschrittsanzeige sofort
 */
function stopCalculationProgress() {
  if (progressAnimFrame) {
    cancelAnimationFrame(progressAnimFrame);
    progressAnimFrame = null;
  }
  isProgressActive = false;
  currentProgressPercent = 0;
  const banner = domElements.statusBanner;
  if (banner && banner.classList.contains('has-progress')) {
    banner.style.display = 'none';
    banner.style.padding = '';
    banner.style.backgroundColor = '';
    banner.style.position = '';
    banner.style.overflow = '';
    banner.className = 'status-banner';
    banner.innerHTML = '';
  }
}

/**
 * Bricht eine laufende Routenberechnung und deren AbortController ab
 */
function cancelRunningCalculation() {
  if (currentCalculationAbortController) {
    try {
      currentCalculationAbortController.abort();
    } catch (_) {}
    currentCalculationAbortController = null;
  }
  currentCalculationId++;
  stopCalculationProgress();
  state.isLoading = false;
}

/**
 * Ermittelt eine lesbare Bezeichnung fuer einen Wegpunkt anhand seines Index.
 * 0 -> Start, letzter -> Ziel, dazwischen -> Zwischenziel N
 */
function getWaypointLabel(index, total) {
  if (index <= 0) return 'Start';
  if (index >= total - 1) return 'Ziel';
  return `Zwischenziel ${index}`;
}

/**
 * Uebersetzt Fehler des BRouter-Servers oder des Netzwerks in kurze,
 * praegnante und anwenderfreundliche deutsche Meldungen ohne technische HTTP-Codes.
 */
function parseRoutingError(status, errorText = '', waypoints = [], segmentIndex = 0, totalWaypoints = null) {
  const total = totalWaypoints || (waypoints.length || 2);
  const text = (errorText || '').toLowerCase();

  // 1. Berechnungs-Timeout / Server ueberlastet
  if (
    status === 504 || status === 408 || status === 502 || status === 503 || status === 500 ||
    text.includes('timeout') || text.includes('timed out') || text.includes('time-out')
  ) {
    return 'Server antwortet nicht: Bitte Teilstrecke kürzen oder erneut versuchen';
  }

  // 2. Sperrbereich / No-Go-Zone
  if (text.includes('nogo') || text.includes('sperr') || text.includes('forbidden') || text.includes('blocked')) {
    return 'Route blockiert: Gesperrter Bereich kann nicht umfahren werden';
  }

  // 3. Tile nicht gefunden (datafile ... not found z. B. bei Punkten im Meer / ausserhalb)
  const tileMatches = [...(errorText || '').matchAll(/datafile\s+([EW])(\d+)_([NS])(\d+)/gi)];
  if (tileMatches.length > 0) {
    const badIndices = [];
    tileMatches.forEach(tileMatch => {
      const isEast = tileMatch[1].toUpperCase() === 'E';
      const tileLon = parseInt(tileMatch[2], 10) * (isEast ? 1 : -1);
      const isNorth = tileMatch[3].toUpperCase() === 'N';
      const tileLat = parseInt(tileMatch[4], 10) * (isNorth ? 1 : -1);

      waypoints.forEach((wp, idx) => {
        const actualIdx = segmentIndex + idx;
        if (
          wp.lng >= tileLon && wp.lng < tileLon + 5 &&
          wp.lat >= tileLat && wp.lat < tileLat + 5
        ) {
          if (!badIndices.includes(actualIdx)) badIndices.push(actualIdx);
        }
      });
    });

    if (badIndices.length > 1) {
      return 'Mehrere Punkte liegen abseits befahrbarer Straßen';
    }
    if (badIndices.length === 1) {
      const label = getWaypointLabel(badIndices[0], total);
      return `${label} liegt abseits befahrbarer Straßen`;
    }
  }

  // 4. Konkrete Koordinaten im Fehlertext
  const coordMatches = [...text.matchAll(/(-?\d+\.\d+)[\s,]+(-?\d+\.\d+)/g)];
  if (coordMatches.length > 0) {
    const matchedIndices = [];
    coordMatches.forEach(m => {
      const c1 = parseFloat(m[1]);
      const c2 = parseFloat(m[2]);
      waypoints.forEach((wp, idx) => {
        const actualIdx = segmentIndex + idx;
        const d1 = getHaversineDistanceKm(wp, { lng: c1, lat: c2 });
        const d2 = getHaversineDistanceKm(wp, { lng: c2, lat: c1 });
        if ((d1 < 100 || d2 < 100) && !matchedIndices.includes(actualIdx)) {
          matchedIndices.push(actualIdx);
        }
      });
    });

    if (matchedIndices.length > 1) {
      return 'Mehrere Punkte liegen abseits befahrbarer Straßen';
    }
    if (matchedIndices.length === 1) {
      const label = getWaypointLabel(matchedIndices[0], total);
      return `${label} liegt abseits befahrbarer Straßen`;
    }
  }

  // 5. from-position nicht gefunden (Startpunkt des Segments)
  if (text.includes('from-position') || text.includes('from position')) {
    const fromIdx = segmentIndex;
    const label = getWaypointLabel(fromIdx, total);
    return `${label} liegt abseits befahrbarer Straßen`;
  }

  // 6. target island / section N
  const sectionMatch = text.match(/section\s+(\d+)/);
  if (sectionMatch) {
    const secNum = parseInt(sectionMatch[1], 10);
    const targetIdx = segmentIndex + secNum + 1;
    const fromIdx = segmentIndex + secNum;

    if (text.includes('island') || text.includes('unmapped') || text.includes('not mapped')) {
      const label = getWaypointLabel(Math.min(targetIdx, total - 1), total);
      return `${label} liegt abseits befahrbarer Straßen`;
    }
    if (text.includes('no track found') || text.includes('no route found')) {
      const labelA = getWaypointLabel(fromIdx, total);
      const labelB = getWaypointLabel(Math.min(targetIdx, total - 1), total);
      return `Keine Verbindung zwischen ${labelA} und ${labelB} gefunden`;
    }
  }

  // 7. Keine fahrbare Verbindung zwischen zwei Punkten (z. B. no track found at pass=0)
  if (
    text.includes('no track found') ||
    text.includes('no route found') ||
    text.includes('keine fahrbare route') ||
    text.includes('keine route gefunden')
  ) {
    const labelA = getWaypointLabel(segmentIndex, total);
    const labelB = getWaypointLabel(total - 1, total);
    return `Keine Verbindung zwischen ${labelA} und ${labelB} gefunden`;
  }

  // 8. Allgemeines HTTP 400 (Wegpunkt abseits des Straßennetzes)
  if (status === 400) {
    if (total === 2 && segmentIndex === 0) {
      return 'Start oder Ziel liegt abseits befahrbarer Straßen';
    }
    return 'Wegpunkt liegt abseits befahrbarer Straßen';
  }

  return 'Server antwortet nicht: Bitte Teilstrecke kürzen oder erneut versuchen';
}

/**
 * Fuehrt die Berechnung eines einzelnen Segments (von Punkt A nach Punkt B) durch.
 * Prüft vor jedem fetch, ob der Schlüssel im Zwischenspeicher vorliegt.
 * Speichert nach jedem erfolgreichen Abruf.
 */
async function fetchSegmentRoute(wpA, wpB, modeKey, signal = null, segmentIndex = 0, totalWaypoints = 2) {
  const url = getSegmentUrl(wpA, wpB, modeKey);

  // Vor jedem fetch prüfen, ob der Schlüssel im Zwischenspeicher vorliegt
  if (segmentCache.has(url)) {
    return segmentCache.get(url);
  }

  let response;
  try {
    response = await fetch(url, { signal });
  } catch (netErr) {
    if (netErr.name === 'AbortError') throw netErr;
    const err = new Error('Keine Internetverbindung zum Routing-Server');
    err.userMessage = 'Keine Internetverbindung zum Routing-Server';
    throw err;
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const userMsg = parseRoutingError(response.status, errorBody, [wpA, wpB], segmentIndex, totalWaypoints);
    const err = new Error(userMsg);
    err.userMessage = userMsg;
    throw err;
  }

  const data = await response.json();
  if (!data.features || data.features.length === 0) {
    const labelA = getWaypointLabel(segmentIndex, totalWaypoints);
    const labelB = getWaypointLabel(segmentIndex + 1, totalWaypoints);
    const userMsg = `Keine Verbindung zwischen ${labelA} und ${labelB} gefunden`;
    const err = new Error(userMsg);
    err.userMessage = userMsg;
    throw err;
  }

  // Speichere nach jedem erfolgreichen Abruf im Zwischenspeicher
  saveToSegmentCache(url, data);

  return data;
}

/**
 * Fuehrt die Routenberechnung ueber den BRouter-Dienst durch.
 * Die Route wird immer segmentweise berechnet (je Wegpunktpaar ein Aufruf von fetchSegmentRoute).
 * Mit Zwischenspeicher-Prüfung, Nebenläufigkeitskontrolle (AbortController & fortlaufende ID),
 * Messung (performance.now nur für neu abgerufene Segmente), Schätzung und lernender Restzeitanzeige.
 */
async function calculateRoute() {
  if (state.waypoints.length < 2) {
    cancelRunningCalculation();
    showStatus('Bitte setze mindestens 2 Punkte auf der Karte (Start und Ziel).', 'error');
    return;
  }

  syncSegmentModes();

  // Liste der Segment-URLs fuer alle Wegpunktpaare ermitteln
  const segmentUrls = [];
  for (let i = 0; i < state.waypoints.length - 1; i++) {
    const wpA = state.waypoints[i];
    const wpB = state.waypoints[i + 1];
    const segMode = state.segmentModes[i] || state.selectedMode || 'kurvig';
    segmentUrls.push(getSegmentUrl(wpA, wpB, segMode));
  }

  // 1. Schätzung vor dem Start (schätzt nur Segmente, die tatsächlich neu abgerufen werden)
  const estimation = estimateRouteCalculationSeconds(
    state.waypoints,
    state.segmentModes,
    segmentUrls,
    state.selectedMode
  );

  // 2. Nebenläufigkeit zuerst:
  // Beim Start einer neuen Berechnung wird die vorherige Anfrage per AbortController abgebrochen.
  if (currentCalculationAbortController) {
    try {
      currentCalculationAbortController.abort();
    } catch (_) {}
  }
  currentCalculationAbortController = new AbortController();
  const abortSignal = currentCalculationAbortController.signal;

  // Fortlaufende Nummer für diesen Durchlauf
  const thisCalculationId = ++currentCalculationId;

  // 3. Fortschrittsanzeige starten oder stoppen:
  // Liegen alle Segmente im Speicher, wird die Fortschrittsanzeige gar nicht erst gestartet.
  state.isLoading = true;
  if (!estimation.allCached) {
    startOrUpdateCalculationProgress(estimation.durationSeconds);
  } else {
    stopCalculationProgress();
  }

  try {
    // Die Route wird künftig immer segmentweise berechnet, also je Wegpunktpaar ein Aufruf von fetchSegmentRoute
    const segmentResults = [];
    let totalUncachedSeconds = 0;
    let totalUncachedAirKm = 0;
    let firstUncachedMode = null;

    for (let i = 0; i < state.waypoints.length - 1; i++) {
      const wpA = state.waypoints[i];
      const wpB = state.waypoints[i + 1];
      const segMode = state.segmentModes[i] || state.selectedMode || 'kurvig';
      const segAirKm = getHaversineDistanceKm(wpA, wpB);
      const segUrl = segmentUrls[i];
      const isCached = segmentCache.has(segUrl);

      const t0 = isCached ? 0 : performance.now();
      const segData = await fetchSegmentRoute(wpA, wpB, segMode, abortSignal, i, state.waypoints.length);
      const t1 = isCached ? 0 : performance.now();

      // Antworten mit einer älteren Nummer als der aktuellen verwerfen
      if (thisCalculationId !== currentCalculationId) return;

      // Segmente aus dem Zwischenspeicher zählen weder bei der Zeit noch bei den Kilometern mit
      if (!isCached) {
        const segDurationSeconds = (t1 - t0) / 1000;
        totalUncachedSeconds += segDurationSeconds;
        totalUncachedAirKm += segAirKm;
        if (!firstUncachedMode) {
          firstUncachedMode = segMode;
        }
      }

      segmentResults.push(segData);
    }

    if (thisCalculationId !== currentCalculationId) return;

    // Über alle neu abgerufenen Segmente einer Berechnung genau einmal am Ende an recordCalculationMeasurement übergeben
    // Liegt die Summe unter 300 Millisekunden, wird nichts gespeichert
    if (firstUncachedMode && totalUncachedSeconds * 1000 >= 300 && totalUncachedAirKm > 0) {
      recordCalculationMeasurement(firstUncachedMode, totalUncachedAirKm, totalUncachedSeconds);
    }

    if (thisCalculationId !== currentCalculationId) return;

    // GeoJSON Geometrie und Eigenschaften kombinieren (gilt für alle Fälle)
    const allCoordinates = [];
    let totalLengthMeters = 0;
    let totalTimeSeconds = 0;

    segmentResults.forEach((segData, idx) => {
      const feat = segData.features[0];
      const coords = feat.geometry.coordinates;
      if (idx === 0) {
        allCoordinates.push(...coords);
      } else {
        allCoordinates.push(...coords.slice(1));
      }

      const props = feat.properties || {};
      totalLengthMeters += parseFloat(props['track-length'] || 0);
      totalTimeSeconds += parseFloat(props['total-time'] || 0);
    });

    const combinedGeoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: allCoordinates
          },
          properties: {
            'track-length': String(totalLengthMeters),
            'total-time': String(totalTimeSeconds)
          }
        }
      ]
    };

    if (thisCalculationId !== currentCalculationId) return;

    // Erfolgreiche Route verarbeiten & auf der Karte zeichnen
    state.currentRouteGeoJSON = combinedGeoJSON;
    const routeFeature = combinedGeoJSON.features[0];
    state.currentRouteProperties = routeFeature.properties || {};

    if (map.getSource('route-source')) {
      map.getSource('route-source').setData(combinedGeoJSON);
    } else {
      setupRouteLayers();
      map.getSource('route-source').setData(combinedGeoJSON);
    }

    fitMapToRoute(routeFeature.geometry.coordinates);
    displayRouteSummary(state.currentRouteProperties);

    // Fortschritt auf 100% abschließen und dann schließen
    finishCalculationProgress(() => {
      if (thisCalculationId === currentCalculationId) {
        hideStatus();
      }
    });
  } catch (err) {
    if (err.name === 'AbortError' || thisCalculationId !== currentCalculationId) {
      // Still verwerfen bei neu gestarteter Berechnung
      return;
    }
    console.error('Fehler bei der Routenberechnung:', err);
    stopCalculationProgress();

    let displayMessage = err.userMessage || err.message;
    if (
      !displayMessage ||
      err.name === 'TypeError' ||
      !navigator.onLine ||
      (typeof displayMessage === 'string' && displayMessage.toLowerCase().includes('failed to fetch'))
    ) {
      displayMessage = 'Keine Internetverbindung zum Routing-Server';
    }
    showStatus(displayMessage, 'error');
    clearRouteLayer();
  } finally {
    if (thisCalculationId === currentCalculationId) {
      state.isLoading = false;
    }
  }
}

/**
 * Passt den sichtbaren Kartenausschnitt an die Route an
 */
function fitMapToRoute(coordinates) {
  if (!coordinates || coordinates.length === 0) return;

  const bounds = new maplibregl.LngLatBounds();
  coordinates.forEach(coord => bounds.extend(coord));

  map.fitBounds(bounds, {
    padding: { top: 60, bottom: 60, left: 60, right: 60 },
    maxZoom: 15,
    duration: 800
  });
}

/**
 * Zeigt Laenge und geschaetzte Fahrzeit an
 */
function displayRouteSummary(properties) {
  if (!domElements.routeSummaryBox) return;

  // BRouter liefert meist 'track-length' in Metern und 'total-time' in Sekunden
  const lengthMeters = parseFloat(properties['track-length'] || 0);
  const timeSeconds = parseFloat(properties['total-time'] || 0);

  const lengthKm = (lengthMeters / 1000).toFixed(1);
  const hours = Math.floor(timeSeconds / 3600);
  const minutes = Math.round((timeSeconds % 3600) / 60);

  let timeString = '';
  if (hours > 0) {
    timeString = `${hours} Std. ${minutes} Min.`;
  } else {
    timeString = `${minutes} Min.`;
  }

  if (domElements.routeDistance) {
    domElements.routeDistance.textContent = `${lengthKm} km`;
  }
  if (domElements.routeDuration) {
    domElements.routeDuration.textContent = timeString;
  }

  domElements.routeSummaryBox.classList.add('is-visible');
}

// ==========================================================================
// 7. GPX-DATEI DOWNLOAD
// ==========================================================================

/**
 * Erstellt eine GPX-Datei aus den aktuellen Routendaten und startet den Download
 */
function downloadGpxFile() {
  if (!state.currentRouteGeoJSON || !state.currentRouteGeoJSON.features || state.currentRouteGeoJSON.features.length === 0) {
    showStatus('Bitte berechne zuerst eine Route vor dem GPX-Export.', 'error');
    return;
  }

  const coordinates = state.currentRouteGeoJSON.features[0].geometry.coordinates;
  const now = new Date().toISOString();
  const routeName = `MotoAlex_Tour_${new Date().toISOString().slice(0, 10)}`;

  let gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MotoAlex Navigation (motoalex-navigation.de)" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${routeName}</name>
    <time>${now}</time>
  </metadata>
`;

  // Wegpunkte (WPT)
  state.waypoints.forEach((wp, idx) => {
    let name = `Wegpunkt ${idx + 1}`;
    if (idx === 0) name = 'Start';
    else if (idx === state.waypoints.length - 1) name = 'Ziel';

    gpxContent += `  <wpt lat="${wp.lat.toFixed(6)}" lon="${wp.lng.toFixed(6)}">
    <name>${name}</name>
  </wpt>
`;
  });

  // Track (TRK)
  gpxContent += `  <trk>
    <name>${routeName}</name>
    <trkseg>
`;

  coordinates.forEach(coord => {
    const lon = coord[0];
    const lat = coord[1];
    const ele = coord[2] !== undefined ? coord[2] : null;

    if (ele !== null) {
      gpxContent += `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>\n`;
    } else {
      gpxContent += `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}" />\n`;
    }
  });

  gpxContent += `    </trkseg>
  </trk>
</gpx>`;

  // Blob erstellen und Download anstossen
  const blob = new Blob([gpxContent], { type: 'application/gpx+xml;charset=utf-8' });
  const downloadUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement('a');
  downloadLink.href = downloadUrl;
  downloadLink.download = `${routeName}.gpx`;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(downloadUrl);
}

// ==========================================================================
// 8. STATUS & BENACHRICHTIGUNGEN
// ==========================================================================

function showStatus(message, type = 'loading') {
  if (!domElements.statusBanner) return;

  // Wenn Fortschrittsanzeige aktiv ist, Info/Erfolgsmeldungen nicht drüberblenden
  if (isProgressActive && type !== 'error') {
    return;
  }

  if (isProgressActive) {
    stopCalculationProgress();
  }

  domElements.statusBanner.style.padding = '';
  domElements.statusBanner.style.backgroundColor = '';
  domElements.statusBanner.style.position = '';
  domElements.statusBanner.style.overflow = '';
  domElements.statusBanner.textContent = message;
  domElements.statusBanner.style.display = 'flex';
  domElements.statusBanner.className = `status-banner is-${type}`;
}

function hideStatus() {
  if (!domElements.statusBanner) return;
  stopCalculationProgress();
  domElements.statusBanner.style.display = 'none';
  domElements.statusBanner.style.padding = '';
  domElements.statusBanner.style.backgroundColor = '';
  domElements.statusBanner.style.position = '';
  domElements.statusBanner.style.overflow = '';
  domElements.statusBanner.className = 'status-banner';
  domElements.statusBanner.textContent = '';
}

// ==========================================================================
// 9. ROUTE TEILEN (LINK & QR-CODE)
// ==========================================================================

/**
 * Oeffnet das Modal zum Teilen der Route und erzeugt Link & QR-Code
 */
function openShareModal() {
  if (state.waypoints.length < 2) {
    showStatus('Bitte setze mindestens 2 Punkte, um eine Route zu teilen.', 'error');
    return;
  }

  if (!window.RouteUrl || typeof window.RouteUrl.buildRouteUrl !== 'function') {
    console.error('RouteUrl-Bibliothek ist nicht verfügbar.');
    return;
  }

  syncSegmentModes();

  // URL mit Segment-Modi erzeugen
  const shareUrl = window.RouteUrl.buildRouteUrl(state.waypoints, state.segmentModes);

  // Input-Feld befuellen
  if (domElements.shareUrlInput) {
    domElements.shareUrlInput.value = shareUrl;
  }

  // Rueckmeldung zuruecksetzen
  if (domElements.shareCopyFeedback) {
    domElements.shareCopyFeedback.style.display = 'none';
  }

  // QR-Code rendern
  if (domElements.shareQrContainer) {
    domElements.shareQrContainer.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      try {
        new QRCode(domElements.shareQrContainer, {
          text: shareUrl,
          width: 180,
          height: 180,
          colorDark: '#121212',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (err) {
        console.error('QR-Code-Erzeugung fehlgeschlagen:', err);
      }
    }
  }

  // Modal anzeigen
  if (domElements.shareModal) {
    domElements.shareModal.style.display = 'flex';
  }
}

/**
 * Schliesst das Teilen-Modal
 */
function closeShareModal() {
  if (domElements.shareModal) {
    domElements.shareModal.style.display = 'none';
  }
}

/**
 * Kopiert die Teilen-URL in die Zwischenablage
 */
function copyShareUrl() {
  if (!domElements.shareUrlInput) return;
  const url = domElements.shareUrlInput.value;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showCopyFeedback();
    }).catch(() => {
      fallbackCopyText();
    });
  } else {
    fallbackCopyText();
  }
}

function fallbackCopyText() {
  if (!domElements.shareUrlInput) return;
  domElements.shareUrlInput.select();
  domElements.shareUrlInput.setSelectionRange(0, 99999);
  try {
    document.execCommand('copy');
    showCopyFeedback();
  } catch (err) {
    console.error('Kopieren fehlgeschlagen:', err);
  }
}

function showCopyFeedback() {
  if (!domElements.shareCopyFeedback) return;
  domElements.shareCopyFeedback.style.display = 'block';
  setTimeout(() => {
    if (domElements.shareCopyFeedback) {
      domElements.shareCopyFeedback.style.display = 'none';
    }
  }, 3000);
}

/**
 * Prueft beim Seitenstart, ob Routenparameter in der URL uebergeben wurden
 */
function checkUrlParamsOnLoad() {
  if (!window.RouteUrl || !window.location.search) return;

  const result = window.RouteUrl.parseRouteUrl(window.location.search);
  if (result.valid && result.waypoints.length >= 2) {
    if (result.mode && domElements.modeSelect) {
      state.selectedMode = result.mode;
      domElements.modeSelect.value = result.mode;
      updateProfileExplanation(result.mode);
    }

    if (result.segmentModes && result.segmentModes.length > 0) {
      state.segmentModes = [...result.segmentModes];
    }

    // Sobald die Karte bereit ist, Wegpunkte hinzufuegen
    const applyWaypoints = () => {
      result.waypoints.forEach(wp => {
        const wpObj = createWaypointObject(wp.lng, wp.lat);
        state.waypoints.push(wpObj);
      });
      syncSegmentModes();
      updateMarkerLabels();
      renderWaypointsList();
      if (state.waypoints.length >= 2) {
        calculateRoute();
      }
    };

    if (map && map.loaded()) {
      applyWaypoints();
    } else if (map) {
      map.on('load', applyWaypoints);
    }
  }
}

