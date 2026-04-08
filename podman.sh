#!/bin/bash
set -e

if podman pull ghcr.io/hiromuraki/web-letter:latest ; then
    echo "Successfully pulled the latest image."
else
    echo "Failed to pull the latest image. Please check your network connection and try again."
    exit 1
fi

podman run --rm -it \
    -p 8000:8000 \
    -v "$(pwd)/data":/data \
    -e LETTER_FILE=/data/letter.txt \
    -e LETTER_PASSWORD=000000 \
    ghcr.io/hiromuraki/web-letter:latest