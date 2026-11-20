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
]
