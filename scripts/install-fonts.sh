#!/bin/bash
# install-fonts.sh — Install all fonts required for card image generation
# Run as root: sudo bash scripts/install-fonts.sh

set -e

echo "=== Installing fonts for card image generation ==="

# ── 1. System packages ───────────────────────────────────────────────────────
echo ""
echo "[1/3] Installing system font packages..."

apt-get update -qq

# Microsoft core fonts (Arial, Impact, Georgia, Verdana, Courier New, Times New Roman)
echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula boolean true" \
  | debconf-set-selections
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ttf-mscorefonts-installer \
  fonts-liberation \
  fonts-inter \
  unzip \
  2>/dev/null

# ── 2. Google Fonts from gstatic CDN ─────────────────────────────────────────
echo ""
echo "[2/3] Downloading Google Fonts..."

DEST="/usr/share/fonts/truetype/google-fonts"
TMP=$(mktemp -d)
mkdir -p "$DEST"

# Get font URLs dynamically from Google Fonts CSS API
CSS_URL="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Montserrat:wght@400;700&family=Poppins:wght@400;700&family=Oswald:wght@400;700&family=Orbitron:wght@400;700&family=Russo+One&family=Exo+2:wght@400;700&family=Rajdhani:wght@400;700&display=swap"

FONT_URLS=$(curl -sL "$CSS_URL" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
  | grep -o "https://fonts.gstatic.com/[^)]*\.ttf")

if [ -z "$FONT_URLS" ]; then
  echo "  Warning: Could not fetch font URLs from Google Fonts API. Skipping Google Fonts."
else
  declare -A FONT_NAMES=(
    ["bebasneue"]="BebasNeue"
    ["montserrat"]="Montserrat"
    ["poppins"]="Poppins"
    ["oswald"]="Oswald"
    ["orbitron"]="Orbitron"
    ["russoone"]="RussoOne"
    ["exo2"]="Exo2"
    ["rajdhani"]="Rajdhani"
  )

  i=0
  while IFS= read -r URL; do
    FILENAME=$(basename "$URL" | cut -d'?' -f1)
    # Determine font name from URL path
    SLUG=$(echo "$URL" | grep -o "/s/[^/]*/" | head -1 | tr -d '/s/')
    NAME="${FONT_NAMES[$SLUG]:-font}"
    OUTFILE="${NAME}-${i}.ttf"

    echo -n "  Downloading $OUTFILE... "
    curl -sL "$URL" -o "$TMP/$OUTFILE"
    TYPE=$(file -b "$TMP/$OUTFILE" | head -c 20)
    if echo "$TYPE" | grep -qi "TrueType\|font"; then
      cp "$TMP/$OUTFILE" "$DEST/"
      echo "OK"
    else
      echo "SKIP"
    fi
    ((i++)) || true
  done <<< "$FONT_URLS"
fi

rm -rf "$TMP"

# ── 3. Update font cache ──────────────────────────────────────────────────────
echo ""
echo "[3/3] Updating font cache..."
fc-cache -fv "$DEST" 2>&1 | tail -1
fc-cache -fv 2>&1 | tail -1

echo ""
echo "=== Done! Installed fonts ==="
fc-list | grep -E "Arial|Impact|Georgia|Verdana|Courier New|Inter|Bebas|Montserrat|Poppins|Oswald|Orbitron|Russo|Exo|Rajdhani" \
  | sed 's|/usr/share/fonts/[^:]*: ||' | sort -u

echo ""
echo "Remember to restart the bot after running this script!"
