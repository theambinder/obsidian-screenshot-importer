#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <JXRGlue.h>

static int failure(const char *message) {
    fprintf(stderr, "%s\n", message);
    return 1;
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--version") == 0) {
        puts("jxr-decode 1.0 (Microsoft jxrlib)");
        return 0;
    }
    if (argc != 3) return failure("Usage: jxr-decode input.jxr output.raw | --info input.jxr");
    int info_only = strcmp(argv[1], "--info") == 0;
    const char *input_path = argv[info_only ? 2 : 1];
    struct stat source;
    if (lstat(input_path, &source) || !S_ISREG(source.st_mode)) return failure("JXR input must be a regular file");
    PKCodecFactory *factory = NULL;
    PKImageDecode *decoder = NULL;
    void *pixels = NULL;
    float *row = NULL;
    FILE *output = NULL;
    int result = 1, created = 0;
    if (Failed(PKCreateCodecFactory(&factory, WMP_SDK_VERSION)) ||
        Failed(factory->CreateDecoderFromFile(input_path, &decoder))) goto cleanup;
    I32 width = 0, height = 0;
    PKPixelFormatGUID guid;
    if (Failed(decoder->GetSize(decoder, &width, &height)) || Failed(decoder->GetPixelFormat(decoder, &guid))) goto cleanup;
    if (width < 1 || height < 1 || width > 16384 || height > 16384 || (uint64_t)width * height > 64000000) {
        failure("JXR dimensions exceed the supported limit");
        goto cleanup;
    }
    int channels = 4, half = 1, alpha = 0;
    if (IsEqualGUID(&guid, &GUID_PKPixelFormat64bppRGBAHalf)) alpha = 1;
    else if (IsEqualGUID(&guid, &GUID_PKPixelFormat64bppRGBHalf)) channels = 4;
    else if (IsEqualGUID(&guid, &GUID_PKPixelFormat48bppRGBHalf)) channels = 3;
    else if (IsEqualGUID(&guid, &GUID_PKPixelFormat128bppRGBAFloat)) { half = 0; alpha = 1; }
    else if (IsEqualGUID(&guid, &GUID_PKPixelFormat128bppRGBFloat)) half = 0;
    else if (IsEqualGUID(&guid, &GUID_PKPixelFormat96bppRGBFloat)) { half = 0; channels = 3; }
    else { failure("Only linear scRGB floating-point HDR JXR captures are supported"); goto cleanup; }
    U32 profile_size = 0;
    if (!Failed(decoder->GetColorContext(decoder, NULL, &profile_size)) && profile_size) {
        failure("ICC-tagged JXR cannot be safely assumed to be linear scRGB");
        goto cleanup;
    }
    if (info_only) {
        printf("{\"width\":%d,\"height\":%d}\n", width, height);
        result = 0;
        goto cleanup;
    }
    size_t count = (size_t)width * height;
    size_t stride = (size_t)width * channels * (half ? 2 : 4);
    pixels = malloc(stride * height);
    row = malloc((size_t)width * sizeof(float));
    if (!pixels || !row) goto cleanup;
    decoder->WMP.wmiSCP.uAlphaMode = alpha ? 2 : 0;
    PKRect rectangle = {0, 0, width, height};
    if (Failed(decoder->Copy(decoder, &rectangle, pixels, (U32)stride))) goto cleanup;
    for (size_t i = 0; i < count; i++) {
        for (int c = 0; c < (alpha ? 4 : 3); c++) {
            size_t offset = i * channels + c;
            float value = half ? (float)((__fp16 *)pixels)[offset] : ((float *)pixels)[offset];
            if (!isfinite(value) || (alpha && c == 3 && value != 1.0f)) {
                failure("Non-finite or transparent JXR captures are not supported");
                goto cleanup;
            }
        }
    }
    int fd = open(argv[2], O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    if (fd < 0) { failure("Cannot create JXR scratch output"); goto cleanup; }
    created = 1;
    output = fdopen(fd, "wb");
    if (!output) { close(fd); goto cleanup; }
    const int order[3] = {1, 2, 0};
    for (int plane = 0; plane < 3; plane++) {
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                size_t i = ((size_t)y * width + x) * channels + order[plane];
                row[x] = half ? (float)((__fp16 *)pixels)[i] : ((float *)pixels)[i];
            }
            if (fwrite(row, sizeof(float), (size_t)width, output) != (size_t)width) goto cleanup;
        }
    }
    if (fclose(output) != 0) { output = NULL; goto cleanup; }
    output = NULL;
    printf("{\"width\":%d,\"height\":%d,\"pixelFormat\":\"gbrpf32le\",\"referenceWhiteNits\":80}\n", width, height);
    result = 0;
cleanup:
    if (output) fclose(output);
    if (result && created) unlink(argv[2]);
    if (decoder) decoder->Release(&decoder);
    if (factory) factory->Release(&factory);
    free(row);
    free(pixels);
    if (result) failure("JXR decoding failed; original was not changed");
    return result;
}
