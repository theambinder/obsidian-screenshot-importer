#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="$ROOT/build/hdr-codecs"
cd "$ROOT/build/vendor/ffmpeg-7.1.5"
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
./configure \
  --cc=/usr/bin/clang --arch=arm64 --target-os=darwin \
  --extra-cflags="-mmacosx-version-min=13.5 -I../../hdr-codecs/include" --extra-ldflags="-mmacosx-version-min=13.5 -L../../hdr-codecs/lib" \
  --pkg-config-flags=--static --extra-libs=-lc++ \
  --disable-everything --disable-autodetect --disable-shared --enable-static \
  --disable-debug --disable-doc --disable-network --disable-iconv \
  --disable-audiotoolbox --disable-videotoolbox --disable-securetransport \
  --enable-ffmpeg --enable-zlib --enable-libaom --enable-libzimg --enable-protocol=file \
  --enable-decoder=png,mjpeg,tiff,bmp,webp,gif,libaom_av1,rawvideo \
  --enable-encoder=png,mjpeg,libaom_av1,rawvideo --enable-parser=png,mjpeg,webp,av1 \
  --enable-demuxer=image2,image2pipe,gif,rawvideo,mov \
  --enable-muxer=image2,image2pipe,avif,rawvideo --enable-bsf=av1_metadata \
  --enable-filter=scale,format,null,zscale,setparams,tonemap
make -j "${BUILD_JOBS:-6}" ffmpeg
