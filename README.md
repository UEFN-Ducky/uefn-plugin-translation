# Translation

Live-translate the UEFN Ducky UI into languages you add, using a chosen AI model. Strings are cached so each phrase is translated once.

Desktop plugin for [UEFN-Ducky](https://github.com/UEFN-Ducky/UEFN-Ducky) (`translation`).
Install or update from **Settings → Store** in the app — do not install from a zip by hand.

## Build

```bash
py scripts/build_zip.py
```

Writes `deploy/translation-1.0.48.ducky-plugin.zip` (scripts/ and deploy/ are not packed).
