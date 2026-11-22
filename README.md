# Foil Keepsake

Smooth out a chocolate wrapper, press something into the foil, and send it to someone. Like the ones we kept tucked in our school notebooks.

A static site with no build step and no dependencies.

```sh
python3 serve.py   # then open http://localhost:5178
```

It has to be served over http(s), because ES modules and the AudioWorklet don't load from `file://`. Any static host works (GitHub Pages, Netlify, etc.).

## How it works

- **Foil** (`js/crinkle-worker.js`, `js/foil.js`): for each wrapper, a crumple is generated in a worker from a seed. Creases radiate from crumple points and wander, bending and fading as they go. Each one is a sharp, narrow fold (a thin crest beside a thin valley), and the patches between them are left nearly flat at slightly different tilts. A layer of tiny micro-creases, some gentle unevenness, and a fold or two from wrapping the bar sit on top. WebGL2 lights it as metal (GGX highlight plus a simple room reflection). The light stays put and you tilt the foil to catch it, like holding a real wrapper: with a mouse the sheet tips toward wherever you hover (and lies flat while you press), and on phones it follows the tilt of the phone.
- **Pressing** (`js/impressions.js`, `js/foil.js`): a stroke leaves a broad, rounded channel with soft shoulders, like a blunt stylus pushed into foil lying on something soft. The foil around it is dragged down with it, so the sheet bends: two GPU Gaussian blurs of the groove map, a near shoulder (~12px) and a sheet-scale bow (~44px), add broad tilt around the work. Areas between close lines puff up, and densely worked areas sink. The crinkle stays, only pressed a little flatter near the lines.
- **Stamps** (`js/stamps.js`): preset motifs after Mexican tin (hojalata) work: a flaming heart, sun, C-scroll, leaf, tulip, moon, rosette and vine, drawn with fine lines, spirals, veins and rows of beads, pressed with the same groove profile as a stylus, with a firmer crunch. Each press is a little bigger or smaller and a few degrees off, like one done by hand.
- **Opening a shared one**: it arrives folded in half and in half again (a packet made from pictures of the actual foil) with a small label on it. Tap to open: it unfolds one half at a time, keeps faint creases where it was folded, then the pressing replays at a hand's pace. Stamps press in gradually.
- **Crunch** (`js/crunch-worklet.js`): a quiet crinkle sound (it's a tiny piece of foil) made in an AudioWorklet. It plays clustered noise clicks through loose band-passes, with occasional lower crunches and a faint tip scratch. How dense the clicks are depends on how fast you write.
- **Sharing** (`js/share.js`): the foil colour, crinkle seed and every stroke are delta/varint packed, deflated, and stored in the URL hash. No server is involved. Opening the link replays it being pressed in, with sound.
