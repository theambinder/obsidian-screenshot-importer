#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/build/vendor/ffmpeg-7.1.5"
./configure \
  --cc=/usr/bin/clang --arch=arm64 --target-os=darwin \
  --extra-cflags=-mmacosx-version-min=13.5 --extra-ldflags=-mmacosx-version-min=13.5 \
  --disable-everything --disable-autodetect --disable-shared --enable-static \
  --disable-debug --disable-doc --disable-network --disable-iconv \
  --disable-audiotoolbox --disable-videotoolbox --disable-securetransport \
  --enable-ffmpeg --enable-zlib --enable-protocol=file \
  --enable-decoder=png,mjpeg,tiff,bmp,webp,gif \
  --enable-encoder=png,mjpeg --enable-parser=png,mjpeg,webp \
  --enable-demuxer=image2,image2pipe,gif \
  --enable-muxer=image2,image2pipe --enable-filter=scale,format,null
make -j "${BUILD_JOBS:-6}" ffmpeg
