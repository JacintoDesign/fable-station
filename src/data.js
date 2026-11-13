// Copy and camera framing for the four views, plus the selectable parts.
// One scene unit is ten metres.

export const VIEWS = [
  {
    id: 'overview',
    label: 'Overview',
    short: 'Overview',
    camera: { target: [0, -3, 0], theta: 0.72, phi: 1.12, radius: 66 },
    text: 'Fable Station circles the planet every 92 minutes. A crew of 46 lives in the rotating ring; power, cooling and docking all hang off the central spine.',
    stats: [
      ['Altitude', '412 km'],
      ['Orbital period', '92 min'],
      ['Crew', '46'],
      ['Lighting', { live: 'mode' }],
      ['Draw calls', { live: 'draws' }],
    ],
  },
  {
    id: 'habitat',
    label: 'Habitat',
    short: 'Habitat',
    camera: { target: [5.5, 0.4, 4.5], theta: 0.95, phi: 1.2, radius: 15 },
    text: 'Twelve pressurised segments turn about the hub. Spin presses the crew against the outer rim at a little over a third of Earth gravity, enough to walk, cook and sleep normally.',
    stats: [
      ['Ring radius', '90 m'],
      ['Spin', { live: 'spin' }],
      ['Rim gravity', { live: 'gravity' }],
      ['Segments', '12'],
    ],
  },
  {
    id: 'solar',
    label: 'Solar arrays',
    short: 'Solar',
    camera: { target: [11, -6, 2], theta: 0.35, phi: 0.95, radius: 27 },
    text: 'Twelve wings, each 106 metres long, hang from the transverse truss and tilt toward the sun. In the planet’s shadow they produce nothing and the station runs on the reactor.',
    stats: [
      ['Wings', '12'],
      ['Wing length', '106 m'],
      ['Array output', { live: 'solar' }],
      ['Cell area', '26,700 m²'],
    ],
  },
  {
    id: 'reactor',
    label: 'Reactor',
    short: 'Reactor',
    camera: { target: [0, -16.4, 0], theta: -0.85, phi: 1.9, radius: 14 },
    text: 'A compact fusion core sits at the foot of the spine behind a shadow shield. A magnetic rotor holds the plasma in place and four radiator fins shed the waste heat to space.',
    stats: [
      ['Output', '4.2 MW'],
      ['Rotor speed', { live: 'rotor' }],
      ['Radiator area', '4 × 1,920 m²'],
      ['Load', { live: 'load' }],
    ],
  },
];

const SOLAR_PARTS = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return [
      `solar-${n}`,
      {
        name: `Solar wing ${n}`,
        text: 'Two cell blankets stretched along a deployable mast. Each wing delivers about 900 kW in full sun.',
        stats: [
          ['Length', '106 m'],
          ['Peak output', '900 kW'],
        ],
      },
    ];
  }),
);

export const PARTS = {
  habitat: {
    name: 'Habitat ring',
    text: 'Living quarters, labs and gardens in twelve linked segments. The lit windows are crew cabins.',
    stats: [
      ['Radius', '90 m'],
      ['Crew', '46'],
    ],
  },
  hub: {
    name: 'Hub and spokes',
    text: 'The hub turns with the ring. Six spokes carry lifts between the weightless core and the rim.',
    stats: [
      ['Spokes', '6'],
      ['Lift ride', '40 s'],
    ],
  },
  spine: {
    name: 'Central spine',
    text: 'The structural backbone. Propellant and water tanks cluster around it, close to the centre of mass.',
    stats: [['Length', '230 m']],
  },
  truss: {
    name: 'Power truss',
    text: 'An open lattice that carries the solar wings and routes their output back to the spine.',
    stats: [['Span', '410 m']],
  },
  radiators: {
    name: 'Radiator fins',
    text: 'Coolant loops run through four fins that glow dull orange as they radiate reactor heat away.',
    stats: [
      ['Fins', '4'],
      ['Surface temperature', '820 K'],
    ],
  },
  reactor: {
    name: 'Fusion reactor',
    text: 'Confinement coils and a spinning rotor cage the plasma. The shield above it keeps the crew in its shadow.',
    stats: [
      ['Output', '4.2 MW'],
      ['Plasma', '140 million K'],
    ],
  },
  docking: {
    name: 'Docking modules',
    text: 'Two berthing arms, an airlock and an observation cupola. Green rings mark the ports that are free.',
    stats: [
      ['Ports', '4'],
      ['Free', '3'],
    ],
  },
  comms: {
    name: 'Comms dish',
    text: 'A steerable high-gain antenna that tracks relay satellites as the station moves around the planet.',
    stats: [
      ['Diameter', '46 m'],
      ['Band', 'Ka'],
    ],
  },
  ship: {
    name: 'Supply ship Wren',
    text: 'An uncrewed cargo tug holding a slow orbit around the station while it waits for a berth.',
    stats: [
      ['Cargo', '6.4 t'],
      ['Stand-off', '270 m'],
    ],
  },
  ...SOLAR_PARTS,
};
