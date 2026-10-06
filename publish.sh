#!/bin/sh
# Busca casas (salvo con --quick) y publica la app en GitHub Pages.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
[ "$1" = "--quick" ] || /usr/bin/python3 collector.py
[ -d .git ] || exit 0
git add web
git diff --cached --quiet && exit 0
git commit -q -m "Actualiza casas $(date '+%Y-%m-%d %H:%M')"
git push -q origin main
