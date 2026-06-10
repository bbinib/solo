const fs = require('fs');
const path = require('path');

const countries = [
  { region: 'Asia', country: 'South Korea', iso3: 'KOR' },
  { region: 'Asia', country: 'Japan', iso3: 'JPN' },
  { region: 'Asia', country: 'China', iso3: 'CHN' },
  { region: 'Asia', country: 'India', iso3: 'IND' },
  { region: 'Asia', country: 'Indonesia', iso3: 'IDN' },
  { region: 'Asia', country: 'Saudi Arabia', iso3: 'SAU' },
  { region: 'Europe', country: 'Germany', iso3: 'DEU' },
  { region: 'Europe', country: 'France', iso3: 'FRA' },
  { region: 'Europe', country: 'United Kingdom', iso3: 'GBR' },
  { region: 'Europe', country: 'Italy', iso3: 'ITA' },
  { region: 'Europe', country: 'Spain', iso3: 'ESP' },
  { region: 'Europe', country: 'Russia', iso3: 'RUS' },
  { region: 'Americas', country: 'United States of America', iso3: 'USA' },
  { region: 'Americas', country: 'Canada', iso3: 'CAN' },
  { region: 'Americas', country: 'Mexico', iso3: 'MEX' },
  { region: 'Americas', country: 'Brazil', iso3: 'BRA' },
  { region: 'Americas', country: 'Argentina', iso3: 'ARG' },
  { region: 'Americas', country: 'Chile', iso3: 'CHL' },
  { region: 'Africa', country: 'South Africa', iso3: 'ZAF' },
  { region: 'Africa', country: 'Egypt', iso3: 'EGY' },
  { region: 'Africa', country: 'Nigeria', iso3: 'NGA' },
  { region: 'Africa', country: 'Kenya', iso3: 'KEN' },
  { region: 'Oceania', country: 'Australia', iso3: 'AUS' },
  { region: 'Oceania', country: 'New Zealand', iso3: 'NZL' }
];

const selectedYears = [1993, 2000, 2010, 2020, 2022];
const tempEndpoint = (iso3) => `https://cckpapi.worldbank.org/cckp/v1/cru-x0.5_timeseries_tas_timeseries_annual_1901-2022_mean_historical_cru_ts4.07_mean/${iso3}?_format=json`;
const seaEndpoint = 'https://d3qt3aobtsas2h.cloudfront.net/edge/ws/search/sealevelgovglobal?type=global';

function getAnnualValue(series, year) {
  const key = Object.keys(series).find((item) => Number(item.slice(0, 4)) === year);
  return key ? Number(series[key]) : null;
}

function avg(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function closestPair(x, y, year) {
  let bestIndex = 0;
  let bestGap = Infinity;
  for (let i = 0; i < x.length; i++) {
    const gap = Math.abs(Number(x[i]) - year);
    if (gap < bestGap) {
      bestGap = gap;
      bestIndex = i;
    }
  }
  return { year: Number(x[bestIndex]), value: Number(y[bestIndex]) };
}

async function main() {
  const seaResponse = await fetch(seaEndpoint);
  if (!seaResponse.ok) throw new Error(`Sea level API failed: ${seaResponse.status}`);
  const seaJson = await seaResponse.json();
  const altimetry = seaJson.features[0].properties.altimetry_time_series;
  const seaBase = closestPair(altimetry.x, altimetry.y, 1993).value;
  const seaByYear = Object.fromEntries(selectedYears.map((year) => {
    const point = closestPair(altimetry.x, altimetry.y, year);
    const cm = (point.value - seaBase) * 100;
    return [year, Number(cm.toFixed(2))];
  }));

  const rows = [];
  for (const country of countries) {
    const response = await fetch(tempEndpoint(country.iso3));
    if (!response.ok) throw new Error(`Temp API failed for ${country.iso3}: ${response.status}`);
    const json = await response.json();
    const series = json.data[country.iso3];
    const baselineValues = [];
    for (let year = 1901; year <= 1930; year++) {
      const value = getAnnualValue(series, year);
      if (value !== null) baselineValues.push(value);
    }
    const baseline = avg(baselineValues);

    for (const year of selectedYears) {
      const annualMean = getAnnualValue(series, year);
      const tempRise = annualMean === null ? '' : Number((annualMean - baseline).toFixed(2));
      rows.push({
        country: country.country,
        iso3: country.iso3,
        region: country.region,
        year,
        tempRiseC: tempRise,
        annualMeanTempC: annualMean === null ? '' : Number(annualMean.toFixed(2)),
        seaRiseCm: seaByYear[year],
        tempSource: 'World Bank CCKP CRU TS 4.07 annual mean temperature; anomaly vs 1901-1930 country baseline',
        seaSource: 'World Bank CCKP sea level API / NASA global mean sea level; rise vs 1993'
      });
    }
  }

  const header = ['country','iso3','region','year','tempRiseC','annualMeanTempC','seaRiseCm','tempSource','seaSource'];
  const csv = [header.join(',')].concat(rows.map((row) => header.map((key) => {
    const value = String(row[key]);
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(','))).join('\n') + '\n';

  const outDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'climate.csv'), csv, 'utf8');
  console.log(`Wrote ${rows.length} rows to data/climate.csv`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
