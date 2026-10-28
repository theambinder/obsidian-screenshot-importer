#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <ImageIO/ImageIO.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    if (argc != 4 && argc != 5) return 1;
    int cropSize = argc == 5 ? atoi(argv[4]) : 512;
    if (cropSize < 1 || cropSize > 512) return 1;
    int limit = !strcmp(argv[3], "thumbnail") ? 256 : !strcmp(argv[3], "overview") ? 1600 : 0;
    int crop = !strcmp(argv[3], "crop");
    if (!limit && !crop) return 1;
    CFURLRef input = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)argv[1], strlen(argv[1]), false);
    CFURLRef output = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)argv[2], strlen(argv[2]), false);
    const void *cacheKeys[] = { kCGImageSourceShouldCache };
    const void *cacheValues[] = { kCFBooleanFalse };
    CFDictionaryRef noCache = CFDictionaryCreate(NULL, cacheKeys, cacheValues, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CGImageSourceRef source = input ? CGImageSourceCreateWithURL(input, noCache) : NULL;
    CFDictionaryRef properties = source ? CGImageSourceCopyPropertiesAtIndex(source, 0, noCache) : NULL;
    int width = 0, height = 0;
    if (properties) {
        CFNumberRef w = CFDictionaryGetValue(properties, kCGImagePropertyPixelWidth);
        CFNumberRef h = CFDictionaryGetValue(properties, kCGImagePropertyPixelHeight);
        if (w && CFGetTypeID(w) == CFNumberGetTypeID()) CFNumberGetValue(w, kCFNumberIntType, &width);
        if (h && CFGetTypeID(h) == CFNumberGetTypeID()) CFNumberGetValue(h, kCFNumberIntType, &height);
    }
    int longest = width > height ? width : height;
    if (crop || limit > longest) limit = longest;
    CFNumberRef maximum = CFNumberCreate(NULL, kCFNumberIntType, &limit);
    const void *keys[] = { kCGImageSourceCreateThumbnailFromImageAlways, kCGImageSourceCreateThumbnailWithTransform, kCGImageSourceThumbnailMaxPixelSize };
    const void *values[] = { kCFBooleanTrue, kCFBooleanTrue, maximum };
    CFDictionaryRef options = CFDictionaryCreate(NULL, keys, values, 3, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CGImageRef image = source && longest > 0 ? CGImageSourceCreateThumbnailAtIndex(source, 0, options) : NULL;
    // The thumbnail transform applies EXIF orientation before the center crop.
    if (image && crop) {
        size_t w = CGImageGetWidth(image), h = CGImageGetHeight(image);
        size_t side = w < h ? w : h;
        if (side > (size_t)cropSize) side = (size_t)cropSize;
        CGImageRef detail = CGImageCreateWithImageInRect(image, CGRectMake((w - side) / 2, (h - side) / 2, side, side));
        CGImageRelease(image);
        image = detail;
    }
    CGImageDestinationRef destination = image && output ? CGImageDestinationCreateWithURL(output, CFSTR("public.png"), 1, NULL) : NULL;
    int ok = 0;
    if (destination) {
        CGImageDestinationAddImage(destination, image, NULL);
        ok = CGImageDestinationFinalize(destination);
        CFRelease(destination);
    }
    if (image) CGImageRelease(image);
    CFRelease(options);
    CFRelease(maximum);
    if (properties) CFRelease(properties);
    if (source) CFRelease(source);
    CFRelease(noCache);
    if (input) CFRelease(input);
    if (output) CFRelease(output);
    if (!ok) fprintf(stderr, "Cannot render preview image\n");
    return ok ? 0 : 1;
}
