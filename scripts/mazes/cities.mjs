/**
 * The 7 City Chase areas. Centre points are picked by hand; the builder takes
 * a square of RADIUS_M around each one, rotated to the street grid.
 */
export const RADIUS_M = 750

export const CITIES = [
  { id: 'nyc-midtown', name: 'Manhattan Midtown', city: 'New York', lat: 40.7549, lon: -73.9840, timezone: 'America/New_York' },
  { id: 'tokyo-shibuya', name: 'Shibuya', city: 'Tokyo', lat: 35.6595, lon: 139.7005, timezone: 'Asia/Tokyo' },
  { id: 'paris-marais', name: 'Le Marais', city: 'Paris', lat: 48.8590, lon: 2.3600, timezone: 'Europe/Paris' },
  { id: 'london-soho', name: 'Soho', city: 'London', lat: 51.5136, lon: -0.1340, timezone: 'Europe/London' },
  { id: 'barcelona-eixample', name: 'Eixample', city: 'Barcelona', lat: 41.3917, lon: 2.1649, timezone: 'Europe/Madrid' },
  { id: 'mumbai-fort', name: 'Fort', city: 'Mumbai', lat: 18.9330, lon: 72.8340, timezone: 'Asia/Kolkata' },
  { id: 'sf-mission', name: 'The Mission', city: 'San Francisco', lat: 37.7599, lon: -122.4148, timezone: 'America/Los_Angeles' },
  // Phase 2 additions
  { id: 'rome-centro', name: 'Centro Storico', city: 'Rome', lat: 41.8986, lon: 12.4769, timezone: 'Europe/Rome' },
  { id: 'berlin-mitte', name: 'Mitte', city: 'Berlin', lat: 52.5200, lon: 13.4050, timezone: 'Europe/Berlin' },
  { id: 'seoul-gangnam', name: 'Gangnam', city: 'Seoul', lat: 37.4979, lon: 127.0276, timezone: 'Asia/Seoul' },
  { id: 'singapore-chinatown', name: 'Chinatown', city: 'Singapore', lat: 1.2834, lon: 103.8443, timezone: 'Asia/Singapore' },
  { id: 'dubai-deira', name: 'Deira', city: 'Dubai', lat: 25.2697, lon: 55.3095, timezone: 'Asia/Dubai' },
  { id: 'sydney-cbd', name: 'CBD', city: 'Sydney', lat: -33.8688, lon: 151.2093, timezone: 'Australia/Sydney' },
  { id: 'rio-centro', name: 'Centro', city: 'Rio de Janeiro', lat: -22.9035, lon: -43.1790, timezone: 'America/Sao_Paulo' },
  { id: 'istanbul-beyoglu', name: 'Beyoğlu', city: 'Istanbul', lat: 41.0340, lon: 28.9780, timezone: 'Europe/Istanbul' },
  { id: 'toronto-downtown', name: 'Downtown', city: 'Toronto', lat: 43.6510, lon: -79.3830, timezone: 'America/Toronto' },
  { id: 'amsterdam-centrum', name: 'Centrum', city: 'Amsterdam', lat: 52.3730, lon: 4.8930, timezone: 'Europe/Amsterdam' },
  { id: 'chicago-loop', name: 'The Loop', city: 'Chicago', lat: 41.8819, lon: -87.6278, timezone: 'America/Chicago' },
  { id: 'delhi-cp', name: 'Connaught Place', city: 'New Delhi', lat: 28.6315, lon: 77.2167, timezone: 'Asia/Kolkata' },
  { id: 'bengaluru-mg-road', name: 'MG Road', city: 'Bengaluru', lat: 12.9756, lon: 77.6050, timezone: 'Asia/Kolkata' },
]
