# Unit Portraits

Drop unit portrait images here. The filename must match the `portrait` field in `units.json`.

## Naming convention

```
portraits/<unit_id>.png   ← recommended (PNG with transparency)
portraits/<unit_id>.jpg
portraits/<unit_id>.webp
```

## How to enable

Add or update the `"portrait"` field in `units.json`:

```json
{
  "id": "soldier",
  "portrait": "portraits/soldier.png",
  ...
}
```

If the file is missing or the field is omitted, the card falls back to the SVG ability icon automatically.

## Image guidelines

- Recommended size: **160 × 200 px** (portrait orientation, 4:5 ratio)
- Subject should be centered and biased toward the **top** — the bottom ~20% may be cropped by the card info bar
- Transparent background (PNG) blends best with the card gradient
- WebP is preferred for smaller file size on Android
