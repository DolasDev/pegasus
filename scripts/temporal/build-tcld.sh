#!/usr/bin/env bash
# build-tcld.sh — build Temporal Cloud's `tcld` CLI from source.
#
# tcld ships no prebuilt binaries, and the core `temporal` CLI has no `cloud`
# commands. This downloads a checksum-verified Go toolchain and runs
# `go install`, entirely under $PEGASUS_TCLD_HOME (default
# ~/.cache/pegasus-tcld): no system Go, no ~/go, nothing inside the repo.
#
# Usage:  scripts/temporal/build-tcld.sh
# Output: $PEGASUS_TCLD_HOME/bin/tcld   (then: <that path> login)
#
# Bumping: take the version + sha256 of the linux-amd64 archive from
# https://go.dev/dl/?mode=json, and the tcld tag from
# https://proxy.golang.org/github.com/temporalio/tcld/@v/list.
set -euo pipefail

GO_VERSION=go1.27.2
GO_SHA256=ecbadb99091a3f46e31f5f934b068b1864eafa7995211b39eaddf76996045fe5
TCLD_VERSION=v0.55.0

D="${PEGASUS_TCLD_HOME:-$HOME/.cache/pegasus-tcld}"
mkdir -p "$D"
cd "$D"

if [ ! -x "$D/go/bin/go" ]; then
  archive="$GO_VERSION.linux-amd64.tar.gz"
  curl -fL --proto '=https' -o "$archive" "https://go.dev/dl/$archive"
  echo "$GO_SHA256  $archive" | sha256sum -c -
  tar -xzf "$archive"
  rm "$archive"
fi

export GOROOT="$D/go" GOPATH="$D/gopath" GOBIN="$D/bin" GOCACHE="$D/gocache" GOTOOLCHAIN=local
"$D/go/bin/go" install "github.com/temporalio/tcld/cmd/tcld@$TCLD_VERSION"
"$D/bin/tcld" version
echo "OK: $D/bin/tcld"
