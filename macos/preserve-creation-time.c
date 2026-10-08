#include <sys/attr.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>

// Copy only birthtime; the replacement must keep its new modification time.
int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "Usage: preserve-creation-time source replacement\n");
        return 1;
    }
    int source = open(argv[1], O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    if (source == -1) {
        perror("Open metadata source");
        return 1;
    }
    int replacement = open(argv[2], O_WRONLY | O_NOFOLLOW | O_NONBLOCK);
    if (replacement == -1) {
        perror("Open metadata replacement");
        close(source);
        return 1;
    }

    int result = 1;
    struct stat before, after;
    if (fstat(source, &before) == -1 || fstat(replacement, &after) == -1) {
        perror("Read file metadata");
        goto done;
    }
    if (!S_ISREG(before.st_mode) || !S_ISREG(after.st_mode) ||
        (before.st_dev == after.st_dev && before.st_ino == after.st_ino)) {
        fprintf(stderr, "Expected two distinct regular files\n");
        goto done;
    }

    struct attrlist attributes = {
        .bitmapcount = ATTR_BIT_MAP_COUNT,
        .commonattr = ATTR_CMN_CRTIME,
    };
    if (fsetattrlist(replacement, &attributes, &before.st_birthtimespec,
                    sizeof(before.st_birthtimespec), 0) == -1) {
        perror("Preserve creation time");
        goto done;
    }
    result = 0;

done:
    close(replacement);
    close(source);
    return result;
}
