# Reading Room apps: Ahara and Aria

Two learning apps built from one shared engine:

| App | Languages | Web | Fire / Android app |
| --- | --- | --- | --- |
| **Ahara** | English, French, Tamil (all 247 letters) | `https://sujee89-dev.github.io/generative-art/ahara/` | `https://sujee89-dev.github.io/generative-art/downloads/` |
| **Aria** | English, French, Nepali (vowels, consonants, barahkhari) | `https://sujee89-dev.github.io/generative-art/aria/` | `https://sujee89-dev.github.io/generative-art/downloads/aria/` |

Both have words, sentences, books, games, grade 1–2 math, colors and numbers,
a world map and chess. The two apps install side by side and keep separate progress.

## Put it on an Amazon Fire tablet with Amazon Kids

1. Switch to the **parent profile**. Kids profiles cannot install apps.
2. Settings → **Security & Privacy** → **Apps from Unknown Sources** → turn on **Silk Browser**.
3. In Silk, open the download page above and tap **Download the app**, then **Install**.
4. Settings → **Profiles & Family Library** (on newer tablets: **Amazon Kids**) → the child's profile →
   **Add Content** → **Apps** → tick **Ahara** or **Aria**.
   You can also do this from the Amazon Parent Dashboard (parents.amazon.com).
5. The app now shows on the child's home screen. It works offline and updates itself:
   when a new version is out, a banner asks a grown-up to tap **Update** (from the parent profile).

### Sound
The app talks with the tablet's text-to-speech. Open **Sound check** (the speaker button
at the top) to see which languages have a voice. Fire tablets usually have English and
French. Few devices have a Nepali voice; the app then uses a Hindi voice, which reads
Devanagari well. If no voice exists for a language, the words still show, and
**Sound check** lists anything that went wrong on the device.

## How it is built

- `shared/`: the engine (`app.js`, `style.css`, `world.js`, `chess.js`, `android-tts.js`) and data.
- `ahara/`, `aria/`: generated per-child pages and icons. Edit `tools/apps.json`, then run
  `python3 tools/build_apps.py`.
- Word lists live in `tools/src/` (`words-*.txt`, `gloss-*.txt`, `pictures*.tsv`); rebuild with
  `python3 tools/build_data.py`. Books are in `shared/data/books-*.js`.
- `android/`: one WebView app with two flavors. Pushing to the branch builds both APKs
  with GitHub Actions (`.github/workflows/android.yml`) and puts them on the download pages.
