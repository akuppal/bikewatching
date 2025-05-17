import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken = 'pk.eyJ1IjoiYWt1cHBhbCIsImEiOiJjbWFyNXhwZm8wMzdiMm1vbGt5YW94YzRrIn0.H4V6_kaszkGdiSltRf6dfw';

let stations = [];
let trips = [];
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09, 42.36],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

function getMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatTime(minutes) {
  const d = new Date(0, 0, 0, 0, minutes);
  return d.toLocaleString('en-US', { timeStyle: 'short' });
}

function filterTripsByMinute(tripArray, minute) {
  if (minute === -1) return tripArray.flat();
  const lower = (minute - 60 + 1440) % 1440;
  const upper = (minute + 60) % 1440;

  return lower > upper
    ? [...tripArray.slice(lower), ...tripArray.slice(0, upper)].flat()
    : tripArray.slice(lower, upper).flat();
}

function calculateTraffic(data, minute = -1) {
  const departures = d3.rollup(
    filterTripsByMinute(departuresByMinute, minute),
    v => v.length,
    d => d.start_station_id
  );
  const arrivals = d3.rollup(
    filterTripsByMinute(arrivalsByMinute, minute),
    v => v.length,
    d => d.end_station_id
  );

  return data.map(d => {
    d.departures = departures.get(d.short_name) || 0;
    d.arrivals = arrivals.get(d.short_name) || 0;
    d.total = d.departures + d.arrivals;
    return d;
  });
}

map.on('load', async () => {
  // Add bike routes
  map.addSource('bostonLanes', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({
    id: 'boston-lanes',
    type: 'line',
    source: 'bostonLanes',
    paint: { 'line-color': 'green', 'line-width': 3, 'line-opacity': 0.4 }
  });

  map.addSource('cambridgeLanes', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });
  map.addLayer({
    id: 'cambridge-lanes',
    type: 'line',
    source: 'cambridgeLanes',
    paint: { 'line-color': 'green', 'line-width': 3, 'line-opacity': 0.4 }
  });

  const json = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  stations = json.data.stations.filter(d => d.short_name && !isNaN(+d.lat) && !isNaN(+d.lon));

  trips = await d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv', t => {
    t.started_at = new Date(t.started_at);
    t.ended_at = new Date(t.ended_at);
    departuresByMinute[getMinutes(t.started_at)].push(t);
    arrivalsByMinute[getMinutes(t.ended_at)].push(t);
    return t;
  });

  const flowColor = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
  const sizeScale = d3.scaleSqrt().range([0, 25]);

  const svg = d3.select('#map').select('svg');
  let circles = svg.selectAll('circle');

  function projectCoords(station) {
    const pt = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(pt);
    return { cx: x, cy: y };
  }

  function redraw(minute) {
    const updated = calculateTraffic(stations, minute);
    sizeScale.domain([0, d3.max(updated, d => d.total)]);
    if (minute !== -1) sizeScale.range([3, 50]);

    circles = svg.selectAll('circle')
      .data(updated, d => d.short_name)
      .join('circle')
      .attr('r', d => sizeScale(d.total))
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.8)
      .attr('pointer-events', 'auto')
      .style('--departure-ratio', d => flowColor(d.departures / d.total || 0))
      .each(function(d) {
        d3.select(this).selectAll('title').data([d]).join('title')
          .text(`${d.total} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });

    updateCoords();
  }

  function updateCoords() {
    circles
      .attr('cx', d => projectCoords(d).cx)
      .attr('cy', d => projectCoords(d).cy);
  }

  map.on('move', updateCoords);
  map.on('zoom', updateCoords);
  map.on('resize', updateCoords);
  map.on('moveend', updateCoords);

  redraw(-1);

  const slider = document.getElementById("time-slider");
  const label = document.getElementById("current-time");
  const note = document.getElementById("all-hours");

  slider.addEventListener("input", () => {
    const val = +slider.value;
    if (val === -1) {
      label.textContent = '';
      note.style.display = 'inline';
    } else {
      label.textContent = formatTime(val);
      note.style.display = 'none';
    }
    redraw(val);
  });
});
