#!/usr/bin/env bash
#
# Rebuild the Fade In / Open Screenplay Format test corpus.
#
# test-script/samples/ is gitignored, so these files are not in the repo.  This
# fetches them from their publishers: Fade In's own document templates (which
# are real .fadein archives, and the only easy source of non-screenplay element
# sets) and the published OSF sample documents for every spec revision.
#
#   ./test-script/fetch-osf-corpus.sh
#   cd frontend && npx vite-node ../test-script/osf-corpus.mjs ../test-script/samples
#
# Revision 4.0 matters most: it renamed the paragraph style reference from
# `basestylename` to `basestyle`, which is what broke import in issue #61.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/test-script/samples/wild"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

echo "→ Fade In document templates"
for pack in screenplay_templates stageplay_templates misc_script_templates manuscript_templates; do
  curl -fsSL -o "$work/$pack.zip" "https://www.fadeinpro.com/download/templates/$pack.zip"
  unzip -q -o "$work/$pack.zip" -d "$work/packs"
done

# Each .fadein.template is a ZIP holding document.xml — the same shape as a
# .fadein, so rename rather than repackage.
find "$work/packs" -name '*.fadein.template' -print0 | while IFS= read -r -d '' template; do
  name="$(basename "$template" .fadein.template | tr ' ()' '___')"
  cp "$template" "$out/tmpl-$name.fadein"
done

echo "→ published OSF sample documents"
git clone -q --depth 1 https://github.com/OpenScreenplayFormat/osf-sdk.git "$work/osf-sdk"
git clone -q --depth 1 https://github.com/severdia/Open-Screenplay-Format.git "$work/osf-spec"
git clone -q --depth 1 https://github.com/rsdoiel/osf.git "$work/osf-go"

cp "$work/osf-sdk/v1.2/file_format.xml" "$out/spec-osf-1.2.osf"
cp "$work/osf-sdk/v2/OSF-2.0.xml"       "$out/spec-osf-2.0.osf"
cp "$work/osf-spec/OSF-2.1.xml"         "$out/spec-osf-2.1.osf"
cp "$work/osf-sdk/v4/OSF-4.0.xml"       "$out/spec-osf-4.0.osf"

# Fade In 3.x files, saved by the application itself.
cp "$work"/osf-go/testdata/*.fadein "$root/test-script/samples/" 2>/dev/null || true
cp "$work"/osf-go/testdata/Screenplay_Sample.osf "$root/test-script/samples/" 2>/dev/null || true

echo
echo "$(find "$root/test-script/samples" \( -name '*.fadein' -o -name '*.osf' \) | wc -l | tr -d ' ') files in test-script/samples"
