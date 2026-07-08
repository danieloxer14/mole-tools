#!/usr/bin/env bash
set -euo pipefail

REPO="danieloxer/mole-tools"
INSTALL_DIR="/usr/local/bin"
BIN_NAME="mole-tools"
ASSET_NAME="mole-tools-darwin-arm64"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
	echo "error: mole-tools only ships a macOS arm64 binary." >&2
	exit 1
fi

echo "Resolving latest release..."
DOWNLOAD_URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
	| grep "\"browser_download_url\".*${ASSET_NAME}" \
	| sed -E 's/.*"browser_download_url": "([^"]+)".*/\1/')

if [[ -z "${DOWNLOAD_URL}" ]]; then
	echo "error: could not find a ${ASSET_NAME} asset on the latest release." >&2
	exit 1
fi

TMP_FILE=$(mktemp)
trap 'rm -f "${TMP_FILE}"' EXIT

echo "Downloading ${DOWNLOAD_URL}..."
curl -fsSL "${DOWNLOAD_URL}" -o "${TMP_FILE}"
chmod +x "${TMP_FILE}"

TARGET="${INSTALL_DIR}/${BIN_NAME}"
if [[ -w "${INSTALL_DIR}" ]]; then
	mv "${TMP_FILE}" "${TARGET}"
else
	echo "${INSTALL_DIR} is not writable by the current user; sudo is required to install to it."
	sudo mv "${TMP_FILE}" "${TARGET}"
fi
trap - EXIT

if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
	echo "warning: ${INSTALL_DIR} is not on your PATH."
	echo "  Add this to your shell profile: export PATH=\"${INSTALL_DIR}:\$PATH\""
fi

echo "Installed $("${TARGET}" --version 2>/dev/null || echo "${BIN_NAME}") to ${TARGET}"
echo "Run '${BIN_NAME} init' next to write a default config."
