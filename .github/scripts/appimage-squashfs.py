#!/usr/bin/env python3
"""Print the squashfs layout of an AppImage: "<offset> <compressor> <block_size>".

An AppImage is its runtime ELF with a squashfs image appended directly after
the section headers, so the boundary is the end of those headers. Computing it
lets the release scripts unpack and repack the bundle with squashfs-tools alone
— no FUSE on the runner, and no executing the x86_64 runtime, so the same
scripts run on a developer's machine whatever its architecture.

The compressor and block size come back too, because a repack has to hand them
to mksquashfs: the runtime embedded in the file is the only thing that will
ever mount the result, and reusing what it already reads is what guarantees it
still can. Guessing gzip instead of the zstd Tauri uses also cost 10 MB.
"""

import struct
import sys

# squashfs_fs.h: compression ids, in superblock order.
COMPRESSORS = {1: "gzip", 2: "lzma", 3: "lzo", 4: "xz", 5: "lz4", 6: "zstd"}


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: appimage-squashfs.py <file.AppImage>", file=sys.stderr)
        return 2

    path = sys.argv[1]
    try:
        with open(path, "rb") as fh:
            header = fh.read(64)
            if len(header) < 64 or header[:4] != b"\x7fELF":
                print(f"{path}: not an ELF — is this really an AppImage?", file=sys.stderr)
                return 1
            shoff, = struct.unpack_from("<Q", header, 0x28)
            shentsize, = struct.unpack_from("<H", header, 0x3A)
            shnum, = struct.unpack_from("<H", header, 0x3C)
            offset = shoff + shentsize * shnum

            fh.seek(offset)
            superblock = fh.read(28)
            if len(superblock) < 28 or superblock[:4] != b"hsqs":
                print(
                    f"{path}: no squashfs superblock at offset {offset} — the AppImage "
                    "layout changed and these scripts need updating.",
                    file=sys.stderr,
                )
                return 1
            block_size, = struct.unpack_from("<I", superblock, 12)
            compression, = struct.unpack_from("<H", superblock, 20)
    except OSError as exc:
        print(f"{path}: {exc}", file=sys.stderr)
        return 1

    name = COMPRESSORS.get(compression)
    if name is None:
        print(
            f"{path}: unknown squashfs compressor id {compression} — cannot repack "
            "without knowing what the runtime reads.",
            file=sys.stderr,
        )
        return 1

    print(offset, name, block_size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
