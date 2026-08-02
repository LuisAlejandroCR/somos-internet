#!/usr/bin/env bash
# Publica SOLO el código al repositorio público (somos-internet).
#
# Por qué existe este script en vez de dos .gitignore: git no soporta ignores
# distintos por remoto. Este workspace tiene un solo árbol de archivos que
# alimenta dos repos con contenidos distintos:
#
#   privado (somos-knowledge-base) → TODO: investigación + código
#   público (somos-internet)       → SOLO el código del demo
#
# El mecanismo es un git worktree sobre una rama huérfana: el repo público
# recibe su propia historia lineal, sin arrastrar ni un commit con material de
# candidatura. La investigación nunca toca el árbol público.
#
# Uso:  bash scripts/publish-public.sh "mensaje de commit"

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="public-main"
WORKTREE="$ROOT/.public-worktree"
MSG="${1:-chore: sync public code}"

cd "$ROOT"

# Lo único que se publica. Si se agrega una carpeta de código nueva, va acá.
PATHS=(
  "src"
  "functions"
  "public"
  "test"
  "raw"
  "scripts"
  "package.json"
  ".gitignore"
)

if ! git remote get-url public >/dev/null 2>&1; then
  echo "✗ Falta el remoto 'public'. Configuralo con:"
  echo "  git remote add public https://github.com/LuisAlejandroCR/somos-internet.git"
  exit 1
fi

# Crea la rama huérfana la primera vez.
if ! git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "→ Creando rama huérfana $BRANCH…"
  git worktree add --detach "$WORKTREE" >/dev/null
  git -C "$WORKTREE" checkout --orphan "$BRANCH" >/dev/null 2>&1
  git -C "$WORKTREE" rm -rf . >/dev/null 2>&1 || true
else
  [ -d "$WORKTREE" ] || git worktree add "$WORKTREE" "$BRANCH" >/dev/null
fi

# Limpia el árbol público y vuelve a copiar solo el código, para que un archivo
# borrado acá también desaparezca allá.
find "$WORKTREE" -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} +

for p in "${PATHS[@]}"; do
  [ -e "$ROOT/$p" ] || continue
  mkdir -p "$WORKTREE/$(dirname "$p")"
  cp -r "$ROOT/$p" "$WORKTREE/$(dirname "$p")/"
done

# README propio del repo público: el del workspace habla de la candidatura.
cp "$ROOT/docs/README-public.md" "$WORKTREE/README.md"

cd "$WORKTREE"
git add -A
if git diff --cached --quiet; then
  echo "✓ Sin cambios que publicar."
  exit 0
fi

echo "→ Archivos a publicar:"
git diff --cached --name-status | sed 's/^/   /'
git commit -q -m "$MSG"
echo ""
echo "✓ Commit listo en la rama $BRANCH."
echo "  Para publicarlo:  git push public $BRANCH:main"
