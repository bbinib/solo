const globeContainer = document.querySelector("#globe");
const countryName = document.querySelector("#countryName");
const tempValue = document.querySelector("#tempValue");
const seaValue = document.querySelector("#seaValue");
const yearSlider = document.querySelector("#yearSlider");
const yearValue = document.querySelector("#yearValue");
const playYearsButton = document.querySelector("#playYears");
const pauseYearsButton = document.querySelector("#pauseYears");
const regionFilter = document.querySelector("#regionFilter");
const searchForm = document.querySelector("#searchControl");
const countrySearch = document.querySelector("#countrySearch");
const countryOptions = document.querySelector("#countryOptions");
const searchStatus = document.querySelector("#searchStatus");
const resetViewButton = document.querySelector("#resetView");
const topCountriesList = document.querySelector("#topCountriesList");

const years = [1993, 2000, 2010, 2020, 2022];
const climateByCountry = {};
const climateByIso3 = {};
const countryFeatureByName = {};
const countryFeatureByIso3 = {};
const countrySearchIndex = [];
const countryDataList = [];
const topCountriesCache = new Map();
const colorStringCache = new Map();
const featureMetaCache = new WeakMap();

let selectedYear = 2022;
let selectedCountryFeature = null;
let selectedRegion = "all";
let yearPlayTimer = null;
let countryLayerRefreshFrame = null;
let resizeFrame = null;
let globe;

const COUNTRY_LAYER_ALTITUDE = 0.004;
const SELECTED_COUNTRY_ALTITUDE = 0.009;
const EMPTY_COUNTRY_ALTITUDE = 0.00001;
const YEAR_PLAY_INTERVAL = 1200;
const COUNTRY_BOUNDARIES_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const EARTH_TEXTURE_URL = "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg";
const EARTH_BUMP_TEXTURE_URL = "https://threejs.org/examples/textures/planets/earth_normal_2048.jpg";
const EARTH_SPECULAR_TEXTURE_URL = "https://threejs.org/examples/textures/planets/earth_specular_2048.jpg";

const countryNameOverrides = {
    CHN: "China",
    USA: "United States of America",
    RUS: "Russia",
    KOR: "South Korea"
};

const colorScale = d3
    .scaleLinear()
    .domain([-0.5, 0.7, 1.5, 2.5, 3.7])
    .range(["#2f80ed", "#37d67a", "#f7e35f", "#ff8c24", "#d7191c"]);

init();

function init() {
    if (typeof d3 === "undefined" || typeof Globe === "undefined") {
        countryName.textContent = "Library load failed";
        return;
    }

    globe = Globe()(globeContainer)
        .width(window.innerWidth)
        .height(window.innerHeight)
        .backgroundColor("#050816")
        .backgroundImageUrl("https://unpkg.com/three-globe/example/img/night-sky.png")
        .globeImageUrl(EARTH_TEXTURE_URL)
        .bumpImageUrl(EARTH_BUMP_TEXTURE_URL)
        .showAtmosphere(true)
        .atmosphereColor("#8fd3ff")
        .atmosphereAltitude(0.14)
        .polygonAltitude(getCountryAltitude)
        .polygonCapColor(getCountryColor)
        .polygonSideColor(() => "rgba(255, 255, 255, 0)")
        .polygonStrokeColor(getCountryStrokeColor)
        .polygonLabel(getCountryLabel)
        .polygonsTransitionDuration(300)
        .onPolygonHover((feature) => {
            globe.controls().autoRotate = !feature;
        })
        .onPolygonClick((feature) => {
            showCountryData(feature);
        });

    globe.controls().autoRotate = true;
    globe.controls().autoRotateSpeed = 0.25;
    globe.pointOfView({ lat: 22, lng: 126, altitude: 2.45 }, 0);
    tuneGlobeMaterial();
    addOceanLighting();

    bindYearSlider();
    bindYearPlayback();
    bindRegionFilter();
    bindCountrySearch();
    bindTopCountriesList();

    loadClimateData()
        .then(() => {
            populateCountryOptions();
            updateTopCountries();
            return loadCountries();
        })
        .catch(() => {
            countryName.textContent = "Climate CSV load failed";
            return loadCountries();
        });
}

function bindCountrySearch() {
    searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        searchCountry(countrySearch.value);
    });

    resetViewButton.addEventListener("click", resetView);
}

function bindTopCountriesList() {
    topCountriesList.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-country]");

        if (!button) {
            return;
        }

        selectCountryByName(button.dataset.country);
    });
}

function resetView() {
    stopYearPlayback();
    selectedCountryFeature = null;
    countrySearch.value = "";
    regionFilter.value = "all";
    selectedRegion = "all";
    countryName.textContent = "\uB098\uB77C\uB97C \uD074\uB9AD\uD558\uC138\uC694";
    tempValue.textContent = "-";
    seaValue.textContent = "-";
    searchStatus.textContent = "CSV \uB370\uC774\uD130\uAC00 \uC788\uB294 \uAD6D\uAC00\uB9CC \uAC80\uC0C9\uB429\uB2C8\uB2E4.";
    clearChart("#tempChart");
    clearChart("#seaChart");
    updateTopCountries();
    refreshCountryLayer();

    globe.controls().autoRotate = true;
    globe.pointOfView({ lat: 22, lng: 126, altitude: 2.45 }, 900);
}

function bindYearSlider() {
    yearSlider.addEventListener("input", () => {
        stopYearPlayback();
        setYearByIndex(Number(yearSlider.value));
    });
}

function bindYearPlayback() {
    playYearsButton.addEventListener("click", startYearPlayback);
    pauseYearsButton.addEventListener("click", stopYearPlayback);
    updatePlaybackButtons();
}

function bindRegionFilter() {
    regionFilter.addEventListener("change", () => {
        selectedRegion = regionFilter.value;
        updateTopCountries();
        refreshCountryLayer();
    });
}

function startYearPlayback() {
    if (yearPlayTimer) {
        return;
    }

    setYearByIndex((Number(yearSlider.value) + 1) % years.length);
    yearPlayTimer = window.setInterval(() => {
        setYearByIndex((Number(yearSlider.value) + 1) % years.length);
    }, YEAR_PLAY_INTERVAL);
    updatePlaybackButtons();
}

function stopYearPlayback() {
    if (!yearPlayTimer) {
        updatePlaybackButtons();
        return;
    }

    window.clearInterval(yearPlayTimer);
    yearPlayTimer = null;
    updatePlaybackButtons();
}

function updatePlaybackButtons() {
    playYearsButton.disabled = Boolean(yearPlayTimer);
    pauseYearsButton.disabled = !yearPlayTimer;
}

function setYearByIndex(index) {
    const nextYear = years[index];

    if (selectedYear === nextYear && Number(yearSlider.value) === index) {
        return;
    }

    yearSlider.value = index;
    selectedYear = nextYear;
    yearValue.textContent = selectedYear;
    updateTopCountries();
    refreshCountryLayer();

    if (selectedCountryFeature) {
        showCountryData(selectedCountryFeature, false);
    }
}

function loadClimateData() {
    return d3.csv("./data/climate.csv?v=20260513-1", (row) => ({
        country: row.country,
        iso3: row.iso3,
        region: row.region,
        year: Number(row.year),
        tempRise: Number(row.tempRiseC),
        seaRise: Number(row.seaRiseCm)
    })).then((rows) => {
        rows.forEach((row) => {
            if (!climateByCountry[row.country]) {
                climateByCountry[row.country] = {
                    iso3: row.iso3,
                    region: row.region,
                    tempHistory: [],
                    seaHistory: [],
                    tempByYear: new Map(),
                    seaByYear: new Map()
                };
                climateByIso3[row.iso3] = climateByCountry[row.country];
                countryDataList.push({
                    name: row.country,
                    data: climateByCountry[row.country]
                });
            }

            climateByCountry[row.country].tempHistory.push({ year: row.year, value: row.tempRise });
            climateByCountry[row.country].seaHistory.push({ year: row.year, value: row.seaRise });
            climateByCountry[row.country].tempByYear.set(row.year, row.tempRise);
            climateByCountry[row.country].seaByYear.set(row.year, row.seaRise);
        });

        Object.values(climateByCountry).forEach((data) => {
            data.tempHistory.sort((a, b) => a.year - b.year);
            data.seaHistory.sort((a, b) => a.year - b.year);
            data.tempHistory.byYear = data.tempByYear;
            data.seaHistory.byYear = data.seaByYear;
        });

        buildTopCountriesCache();
    });
}

function loadCountries() {
    return fetch(COUNTRY_BOUNDARIES_URL)
        .then((response) => {
            if (!response.ok) {
                throw new Error("world geojson load failed");
            }
            return response.json();
        })
        .then((countries) => {
            const features = countries.features.concat(getKoreaIslandFeatures());
            indexCountryFeatures(features);
            globe.polygonsData(features);
            refreshCountryLayer();
        })
        .catch(() => {
            countryName.textContent = "Country boundary load failed";
        });
}

function indexCountryFeatures(features) {
    features.forEach((feature) => {
        const name = getFeatureName(feature);
        const iso3 = getFeatureIso3(feature);

        if (!countryFeatureByName[normalizeName(name)] && !feature.properties.islandName) {
            countryFeatureByName[normalizeName(name)] = feature;
        }

        if (iso3 && !countryFeatureByIso3[iso3] && !feature.properties.islandName) {
            countryFeatureByIso3[iso3] = feature;
        }
    });
}

function getKoreaIslandFeatures() {
    return [
        createPolygonFeature("Jeju-do", [
            [126.16, 33.30],
            [126.28, 33.48],
            [126.52, 33.56],
            [126.78, 33.51],
            [126.91, 33.38],
            [126.76, 33.24],
            [126.50, 33.16],
            [126.27, 33.20],
            [126.16, 33.30]
        ]),
        createEllipseFeature("Ulleungdo", 130.87, 37.50, 0.075, 0.055, 18),
        createEllipseFeature("Dokdo", 131.87, 37.24, 0.028, 0.020, 14)
    ];
}

function createPolygonFeature(islandName, coordinates) {
    return createKoreaIslandFeature(islandName, [coordinates]);
}

function createEllipseFeature(islandName, lng, lat, radiusLng, radiusLat, steps) {
    const coordinates = [];

    for (let i = steps; i >= 0; i--) {
        const angle = (Math.PI * 2 * i) / steps;
        coordinates.push([
            lng + Math.cos(angle) * radiusLng,
            lat + Math.sin(angle) * radiusLat
        ]);
    }

    return createKoreaIslandFeature(islandName, [coordinates]);
}

function createKoreaIslandFeature(islandName, coordinates) {
    return {
        type: "Feature",
        properties: {
            ADMIN: "South Korea",
            NAME_EN: "South Korea",
            ISO_A3: "KOR",
            ADM0_A3: "KOR",
            SOV_A3: "KOR",
            islandName
        },
        geometry: {
            type: "Polygon",
            coordinates
        }
    };
}

function populateCountryOptions() {
    countryOptions.innerHTML = "";
    countrySearchIndex.length = 0;
    const fragment = document.createDocumentFragment();

    Object.keys(climateByCountry)
        .sort((a, b) => a.localeCompare(b))
        .forEach((name) => {
            const data = climateByCountry[name];
            const option = document.createElement("option");

            option.value = name;
            fragment.appendChild(option);
            countrySearchIndex.push({
                name,
                normalizedName: normalizeName(name),
                normalizedIso3: normalizeName(data.iso3)
            });
        });

    countryOptions.appendChild(fragment);
}

function searchCountry(value) {
    const query = normalizeName(value);

    if (!query) {
        searchStatus.textContent = "\uAC80\uC0C9\uD560 \uAD6D\uAC00 \uC774\uB984\uC744 \uC785\uB825\uD558\uC138\uC694.";
        return;
    }

    const countryNameMatch = countrySearchIndex.find((item) => (
        item.normalizedName === query
        || item.normalizedName.includes(query)
        || item.normalizedIso3 === query
    ))?.name;

    if (!countryNameMatch) {
        searchStatus.textContent = "CSV \uB370\uC774\uD130\uC5D0 \uC5C6\uB294 \uAD6D\uAC00\uC785\uB2C8\uB2E4.";
        return;
    }

    const data = climateByCountry[countryNameMatch];
    const feature = countryFeatureByIso3[data.iso3] || countryFeatureByName[normalizeName(countryNameMatch)];

    if (!feature) {
        searchStatus.textContent = "\uC9C0\uB3C4\uC5D0\uC11C \uD574\uB2F9 \uAD6D\uAC00 \uACBD\uACC4\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
        return;
    }

    selectedCountryFeature = feature;
    showCountryData(feature);
    flyToCountry(feature);
    searchStatus.textContent = `${countryNameMatch} \uC120\uD0DD\uB428`;
}

function selectCountryByName(name) {
    const data = climateByCountry[name];

    if (!data) {
        return;
    }

    const feature = countryFeatureByIso3[data.iso3] || countryFeatureByName[normalizeName(name)];

    if (!feature) {
        searchStatus.textContent = "\uC9C0\uB3C4\uC5D0\uC11C \uD574\uB2F9 \uAD6D\uAC00 \uACBD\uACC4\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
        return;
    }

    countrySearch.value = name;
    selectedCountryFeature = feature;
    showCountryData(feature);
    flyToCountry(feature);
    searchStatus.textContent = `${name} \uC120\uD0DD\uB428`;
}

function flyToCountry(feature) {
    const [lng, lat] = d3.geoCentroid(feature);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return;
    }

    globe.controls().autoRotate = false;
    globe.pointOfView({ lat, lng, altitude: 1.65 }, 1100);
}

function normalizeName(value) {
    return String(value).trim().toLowerCase();
}

function hasCountryData(feature) {
    return getFeatureMeta(feature).hasData;
}

function isFeatureInSelectedRegion(feature) {
    if (selectedRegion === "all") {
        return true;
    }

    return getFeatureMeta(feature).region === selectedRegion;
}

function getCountryAltitude(feature) {
    const meta = getFeatureMeta(feature);

    if (isFeatureSelectedByMeta(meta)) {
        return SELECTED_COUNTRY_ALTITUDE;
    }

    return meta.hasData && (selectedRegion === "all" || meta.region === selectedRegion)
        ? COUNTRY_LAYER_ALTITUDE
        : EMPTY_COUNTRY_ALTITUDE;
}

function getFeatureName(feature) {
    return getFeatureMeta(feature).name;
}

function getFeatureIso3(feature) {
    return getFeatureMeta(feature).iso3;
}

function getCountryData(feature) {
    return getFeatureMeta(feature).data;
}

function getFeatureMeta(feature) {
    const cached = featureMetaCache.get(feature);

    if (cached) {
        if (!cached.data) {
            const data = getClimateDataByIdentity(cached.iso3, cached.name);

            if (data) {
                cached.data = data;
                cached.hasData = true;
                cached.region = data.region;
            }
        }

        return cached;
    }

    const properties = feature.properties || {};
    const rawIso3 = properties.ISO_A3 || properties.ADM0_A3 || properties.SOV_A3;
    const iso3 = rawIso3 && rawIso3 !== "-99" ? rawIso3 : null;
    const name = countryNameOverrides[iso3]
        || properties.NAME_EN
        || properties.ADMIN
        || properties.name
        || "Unknown country";
    const data = getClimateDataByIdentity(iso3, name);
    const meta = {
        name,
        iso3,
        data,
        hasData: Boolean(data),
        region: data ? data.region : null,
        key: iso3 || normalizeName(name)
    };

    featureMetaCache.set(feature, meta);
    return meta;
}

function getClimateDataByIdentity(iso3, name) {
    return (iso3 && climateByIso3[iso3]) || climateByCountry[name] || null;
}

function getCountryColor(feature) {
    const meta = getFeatureMeta(feature);
    const selected = isFeatureSelectedByMeta(meta);

    if (!meta.data || (!selected && selectedRegion !== "all" && meta.region !== selectedRegion)) {
        return "rgba(255, 255, 255, 0)";
    }

    return getTemperatureColor(meta.data, selected);
}

function getTemperatureColor(data, selected) {
    const cacheKey = `${data.iso3}:${selectedYear}:${selected ? "selected" : "normal"}`;
    const cached = colorStringCache.get(cacheKey);

    if (cached) {
        return cached;
    }

    const tempRise = getHistoryValue(data.tempHistory, selectedYear);
    const baseColor = colorScale(tempRise);
    const mixedColor = selected
        ? d3.interpolateRgb("#ffffff", baseColor)(0.48)
        : d3.interpolateRgb("#7f98a3", baseColor)(0.92);
    const color = d3.color(mixedColor);
    const opacity = selected ? 0.62 : 0.28;
    const colorString = `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity})`;

    colorStringCache.set(cacheKey, colorString);
    return colorString;
}

function getCountryStrokeColor(feature) {
    const meta = getFeatureMeta(feature);

    if (isFeatureSelectedByMeta(meta)) {
        return "rgba(255, 255, 255, 0.96)";
    }

    if (selectedRegion !== "all") {
        return meta.region === selectedRegion
            ? "rgba(255, 255, 255, 0.58)"
            : "rgba(255, 255, 255, 0.14)";
    }

    return meta.hasData ? "rgba(255, 255, 255, 0.46)" : "rgba(255, 255, 255, 0.24)";
}

function isSelectedCountry(feature) {
    if (!selectedCountryFeature || !feature) {
        return false;
    }

    return isFeatureSelectedByMeta(getFeatureMeta(feature));
}

function isFeatureSelectedByMeta(meta) {
    return Boolean(selectedCountryFeature && getFeatureMeta(selectedCountryFeature).key === meta.key);
}

function getCountryLabel(feature) {
    const name = getFeatureName(feature);
    const data = getCountryData(feature);

    if (!data) {
        return `<b>${name}</b>`;
    }

    const tempRise = getHistoryValue(data.tempHistory, selectedYear);
    const seaRise = getHistoryValue(data.seaHistory, selectedYear);

    return `
        <b>${name}</b><br/>
        ${selectedYear}<br/>
        Temperature rise: ${tempRise} C<br/>
        Global mean sea level rise: ${seaRise} cm
    `;
}

function buildTopCountriesCache() {
    topCountriesCache.clear();
    const regions = ["all", ...new Set(countryDataList.map((item) => item.data.region))];

    regions.forEach((region) => {
        years.forEach((year) => {
            const rankedCountries = countryDataList
                .filter((item) => region === "all" || item.data.region === region)
                .map((item) => ({
                    name: item.name,
                    iso3: item.data.iso3,
                    tempRise: getHistoryValue(item.data.tempHistory, year)
                }))
                .filter((item) => Number.isFinite(item.tempRise))
                .sort((a, b) => b.tempRise - a.tempRise)
                .slice(0, 5);

            topCountriesCache.set(getTopCountriesCacheKey(region, year), rankedCountries);
        });
    });
}

function getTopCountriesCacheKey(region, year) {
    return `${region}:${year}`;
}

function updateTopCountries() {
    if (!topCountriesList) {
        return;
    }

    topCountriesList.innerHTML = "";
    const rankedCountries = topCountriesCache.get(getTopCountriesCacheKey(selectedRegion, selectedYear)) || [];

    const fragment = document.createDocumentFragment();

    if (!rankedCountries.length) {
        const emptyItem = document.createElement("li");
        emptyItem.className = "top-empty";
        emptyItem.textContent = "표시할 데이터가 없습니다.";
        fragment.appendChild(emptyItem);
        topCountriesList.appendChild(fragment);
        return;
    }

    rankedCountries.forEach((country) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        const name = document.createElement("span");
        const value = document.createElement("strong");

        button.type = "button";
        button.dataset.country = country.name;
        button.dataset.iso3 = country.iso3;
        name.textContent = country.name;
        value.textContent = `+${country.tempRise} C`;

        button.append(name, value);
        item.appendChild(button);
        fragment.appendChild(item);
    });

    topCountriesList.appendChild(fragment);
    updateTopCountriesActive();
}

function updateTopCountriesActive() {
    if (!topCountriesList) {
        return;
    }

    const selectedIso3 = selectedCountryFeature ? getFeatureIso3(selectedCountryFeature) : "";
    const selectedName = selectedCountryFeature ? getFeatureName(selectedCountryFeature) : "";

    topCountriesList.querySelectorAll("button[data-country]").forEach((button) => {
        const isActive = button.dataset.iso3
            ? button.dataset.iso3 === selectedIso3
            : button.dataset.country === selectedName;

        button.classList.toggle("active", isActive);
    });
}

function showCountryData(feature, shouldRefreshLayer = true) {
    const name = getFeatureName(feature);
    const data = getCountryData(feature);
    selectedCountryFeature = feature;

    countryName.textContent = name;
    updateTopCountriesActive();

    if (!data) {
        tempValue.textContent = "-";
        seaValue.textContent = "-";
        clearChart("#tempChart");
        clearChart("#seaChart");

        if (shouldRefreshLayer) {
            refreshCountryLayer();
        }

        return;
    }

    const tempRise = getHistoryValue(data.tempHistory, selectedYear);
    const seaRise = getHistoryValue(data.seaHistory, selectedYear);

    tempValue.textContent = `+${tempRise} C`;
    seaValue.textContent = `${seaRise} cm`;

    if (shouldRefreshLayer) {
        refreshCountryLayer();
    }

    drawLineChart("#tempChart", data.tempHistory, "#ff6b6b", "C");
    drawLineChart("#seaChart", data.seaHistory, "#38bdf8", "cm");
}

function refreshCountryLayer() {
    if (!globe) {
        return;
    }

    if (countryLayerRefreshFrame) {
        window.cancelAnimationFrame(countryLayerRefreshFrame);
    }

    countryLayerRefreshFrame = window.requestAnimationFrame(() => {
        globe
            .polygonCapColor(getCountryColor)
            .polygonAltitude(getCountryAltitude)
            .polygonStrokeColor(getCountryStrokeColor);
        countryLayerRefreshFrame = null;
    });
}

function getHistoryValue(history, year) {
    if (history.byYear && history.byYear.has(year)) {
        return history.byYear.get(year);
    }

    const exact = history.find((item) => item.year === year);

    if (exact) {
        return exact.value;
    }

    const closest = history.reduce((best, item) => {
        const bestGap = Math.abs(best.year - year);
        const itemGap = Math.abs(item.year - year);
        return itemGap < bestGap ? item : best;
    });

    return closest.value;
}

function clearChart(selector) {
    d3.select(selector).selectAll("*").remove();
}

function tuneGlobeMaterial() {
    const material = globe.globeMaterial();

    if (!material) {
        return;
    }

    material.bumpScale = 3.2;

    if (typeof THREE === "undefined") {
        return;
    }

    material.color = new THREE.Color("#eef7ff");
    material.specular = new THREE.Color("#c5ecff");
    material.shininess = 32;
    material.emissive = new THREE.Color("#062446");
    material.emissiveIntensity = 0.3;
    material.specularMap = new THREE.TextureLoader().load(EARTH_SPECULAR_TEXTURE_URL, () => {
        material.needsUpdate = true;
    });
    material.needsUpdate = true;
}

function addOceanLighting() {
    if (typeof THREE === "undefined" || !globe.scene) {
        return;
    }

    const scene = globe.scene();
    const oceanFill = new THREE.HemisphereLight("#e1f3ff", "#10284c", 1.24);
    const frontOceanLight = new THREE.DirectionalLight("#dff5ff", 0.86);
    const sunGlint = new THREE.DirectionalLight("#d8efff", 1.28);
    const rimLight = new THREE.DirectionalLight("#6ab7ff", 0.42);

    frontOceanLight.position.set(0, 20, 260);
    sunGlint.position.set(-120, 80, 180);
    rimLight.position.set(120, 40, -160);

    scene.add(oceanFill);
    scene.add(frontOceanLight);
    scene.add(sunGlint);
    scene.add(rimLight);
}

function drawLineChart(selector, data, color, unit) {
    const svg = d3.select(selector);
    svg.selectAll("*").remove();

    const width = 320;
    const height = 140;
    const margin = { top: 18, right: 18, bottom: 28, left: 36 };

    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const x = d3
        .scaleLinear()
        .domain(d3.extent(data, (d) => d.year))
        .range([margin.left, width - margin.right]);

    const y = d3
        .scaleLinear()
        .domain([Math.min(0, d3.min(data, (d) => d.value)), d3.max(data, (d) => d.value) * 1.2])
        .range([height - margin.bottom, margin.top]);

    const line = d3
        .line()
        .x((d) => x(d.year))
        .y((d) => y(d.value))
        .curve(d3.curveMonotoneX);

    const selectedPoint = data.reduce((best, item) => {
        const bestGap = Math.abs(best.year - selectedYear);
        const itemGap = Math.abs(item.year - selectedYear);
        return itemGap < bestGap ? item : best;
    });

    svg
        .append("line")
        .attr("x1", x(selectedPoint.year))
        .attr("x2", x(selectedPoint.year))
        .attr("y1", margin.top)
        .attr("y2", height - margin.bottom)
        .attr("stroke", "rgba(255, 255, 255, 0.35)")
        .attr("stroke-dasharray", "4 4");

    svg
        .append("path")
        .datum(data)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 3)
        .attr("d", line);

    svg
        .selectAll("circle")
        .data(data)
        .join("circle")
        .attr("cx", (d) => x(d.year))
        .attr("cy", (d) => y(d.value))
        .attr("r", (d) => d.year === selectedPoint.year ? 6 : 4)
        .attr("fill", (d) => d.year === selectedPoint.year ? "#ffffff" : color)
        .attr("stroke", color)
        .attr("stroke-width", 2);

    svg
        .append("g")
        .attr("transform", `translate(0, ${height - margin.bottom})`)
        .call(d3.axisBottom(x).ticks(4).tickFormat(d3.format("d")))
        .call((g) => g.selectAll("text").attr("fill", "#cbd5e1"))
        .call((g) => g.selectAll("path,line").attr("stroke", "#475569"));

    svg
        .append("g")
        .attr("transform", `translate(${margin.left}, 0)`)
        .call(d3.axisLeft(y).ticks(4))
        .call((g) => g.selectAll("text").attr("fill", "#cbd5e1"))
        .call((g) => g.selectAll("path,line").attr("stroke", "#475569"));

    svg
        .append("text")
        .attr("x", width - margin.right)
        .attr("y", margin.top)
        .attr("text-anchor", "end")
        .attr("fill", "#cbd5e1")
        .attr("font-size", 11)
        .text(unit);
}

window.addEventListener("resize", () => {
    if (!globe) {
        return;
    }

    if (resizeFrame) {
        window.cancelAnimationFrame(resizeFrame);
    }

    resizeFrame = window.requestAnimationFrame(() => {
        globe.width(window.innerWidth);
        globe.height(window.innerHeight);
        resizeFrame = null;
    });
});


