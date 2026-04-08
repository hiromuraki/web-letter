#!/bin/bash

podman run --rm -it \
    -p 8000:8000 \
    -v "$(pwd)/data":/data \
    -e LETTER_FILE=/data/letter.txt \
    -e LETTER_PASSWORD=000000 \
    ghcr.io/hiromuraki/web-letter:latest