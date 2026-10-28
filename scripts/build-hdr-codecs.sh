#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PREFIX="$ROOT/build/hdr-codecs"
mkdir -p build/downloads build/vendor build/bin "$PREFIX"

download() {
  local name="$1" url="$2" expected="$3" actual
  if [[ ! -f "build/downloads/$name" ]]; then
    curl -fL --connect-timeout 20 --max-time 300 "$url" -o "build/downloads/$name.part"
    mv "build/downloads/$name.part" "build/downloads/$name"
  fi
  actual="$(shasum -a 256 "build/downloads/$name")"
  [[ "${actual%% *}" == "$expected" ]] || { printf 'Checksum mismatch: %s\n' "$name" >&2; exit 1; }
}
download jxrlib-f7521879862b9085318e814c6157490dd9dbbdb4.tar.gz \
  https://codeload.github.com/4creators/jxrlib/tar.gz/f7521879862b9085318e814c6157490dd9dbbdb4 \
  8ab20a21f6c3f8cfdedd2511b03a2009e52cce7fa6550202c355063d0d83213e
download zimg-release-3.0.6.tar.gz \
  https://codeload.github.com/sekrit-twc/zimg/tar.gz/refs/tags/release-3.0.6 \
  be89390f13a5c9b2388ce0f44a5e89364a20c1c57ce46d382b1fcc3967057577
download aom-v3.12.1.tar.gz \
  https://aomedia.googlesource.com/aom/+archive/refs/tags/v3.12.1.tar.gz \
  a0ff3374ab42f4b83809a8f83549378821f9953fb90f3788650662cd94e9d317

JXR="$ROOT/build/vendor/jxrlib-f7521879862b9085318e814c6157490dd9dbbdb4"
ZIMG="$ROOT/build/vendor/zimg-release-3.0.6"
AOM="$ROOT/build/vendor/aom-3.12.1"
[[ -d "$JXR" ]] || tar -xf build/downloads/jxrlib-f7521879862b9085318e814c6157490dd9dbbdb4.tar.gz -C build/vendor
[[ -d "$ZIMG" ]] || tar -xf build/downloads/zimg-release-3.0.6.tar.gz -C build/vendor
if [[ ! -d "$AOM" ]]; then
  mkdir -p "$AOM"
  tar -xf build/downloads/aom-v3.12.1.tar.gz -C "$AOM"
fi
JOBS="${BUILD_JOBS:-6}"
if [[ ! -f "$PREFIX/lib/libaom.a" ]]; then
  cmake -S "$AOM" -B "$ROOT/build/aom-build" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=13.5 -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DBUILD_SHARED_LIBS=OFF \
    -DENABLE_DOCS=OFF -DENABLE_EXAMPLES=OFF -DENABLE_TESTS=OFF -DENABLE_TOOLS=OFF \
    -DCONFIG_AV1_DECODER=1 -DCONFIG_AV1_ENCODER=1 -DCONFIG_AV1_HIGHBITDEPTH=1
  cmake --build "$ROOT/build/aom-build" -j "$JOBS"
  cmake --install "$ROOT/build/aom-build"
fi
if [[ ! -f "$PREFIX/lib/libzimg.a" ]]; then
  (
    cd "$ZIMG"
    ./autogen.sh
    CFLAGS='-O3 -mmacosx-version-min=13.5' CXXFLAGS='-O3 -mmacosx-version-min=13.5' \
      ./configure --prefix="$PREFIX" --disable-shared --enable-static --disable-simd
    make -j "$JOBS"
    make install
  )
fi
make -C "$JXR" -j "$JOBS" CC=/usr/bin/clang \
  CFLAGS="-I. -Icommon/include -Iimage/sys -D__ANSI__ -DDISABLE_PERF_MEASUREMENT -O2 -mmacosx-version-min=13.5 -Wno-error=implicit-function-declaration -Wno-error=incompatible-pointer-types"
/usr/bin/clang -std=c11 -O2 -Wall -Wextra -Werror -Wno-unused-parameter -mmacosx-version-min=13.5 \
  -D__ANSI__ -DDISABLE_PERF_MEASUREMENT -I"$JXR/common/include" -I"$JXR/image/sys" -I"$JXR/jxrgluelib" \
  macos/jxr-decode.c "$JXR/build/libjxrglue.a" "$JXR/build/libjpegxr.a" -lm -o build/bin/jxr-decode
