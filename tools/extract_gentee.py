#!/usr/bin/env python3
"""Read an embedded Gentee PAK without executing installer code.

Decoder and archive layout adapted from ScummVM's
common/compression/gentee_installer.cpp (ScummVM developers).
https://github.com/scummvm/scummvm/blob/master/common/compression/gentee_installer.cpp
SPDX-License-Identifier: GPL-3.0-or-later

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. This program is distributed WITHOUT ANY WARRANTY; without even the
implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
See https://www.gnu.org/licenses/gpl-3.0.html for the full license.

Limited to the embedded PAK variant used by bbdemo.exe. Installer commands are
parsed as data, never interpreted. Output paths and sizes are checked. Existing
files are never overwritten. No third-party Python packages are required.
"""

import argparse
import hashlib
import io
import json
from pathlib import Path, PureWindowsPath
import struct

LIMIT = 32 * 1024 * 1024
VLC_BITS = (0, 1, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 6,
            6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13)


def read_exact(stream, size):
    if not 0 <= size <= LIMIT:
        raise ValueError(f"Invalid or excessive size: {size}")
    data = stream.read(size)
    if len(data) != size:
        raise ValueError("Truncated archive")
    return data


def u32(stream):
    return struct.unpack('<I', read_exact(stream, 4))[0]


class Node:
    def __init__(self, symbol, frequency):
        self.symbol = symbol
        self.frequency = frequency
        self.parent = None
        self.children = [None, None]


class Tree:
    def __init__(self, count):
        self.nodes = [Node(i, i + 1) for i in range(count)]
        for index in range(count, count * 2 - 1):
            # Stable ties are significant to this format.
            a, b = sorted((n for n in self.nodes if n.parent is None),
                          key=lambda n: n.frequency)[:2]
            parent = Node(index, a.frequency + b.frequency)
            parent.children = [a, b]
            a.parent = b.parent = parent
            self.nodes.append(parent)
        self.root = self.nodes[-1]

    @staticmethod
    def rebalance(entry, uncle):
        for turn in range(2):
            parent = entry.parent
            side = 0 if parent.children[0] is entry else 1
            sibling = parent.children[1 - side]
            highest = uncle.children[0]
            if highest is not None and highest.frequency <= uncle.children[1].frequency:
                highest = uncle.children[1]
            parent.children[side] = uncle
            grandparent = parent.parent
            grandparent.children[0 if grandparent.children[0] is uncle else 1] = entry
            entry.parent = grandparent
            uncle.parent = parent
            if turn or highest is None or highest.frequency <= sibling.frequency:
                break
            uncle.frequency += sibling.frequency - highest.frequency
            entry, uncle = highest, sibling

    def increment(self, symbol):
        node = self.nodes[symbol]
        while node is not None:
            parent = node.parent
            if parent is not None and parent.parent is not None:
                gp = parent.parent
                uncle = gp.children[1 if gp.children[0] is parent else 0]
                if uncle.frequency <= node.frequency:
                    self.rebalance(node, uncle)
            node.frequency += 1
            node = node.parent
        if self.root.frequency >= 512:
            # Preserve the original decoder's signed, all-node normalization.
            for node in self.nodes:
                node.frequency >>= 1


class Decoder:
    def __init__(self, stream):
        self.stream = stream
        self.trees = [Tree(n) for n in (274, 34, 237)]
        self.history = [0, 1, 2, 3]
        self.window = bytearray(32767)
        self.window_pos = self.match_pos = self.match_left = 0
        self.reset_bits()
        self.offsets = []
        offset = 0
        for bits in VLC_BITS:
            self.offsets.append(offset)
            offset += 1 << bits

    def reset_bits(self):
        self.byte = self.bits_left = 0

    def bit(self):
        if not self.bits_left:
            self.byte = read_exact(self.stream, 1)[0]
            self.bits_left = 8
        bit = (self.byte >> 7) & 1
        self.byte = (self.byte << 1) & 255
        self.bits_left -= 1
        return bit

    def symbol(self, tree):
        node = tree.root
        while node.children[0] is not None:
            node = node.children[self.bit()]
        tree.increment(node.symbol)
        return node.symbol

    def read(self, size):
        if not 0 <= size <= LIMIT:
            raise ValueError(f"Excessive decompressed size: {size}")
        output = bytearray()
        while len(output) < size:
            if self.match_left:
                value = self.window[self.match_pos]
                self.match_pos = (self.match_pos + 1) % len(self.window)
                self.match_left -= 1
            else:
                code = self.symbol(self.trees[0])
                if code < 256:
                    value = code
                else:
                    length = self.symbol(self.trees[2]) + 20 if code > 272 else code - 253
                    code = self.symbol(self.trees[1])
                    if code < 30:
                        offset = self.offsets[code] + sum(self.bit() << i for i in range(VLC_BITS[code]))
                    else:
                        offset = self.history[code - 30]
                    self.match_pos = (self.window_pos - length - offset) % len(self.window)
                    self.match_left = length
                    index = self.history.index(offset) if offset in self.history[:3] else 3
                    self.history = [offset] + self.history[:index] + self.history[index + 1:]
                    continue
            output.append(value)
            self.window[self.window_pos] = value
            self.window_pos = (self.window_pos + 1) % len(self.window)
        return bytes(output)


def read_chunk(stream, decoder):
    size = u32(stream)
    if size > 4 * 1024 * 1024:
        raise ValueError("Oversized command record")
    decoder.reset_bits()
    return decoder.read(size)


def unpack(data):
    if len(data) < 1024 or data[:2] != b'MZ' or b'Gentee installer' not in data[:7680]:
        raise ValueError("Not the supported Gentee installer variant")
    location, compressed, uncompressed = struct.unpack_from('<III', data, 0x3f0)
    start = location + compressed
    if not 1024 <= location < start <= len(data) - 24:
        raise ValueError("Invalid installer payload bounds")
    end = struct.unpack_from('<I', data, start)[0]
    if not start + 24 <= end <= len(data):
        raise ValueError("Invalid embedded PAK bounds")
    stream = io.BytesIO(data[start:end])
    stream.seek(20)
    decoder = Decoder(stream)
    header = read_chunk(stream, decoder)
    if len(header) < 3:
        raise ValueError("Invalid first record")
    # This sample uses solid compression: preserve file decoder state between
    # members, resetting only bit alignment. Command records have separate state.
    # Its first record starts with 1 although the file payloads are compressed;
    # do not apply ScummVM's all-files-stored interpretation to this variant.
    file_decoder = Decoder(stream)
    files, records, total = [], [], 0
    while stream.tell() < end - start:
        position = start + stream.tell()
        chunk = read_chunk(stream, decoder)
        if len(chunk) < 3:
            raise ValueError("Invalid command record")
        code = struct.unpack_from('<H', chunk)[0]
        records.append({'offset': position, 'code': hex(code), 'length': len(chunk)})
        if code != 0x87f4:
            continue
        if len(chunk) < 36 or chunk[-1] != 0:
            raise ValueError("Malformed file record")
        name = chunk[34:].split(b'\0')[0].decode('cp1252')
        compressed_file = bool(chunk[28])
        payload_start = start + stream.tell()
        if compressed_file:
            size = u32(stream)
            if size != struct.unpack_from('<I', chunk, 7)[0]:
                raise ValueError('File size disagrees with command record')
            file_decoder.reset_bits()
            payload = file_decoder.read(size)
        else:
            size = struct.unpack_from('<I', chunk, 7)[0]
            payload = read_exact(stream, size)
        total += size
        if total > LIMIT:
            raise ValueError("Archive exceeds total output size limit")
        files.append((name, payload, {'archive_path': name, 'size': size,
                      'sha256': hashlib.sha256(payload).hexdigest(),
                      'compressed': compressed_file, 'offset': payload_start,
                      'stored_bytes': start + stream.tell() - payload_start}))
    return files, {'installer_sha256': hashlib.sha256(data).hexdigest(),
                   'installer_size': len(data), 'pak_start': start, 'pak_end': end,
                   'dll_uncompressed_size': uncompressed, 'records': records}


def safe_relative(name, prefix=''):
    if prefix:
        if not name.startswith(prefix):
            raise ValueError(f"Unexpected path prefix: {name!r}")
        name = name[len(prefix):]
    path = PureWindowsPath(name)
    if path.drive or path.root or not path.parts or '..' in path.parts:
        raise ValueError(f"Unsafe path: {name!r}")
    if any(ord(c) < 32 or c == ':' for c in name):
        raise ValueError(f"Unsupported path: {name!r}")
    return Path(*path.parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('installer', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--strip-prefix', default='')
    args = parser.parse_args()
    files, metadata = unpack(args.installer.read_bytes())
    for name, payload, item in files:
        print(f"{len(payload):9,d}  {name!r}  {item['sha256']}")
    print(f"Decoded {len(files)} files from {len(metadata['records'])} records.")
    if args.output is not None:
        root = args.output.resolve()
        planned, seen = [], set()
        for name, payload, item in files:
            relative = safe_relative(name, args.strip_prefix)
            dest = root / relative
            if not dest.resolve().is_relative_to(root):
                raise ValueError(f"Path escapes destination: {name!r}")
            if dest.exists() or str(relative).casefold() in seen:
                raise ValueError(f"Existing or duplicate output path: {dest}")
            seen.add(str(relative).casefold())
            item['output_path'] = relative.as_posix()
            planned.append((dest, payload))
        manifest = root / 'extraction-manifest.json'
        if manifest.exists() or manifest.name.casefold() in seen:
            raise ValueError('Manifest path collision')
        for dest, payload in planned:
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open('xb') as output:
                output.write(payload)
        metadata['files'] = [item for _, _, item in files]
        root.mkdir(parents=True, exist_ok=True)
        with manifest.open('x') as output:
            json.dump(metadata, output, indent=2)
            output.write('\n')
        print(f"Extracted to {root}")


if __name__ == '__main__':
    main()
