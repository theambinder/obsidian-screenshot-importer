#include <CoreFoundation/CoreFoundation.h>
#include <ImageIO/ImageIO.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

int main(int argc, char **argv) {
    if (argc != 2) return 1;
    struct stat status;
    if (lstat(argv[1], &status) || !S_ISREG(status.st_mode)) return 1;
    CFURLRef url = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)argv[1], strlen(argv[1]), false);
    if (!url) return 1;
    const void *keys[] = {kCGImageSourceShouldCache};
    const void *values[] = {kCFBooleanFalse};
    CFDictionaryRef options = CFDictionaryCreate(NULL, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CGImageSourceRef source = CGImageSourceCreateWithURL(url, options);
    CFDictionaryRef properties = source ? CGImageSourceCopyPropertiesAtIndex(source, 0, options) : NULL;
    int width = 0, height = 0, orientation = 1;
    if (properties) {
        CFNumberRef w = CFDictionaryGetValue(properties, kCGImagePropertyPixelWidth);
        CFNumberRef h = CFDictionaryGetValue(properties, kCGImagePropertyPixelHeight);
        if (w && CFGetTypeID(w) == CFNumberGetTypeID()) CFNumberGetValue(w, kCFNumberIntType, &width);
        if (h && CFGetTypeID(h) == CFNumberGetTypeID()) CFNumberGetValue(h, kCFNumberIntType, &height);
        CFNumberRef o = CFDictionaryGetValue(properties, kCGImagePropertyOrientation);
        if (o && CFGetTypeID(o) == CFNumberGetTypeID()) CFNumberGetValue(o, kCFNumberIntType, &orientation);
    }
    if (properties) CFRelease(properties);
    if (source) CFRelease(source);
    CFRelease(options);
    CFRelease(url);
    if (width <= 0 || height <= 0) { fprintf(stderr, "Cannot read image dimensions\n"); return 1; }
    if (orientation >= 5 && orientation <= 8) { int temporary = width; width = height; height = temporary; }
    printf("{\"width\":%d,\"height\":%d", width, height);
    if (orientation > 1 && orientation <= 8) printf(",\"orientation\":%d", orientation);
    puts("}");
    return 0;
}
