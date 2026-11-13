# Fable Station

A cinematic, interactive 3D space observatory built with Three.js and Vite: a procedurally modeled orbital space station floating above a shader-generated planet. Nothing is downloaded. Every model, texture and sound is generated in code.

**Live demo:** https://fable-station.vercel.app

## Features

- **Station:** segmented rotating habitat ring with lit windows and trusses, reactor, twelve solar wings with generated cell textures, radiator panels, comms dish, docking modules, and a small supply ship on its own orbit.
- **Planet:** procedural ocean, continent and cloud shader with atmospheric glow, a seeded starfield, and bloom post-processing.
- **Camera views:** Overview, Habitat, Solar arrays, Reactor, with animated transitions and an info panel each (keys `1`–`4`).
- **Controls:** drag to orbit, scroll or pinch to zoom, click parts to select them, pause rotation, eclipse lighting, opt-in synthesized ambient audio, and cinematic mode on `H` (`Esc` exits).
- **Performance:** static meshes are batched into as few draw calls as possible while animated parts stay independent. A test checks the batching.
- **Accessibility and devices:** respects reduced motion, stops rendering when the tab is hidden, and works on phones.

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # production build to dist/
npm test         # run the batching tests
```

## Original prompt

This project was generated from the following prompt:

> Build a cinematic, interactive 3D space observatory with Three.js and Vite: a procedurally modeled orbital space station floating above a shader-generated planet. No downloaded models, textures or audio files; everything is built in code.
>
> - Station: a segmented rotating habitat ring with lit windows and trusses, a reactor, twelve solar wings with generated cell textures, radiator panels, a comms dish, docking modules, and a small supply ship on its own orbit.
> - Planet: procedural ocean, continent and cloud shader with atmospheric glow; a seeded starfield; bloom post-processing.
> - Four camera views (Overview, Habitat, Solar arrays, Reactor) with animated transitions and an info panel each; keys 1–4.
> - Controls: drag to orbit, scroll or pinch to zoom, click parts to select them, pause rotation, eclipse lighting, opt-in synthesized ambient audio, and a cinematic mode on H (Escape exits).
> - Batch static meshes into as few draw calls as possible while keeping animated parts independent, and add a test that checks the batching.
> - Respect reduced-motion, stop rendering when the tab is hidden, and make it work on phones.
