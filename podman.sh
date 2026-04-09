#!/bin/bash
set -e

if podman build -t web-letter:latest . ; then
    echo "Successfully built the image."
else
    echo "Failed to build the image. Please check the Dockerfile and try again."
    exit 1
fi

podman run --rm -it \
    -p 8000:8000 \
    -v "$(pwd)/sample-data":/data \
    -e LETTER_FILE=/data/letter.txt \
    -e LETTER_PASSWORD=000000 \
    web-letter:latest