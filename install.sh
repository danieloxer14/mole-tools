#!/usr/bin/env bash
set -euo pipefail

REPO="danieloxer14/mole-tools"
INSTALL_DIR="/usr/local/bin"
BIN_NAME="mole-tools"
ASSET_NAME="mole-tools-darwin-arm64"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
	echo "error: mole-tools only ships a macOS arm64 binary." >&2
	exit 1
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ASSET_NAME}"
TMP_FILE=$(mktemp)
trap 'rm -f "${TMP_FILE}"' EXIT

echo "Downloading the latest ${ASSET_NAME} release..."
if ! curl --fail --location --silent --show-error --retry 3 "${DOWNLOAD_URL}" -o "${TMP_FILE}"; then
	echo "error: could not download ${ASSET_NAME} from the latest GitHub release." >&2
	echo "       Publish a release containing an asset named ${ASSET_NAME}." >&2
	exit 1
fi
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
