// Tuning for Kestrel Isles: the world, the aircraft and the scoring, in one place. Units are metres,
// seconds, kilograms; the HUD shows knots, feet and degrees as pilots read them.

export const STEP = 1 / 120; // physics step, seconds

export const WORLD = {
  seed: 7139,
  size: 9000, // the terrain square, metres a side, centred on the origin
  grid: 320, // terrain cells a side
  sea: 0,
  fogDensity: 0.00016,
};

/** The two airfields. Heading in degrees; the runway is a flat strip of `length` × `width`. */
export const AIRFIELDS = [
  { id: 'gull', name: 'Gullhaven Field', x: -3950, z: 500, heading: 10, elevation: 24, length: 900, width: 30 },
  { id: 'cinder', name: 'Cinder Point Strip', x: 3900, z: -1600, heading: 30, elevation: 48, length: 640, width: 24 },
];

/** The Kestrel KS-2, a two-seat high-wing bush plane. */
export const AIRCRAFT = {
  name: 'Kestrel KS-2',
  thrust: 7.2, // m/s² at full throttle
  drag: 0.00135, // per metre: deceleration = drag × speed²
  stallSpeed: 27, // m/s (≈ 52 kt)
  rotateSpeed: 31, // m/s, nose can lift from the runway
  neverExceed: 82, // m/s (≈ 160 kt), overspeed damage above
  pitchRate: 1.15, // rad/s at full authority
  rollRate: 2.3,
  yawRate: 0.45,
  fuelCapacity: 120, // litres
  burnFull: 0.55, // litres per second at full throttle
  burnIdle: 0.05,
  gearHeight: 1.7, // wheels to centre of mass
  brake: 4.5, // m/s² with brakes on
  rolling: 0.35, // m/s² rolling friction
};

export const LANDING = {
  maxSink: 4.2, // m/s at touchdown before it is a crash
  softSink: 2.0, // m/s and under: a 'greaser'
  maxBank: 14, // degrees
  maxSpeed: 46, // m/s
};

export const SCORE = {
  ring: 250,
  perfectLanding: 600,
  goodLanding: 350,
  firmLanding: 150,
  fuelPerLitre: 4,
  timeBonusPerSecond: 6,
  damagePenalty: 5, // per damage point
};
