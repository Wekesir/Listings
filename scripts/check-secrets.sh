#!/usr/bin/env bash
set -euo pipefail

# Scans staged files for common secret patterns before commit.

staged_files="$(git diff --cached --name-only --diff-filter=ACMR)"
if [[ -z "${staged_files}" ]]; then
  exit 0
fi

# Secret-like patterns that should never be committed.
patterns=(
  'GOCSPX-[A-Za-z0-9_-]{10,}'                                    # Google OAuth client secret
  '[0-9]+-[a-z0-9]{20,}\.apps\.googleusercontent\.com'            # Google OAuth client id
  're_[A-Za-z0-9_]{16,}'                                          # Resend API key
  '(AKIA|ASIA)[A-Z0-9]{16}'                                       # AWS access key id
  'gh[pousr]_[A-Za-z0-9]{20,}'                                    # GitHub tokens
  'xox[baprs]-[A-Za-z0-9-]{10,}'                                  # Slack tokens
  '-----BEGIN (RSA |EC |OPENSSH |)?PRIVATE KEY-----'              # PEM private keys
)

blocked=0

while IFS= read -r file; do
  [[ -z "${file}" ]] && continue

  # Read staged content (index), not working tree.
  if ! content="$(git show ":${file}" 2>/dev/null)"; then
    continue
  fi

  for pattern in "${patterns[@]}"; do
    if printf '%s\n' "${content}" | rg -n --pcre2 "${pattern}" >/tmp/kr_secret_hits 2>/dev/null; then
      blocked=1
      echo
      echo "Potential secret detected in staged file: ${file}"
      cat /tmp/kr_secret_hits
    fi
  done
done <<< "${staged_files}"

rm -f /tmp/kr_secret_hits

if [[ "${blocked}" -eq 1 ]]; then
  echo
  echo "Commit blocked: remove secrets from staged files and try again."
  echo "Tip: keep real values only in local .env files and leave .env.example placeholders blank."
  exit 1
fi

exit 0
