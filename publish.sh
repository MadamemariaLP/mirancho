#!/bin/sh
# Busca casas (salvo con --quick) y publica la app en GitHub Pages.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
if [ "$1" != "--quick" ]; then
  /usr/bin/python3 collector.py
  # traduce al español los anuncios italianos nuevos (sin conexión)
  [ -x .venv/bin/python ] && .venv/bin/python translate.py 2>>data/translate.log
fi
[ -d .git ] || exit 0
git add web
git diff --cached --quiet || git commit -q -m "Actualiza casas $(date '+%Y-%m-%d %H:%M')"
# sube si hay algo local sin publicar
[ -n "$(git log origin/main..main --oneline 2>/dev/null)" ] && git push -q origin main
exit 0
