# Ahara's Reading Room

A learning app for Ahara: reading in English, French and Tamil, all 247 Tamil
letters, grade 1–2 math, colors and numbers, a world map and chess.

## Put it online (once)

1. On GitHub, open **Settings → Pages** for this repository.
2. Under **Build and deployment**, choose **Deploy from a branch**, pick the
   branch that has this folder (and `/ (root)`), then **Save**.
3. After a minute or two the app is at
   `https://sujee89-dev.github.io/generative-art/ahara/`

## Install it on a device

Open that address on the device, then:

- **Android phone or tablet (Chrome):** menu ⋮ → **Install app** (or **Add to Home screen**).
- **iPhone or iPad (Safari):** Share button → **Add to Home Screen**.
- **Windows, Mac or Chromebook (Chrome or Edge):** the install icon at the right of the address bar.
- **Amazon Fire tablet:** in a parent profile, open the address in Silk → menu → **Add to Home**.
  In an Amazon Kids profile, add the address as an approved website in the Parent Dashboard.

After the first visit it works without internet. Stars and progress are saved
separately on each device.

## Updating

Change the files, push, and bump `VERSION` in `sw.js` so installed copies
refresh. Word lists live in `tools/src/`; rebuild with
`python3 tools/build_data.py`. The map and country facts rebuild with
`tools/build_world.js` (see the comment at its top).
