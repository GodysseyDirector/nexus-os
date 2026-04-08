#!/usr/bin/env bash
# NEXUS OS — Full Source Backup
# Exports every .js / .py / .json / .sh source file into one readable text file
# Output: ~/Desktop/NEXUS_FULL_BACKUP_<timestamp>.txt
#
# Usage:  bash scripts/export-full-backup.sh
#         bash scripts/export-full-backup.sh --dest /path/to/output.txt

set -e

DEST="${2:-$HOME/Desktop/NEXUS_FULL_BACKUP_$(date +%s).txt}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "NEXUS OS Full Source Backup"
echo "==========================="
echo "Source : $ROOT"
echo "Output : $DEST"
echo ""

{
  echo "==== NEXUS OS FULL SOURCE BACKUP ===="
  echo "Generated : $(date)"
  echo "Version   : $(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo 'unknown')"
  echo "======================================"

  find "$ROOT" -type f \( \
    -name "*.js"   -o \
    -name "*.py"   -o \
    -name "*.json" -o \
    -name "*.sh"   -o \
    -name "*.md"   \
  \) \
  ! -path "*/node_modules/*" \
  ! -path "*/dist/*" \
  ! -path "*/release/*" \
  ! -path "*/.git/*" \
  ! -path "*/bundled/*" \
  ! -path "*/backups/*" \
  | sort \
  | while read -r file; do
      relpath="${file#$ROOT/}"
      echo ""
      echo ""
      echo "===== FILE: $relpath ====="
      echo ""
      cat "$file"
    done

  echo ""
  echo ""
  echo "===== END OF BACKUP ====="

} > "$DEST"

SIZE=$(du -sh "$DEST" | cut -f1)
echo "Done. Backup size: $SIZE"
echo "Saved to: $DEST"
