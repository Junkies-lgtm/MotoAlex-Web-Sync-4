/**
 * MotoAlex Navigation - Zentrale Logik für Routen-URLs (Erzeugung & Auslesen)
 * 
 * URL-Format:
 * https://motoalex-navigation.de/route.html?p=52.34123,13.62345;52.41234,13.75456&m=kurvig
 * Oder mit segmentweisem Profil (N-1 Abschnitte kommagetrennt):
 * https://motoalex-navigation.de/route.html?p=52.34123,13.62345;52.41234,13.75456;52.51234,13.85456&m=schnell,extra_kurvig
 * - Koordinaten auf fünf Nachkommastellen gerundet
 * - Punkte durch Semikolon (;) getrennt
 * - Breitengrad (Lat) und Längengrad (Lng) durch Komma (,) getrennt
 * - Modus als einzelnes Wort oder kommagetrennte Liste je Abschnitt
 * - Bis zu 22 Wegpunkte unterstützt
 */

const ROUTE_URL_CONFIG = {
  CANONICAL_HOST: 'https://motoalex-navigation.de',
  ROUTE_PATH: '/route.html',
  MIN_WAYPOINTS: 2,
  MAX_WAYPOINTS: 22,
  DECIMAL_PLACES: 5,
  DEFAULT_MODE: 'kurvig',
  VALID_MODES: ['schnellste', 'schnell', 'kurvig', 'extra_kurvig']
};

/**
 * Erzeugt eine standardisierte Teilen-URL aus Wegpunkten und Modus/Segment-Modi
 * @param {Array<{lat: number, lng: number}>} waypoints Array von Wegpunkten
 * @param {string|Array<string>} [modeOrModes] Gewählter Routing-Modus oder Array von Segment-Modi
 * @param {string} [baseUrl] Optional abweichende Basisadresse
 * @returns {string} Vollständige Teilen-Adresse
 */
function buildRouteUrl(waypoints, modeOrModes = ROUTE_URL_CONFIG.DEFAULT_MODE, baseUrl = null) {
  if (!Array.isArray(waypoints) || waypoints.length < ROUTE_URL_CONFIG.MIN_WAYPOINTS) {
    throw new Error(`Mindestens ${ROUTE_URL_CONFIG.MIN_WAYPOINTS} Wegpunkte erforderlich.`);
  }

  if (waypoints.length > ROUTE_URL_CONFIG.MAX_WAYPOINTS) {
    throw new Error(`Maximal ${ROUTE_URL_CONFIG.MAX_WAYPOINTS} Wegpunkte erlaubt (übergeben: ${waypoints.length}).`);
  }

  // Koordinaten mit 5 Nachkommastellen formatieren (Breite,Länge)
  const pointsStr = waypoints.map(wp => {
    const lat = Number(wp.lat);
    const lng = Number(wp.lng);
    if (isNaN(lat) || isNaN(lng)) {
      throw new Error('Ungültige Koordinatenwerte');
    }
    return `${lat.toFixed(ROUTE_URL_CONFIG.DECIMAL_PLACES)},${lng.toFixed(ROUTE_URL_CONFIG.DECIMAL_PLACES)}`;
  }).join(';');

  // Modi formatieren (Array oder String)
  let modeParamValue = ROUTE_URL_CONFIG.DEFAULT_MODE;
  if (Array.isArray(modeOrModes)) {
    const validArray = modeOrModes.map(m => (typeof m === 'string' && ROUTE_URL_CONFIG.VALID_MODES.includes(m.trim())) ? m.trim() : ROUTE_URL_CONFIG.DEFAULT_MODE);
    // Prüfen, ob alle Segmente denselben Modus haben – dann reicht ein einzelner Wert
    const allSame = validArray.every(m => m === validArray[0]);
    if (allSame && validArray.length > 0) {
      modeParamValue = validArray[0];
    } else {
      modeParamValue = validArray.join(',');
    }
  } else if (typeof modeOrModes === 'string' && modeOrModes.trim()) {
    modeParamValue = modeOrModes.trim();
  }

  // Basis-URL bestimmen
  let base = baseUrl;
  if (!base) {
    base = `${ROUTE_URL_CONFIG.CANONICAL_HOST}${ROUTE_URL_CONFIG.ROUTE_PATH}`;
  }

  return `${base}?p=${pointsStr}&m=${encodeURIComponent(modeParamValue)}`;
}

/**
 * Liest und validiert Wegpunkte und Modi aus einer URL oder einem Query-String
 * @param {string|Location|URLSearchParams} [source] URL, Query-String oder Location-Objekt
 * @returns {{valid: boolean, waypoints: Array<{lat: number, lng: number}>, mode: string, segmentModes: Array<string>, error?: string}}
 */
function parseRouteUrl(source) {
  try {
    let searchStr = '';
    if (typeof source === 'string') {
      if (source.includes('?')) {
        searchStr = source.substring(source.indexOf('?'));
      } else {
        searchStr = source.startsWith('p=') ? `?${source}` : source;
      }
    } else if (source && typeof source.search === 'string') {
      searchStr = source.search;
    } else if (typeof window !== 'undefined' && window.location) {
      searchStr = window.location.search;
    }

    const params = new URLSearchParams(searchStr);
    const pParam = params.get('p');
    const mParam = params.get('m');

    if (!pParam) {
      return {
        valid: false,
        waypoints: [],
        mode: ROUTE_URL_CONFIG.DEFAULT_MODE,
        segmentModes: [],
        error: 'Keine Wegpunkte (Parameter „p“) in der Webadresse angegeben.'
      };
    }

    const pointStrings = pParam.split(';').map(s => s.trim()).filter(Boolean);

    if (pointStrings.length < ROUTE_URL_CONFIG.MIN_WAYPOINTS) {
      return {
        valid: false,
        waypoints: [],
        mode: ROUTE_URL_CONFIG.DEFAULT_MODE,
        segmentModes: [],
        error: `Zu wenige Wegpunkte: Mindestens ${ROUTE_URL_CONFIG.MIN_WAYPOINTS} Punkte erforderlich (übergeben: ${pointStrings.length}).`
      };
    }

    if (pointStrings.length > ROUTE_URL_CONFIG.MAX_WAYPOINTS) {
      return {
        valid: false,
        waypoints: [],
        mode: ROUTE_URL_CONFIG.DEFAULT_MODE,
        segmentModes: [],
        error: `Zu viele Wegpunkte: Maximal ${ROUTE_URL_CONFIG.MAX_WAYPOINTS} Punkte möglich (übergeben: ${pointStrings.length}).`
      };
    }

    const waypoints = [];
    for (let i = 0; i < pointStrings.length; i++) {
      const parts = pointStrings[i].split(',');
      if (parts.length !== 2) {
        return {
          valid: false,
          waypoints: [],
          mode: ROUTE_URL_CONFIG.DEFAULT_MODE,
          segmentModes: [],
          error: `Wegpunkt ${i + 1} („${pointStrings[i]}“) ist unvollständig oder fehlerhaft formatiert. Erwartet wird „Breite,Länge“.`
        };
      }

      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);

      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return {
          valid: false,
          waypoints: [],
          mode: ROUTE_URL_CONFIG.DEFAULT_MODE,
          segmentModes: [],
          error: `Wegpunkt ${i + 1} enthält ungültige Koordinaten (Breitengrad: ${parts[0]}, Längengrad: ${parts[1]}).`
        };
      }

      waypoints.push({ lat, lng });
    }

    const numSegments = Math.max(1, waypoints.length - 1);
    let primaryMode = ROUTE_URL_CONFIG.DEFAULT_MODE;
    const segmentModes = [];

    if (mParam && mParam.trim()) {
      const rawModes = mParam.split(',').map(m => m.trim()).filter(Boolean);
      if (rawModes.length > 1) {
        // Liste von Segment-Profilen
        for (let s = 0; s < numSegments; s++) {
          const m = rawModes[s] || rawModes[rawModes.length - 1] || ROUTE_URL_CONFIG.DEFAULT_MODE;
          segmentModes.push(ROUTE_URL_CONFIG.VALID_MODES.includes(m) ? m : ROUTE_URL_CONFIG.DEFAULT_MODE);
        }
        primaryMode = segmentModes[0];
      } else if (rawModes.length === 1) {
        const singleMode = ROUTE_URL_CONFIG.VALID_MODES.includes(rawModes[0]) ? rawModes[0] : ROUTE_URL_CONFIG.DEFAULT_MODE;
        primaryMode = singleMode;
        for (let s = 0; s < numSegments; s++) {
          segmentModes.push(singleMode);
        }
      }
    } else {
      for (let s = 0; s < numSegments; s++) {
        segmentModes.push(ROUTE_URL_CONFIG.DEFAULT_MODE);
      }
    }

    return {
      valid: true,
      waypoints,
      mode: primaryMode,
      segmentModes
    };
  } catch (err) {
    return {
      valid: false,
      waypoints: [],
      mode: ROUTE_URL_CONFIG.DEFAULT_MODE,
      segmentModes: [],
      error: `Fehler beim Verarbeiten der Routen-Adresse: ${err.message || err}`
    };
  }
}

// Global für Skripte bereitstellen
if (typeof window !== 'undefined') {
  window.RouteUrl = {
    CONFIG: ROUTE_URL_CONFIG,
    buildRouteUrl,
    parseRouteUrl
  };
}
