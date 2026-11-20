"""Run with Python 3 and Node.js on PATH: python interop/test_interop.py."""
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
SPEC = HERE.parent / "OATP_0.1_Especificacao_Completa.md"


def reference():
    document = SPEC.read_text(encoding="utf-8")
    source = re.search(r"^```python\n(.*?)^```", document, re.M | re.S).group(1)
    digest = hashlib.sha256(source.encode()).hexdigest()
    assert digest in document[:document.index(source)], "reference digest mismatch"
    namespace = {}
    exec(compile(source, str(SPEC), "exec"), namespace)
    return namespace


def channels(stream):
    frames = [stream[i:i + 100] for i in range(0, len(stream), 100)]
    yield "complete", frames
    # Drop every third systematic ESI in generation 0 and ESI 0 in
    # generation 1. Deliver surviving symbols in reverse after one manifest.
    kept = []
    for f in frames:
        if f[6] != 2:
            continue
        g = int.from_bytes(f[24:28], "big")
        esi = int.from_bytes(f[28:32], "big")
        if g == 0 and esi < 64 and esi % 3 == 0:
            continue
        if g == 1 and esi == 0:
            continue
        kept.append(f)
    yield "loss+reverse", [frames[0], *reversed(kept)]


def check(size, ref, directory):
    data = hashlib.shake_256(f"OATP interop {size}".encode()).digest(size)
    original = directory / "original.bin"
    wire = directory / "packets.bin"
    recovered = directory / "recovered.bin"
    original.write_bytes(data)

    def node(mode, src, dst):
        subprocess.run(["node", str(HERE / "oatp.mjs"), mode, src, dst], check=True)

    manifest = ref["make_manifest"](data)
    python_stream = b"".join(ref["initial_batch"](data, manifest))
    node("encode", original, wire)
    node_stream = wire.read_bytes()
    assert len(node_stream) == (112 if size == 4097 else 109) * 100
    assert python_stream == node_stream, f"wire mismatch for {size}"

    for scenario, frames in channels(python_stream):
        wire.write_bytes(b"".join(frames))
        node("decode", wire, recovered)
        assert recovered.read_bytes() == data, (size, scenario, "Python -> Node")
        print(size, scenario, "Python -> Node OK", len(frames), "frames")
    for scenario, frames in channels(node_stream):
        receiver = ref["ObjectReceiver"](frames[0])
        for frame in frames[1:]:
            receiver.ingest(frame)
        assert receiver.finish() == data, (size, scenario, "Node -> Python")
        print(size, scenario, "Node -> Python OK", len(frames), "frames")


def continuous_streams(ref, directory, size, rounds, mode):
    data = hashlib.shake_256(f"OATP continuous {size}".encode()).digest(size)
    original = directory / "original.bin"
    wire = directory / "continuous.bin"
    original.write_bytes(data)
    manifest = ref["make_manifest"](data)
    generation_count = manifest.generation_count
    generations = range(generation_count)
    symbol_count = generation_count * rounds
    manifest_count = 1 + symbol_count // 8
    if mode in ("continuous-alternating", "continuous-rotating"):
        announcement = ref["manifest_frame"](manifest)
        py_frames = [announcement]
        next_esies = [manifest.k(g) + (manifest.k(g) + 1) // 2 for g in generations]
        sent = 0
        for turn in range(rounds):
            if mode == "continuous-rotating":
                start = turn % generation_count
                order = (*generations[start:], *generations[:start])
            else:
                order = reversed(generations) if turn % 2 else generations
            for g in order:
                py_frames.append(ref["symbol_frame"](data, manifest, g, next_esies[g] + turn))
                sent += 1
                if sent % 8 == 0:
                    py_frames.append(announcement)
    else:
        sender = ref["RepairSender"](data, manifest)
        py_frames = [sender.next_packet() for _ in range(symbol_count + manifest_count)]
    cli = ["node", str(HERE / "oatp.mjs")]
    subprocess.run([*cli, mode, original, wire, str(rounds)], check=True)
    js_wire = wire.read_bytes()
    assert b"".join(py_frames) == js_wire
    js_frames = [js_wire[i:i + 100] for i in range(0, len(js_wire), 100)]

    return data, [("Python -> Node", py_frames), ("Node -> Python", js_frames)]


def receive(ref, directory, direction, kept, data, generations):
    if direction == "Python -> Node":
        cli = ["node", str(HERE / "oatp.mjs")]
        wire = directory / "filtered.bin"
        result = directory / "result.bin"
        wire.write_bytes(b"".join(kept))
        subprocess.run([*cli, "progress", wire, result], check=True)
        status = json.loads(result.read_text())
        ranks, delivered = status["ranks"], status["delivered"]
        if delivered:
            subprocess.run([*cli, "decode", wire, result], check=True)
            assert result.read_bytes() == data
    else:
        receiver = ref["ObjectReceiver"](kept[0])
        for frame in kept[1:]:
            receiver.ingest(frame)
        ranks = [receiver.bases[g].rank if g in receiver.bases else 0 for g in generations]
        if receiver.ready:
            assert receiver.finish() == data
        else:
            assert not receiver.ready and not receiver.failed
            try:
                receiver.finish()
            except ValueError as exc:
                assert str(exc) == "E_INCOMPLETE"
            else:
                raise AssertionError("incomplete transfer was delivered")
        delivered = receiver.delivered
    return ranks, delivered


def check_continuous(ref, directory, alternate=False, generation_count=2, rounds=None):
    if rounds is None:
        rounds = 128 if alternate else 96
    size = generation_count * 4096
    mode = "continuous-alternating" if alternate else "continuous"
    data, streams = continuous_streams(ref, directory, size, rounds, mode)
    generations = tuple(range(generation_count))
    symbol_count = generation_count * rounds
    manifest_count = 1 + symbol_count // 8
    node_ranks = {}
    for direction, frames in streams:
        # A fresh receiver starts at the opening manifest of the continuous phase.
        for parity in (0, 1, None):
            cycle = generations + generations[::-1] if alternate else generations
            received = [0] * generation_count
            kept = []
            symbols_seen = 0
            manifests = 0
            for index, frame in enumerate(frames):
                kind, _, g, esi, _ = ref["parse_frame"](frame)
                if index % 9 == 0:
                    assert kind == 1
                    kept.append(frame)
                    manifests += 1
                else:
                    assert kind == 2 and g == cycle[symbols_seen % len(cycle)]
                    assert esi == 96 + symbols_seen // generation_count
                    if parity is None or symbols_seen % 2 == parity:
                        kept.append(frame)
                        received[g] += 1
                    symbols_seen += 1
            assert manifests == manifest_count and symbols_seen == symbol_count
            assert len(kept) - manifests == (symbol_count if parity is None else symbol_count // 2)
            if alternate and parity is not None:
                assert received == [rounds // 2] * generation_count
            ranks, delivered = receive(ref, directory, direction, kept, data, generations)
            if direction == "Python -> Node":
                node_ranks[parity] = ranks
            assert ranks == node_ranks[parity]
            assert delivered == all(rank == 64 for rank in ranks)
            expected_ranks = [min(count, 64) for count in received]
            # Observed rank deficits for these deterministic fixtures at round 128.
            if alternate and rounds == 128:
                deficits = {
                    (13, 0): (9,), (13, 1): (11,), (14, 1): (4, 7),
                    (18, 1): (0,), (21, 1): (9,), (23, 0): (8,),
                }
                for g in deficits.get((generation_count, parity), ()):
                    expected_ranks[g] = 63
            assert ranks == expected_ranks, (size, direction, parity, ranks)
            print(size, mode, direction, "kept parity", parity, "ranks", ranks, "delivered", delivered)


def check_one_in_three(ref, directory, rotating=False):
    mode = "continuous-rotating" if rotating else "continuous-alternating"
    cycle = (0, 1, 2, 1, 2, 0, 2, 0, 1) if rotating else (0, 1, 2, 2, 1, 0)
    data, streams = continuous_streams(ref, directory, 12288, 192, mode)
    for direction, frames in streams:
        for phase in range(3):
            kept = []
            counts = [0, 0, 0]
            symbols = manifests = 0
            for frame in frames:
                kind, _, g, _, _ = ref["parse_frame"](frame)
                if kind == 1:
                    manifests += 1
                    kept.append(frame)
                    continue
                assert g == cycle[symbols % len(cycle)]
                if symbols % 3 == phase:
                    kept.append(frame)
                    counts[g] += 1
                symbols += 1
            assert (symbols, manifests) == (576, 73)
            expected_counts = [0, 192, 0] if phase == 1 else [96, 0, 96]
            assert counts == ([64, 64, 64] if rotating else expected_counts)
            ranks, delivered = receive(ref, directory, direction, kept, data, range(3))
            print(mode, direction, "first kept", phase + 1, "counts", counts, "ranks", ranks, "delivered", delivered)
            assert ranks == [min(n, 64) for n in counts] and delivered == rotating
        assert receive(ref, directory, direction, frames, data, range(3)) == ([64, 64, 64], True)


def check_late_join(ref, directory):
    data, streams = continuous_streams(ref, directory, 4097, 80, "continuous-alternating")
    for direction, frames in streams:
        symbols = 0
        announces = []
        kept = []
        ignored = 0
        for frame in frames:
            kind, _, g, esi, _ = ref["parse_frame"](frame)
            if kind == 2:
                symbols += 1
                if symbols == 6:  # Second symbol of the third round.
                    assert (g, esi) == (1, 4)
            if symbols < 6:
                continue
            if kind == 1:
                announces.append(symbols)
            if len(announces) < 2:  # Lose first announcement; no orphan buffer.
                ignored += kind == 2
                continue
            kept.append(frame)
        assert announces[:2] == [8, 16] and ignored == 11
        assert kept[0][6] == 1 and symbols == 160
        assert ref["parse_frame"](kept[2])[2:4] == (1, 10)
        assert receive(ref, directory, direction, kept[:3], data, range(2)) == ([1, 1], False)
        assert receive(ref, directory, direction, kept, data, range(2)) == ([64, 1], True)
        print(direction, "late join at symbol 6, lost manifest at 8, accepted at 16;",
              "short generation solved by ESI 10; recovered", len(data), "bytes")


if __name__ == "__main__":
    if not __debug__:
        raise RuntimeError("Run without -O to enable the test assertions")
    ref = reference()
    with tempfile.TemporaryDirectory() as directory:
        check_one_in_three(ref, Path(directory))
        check_one_in_three(ref, Path(directory), rotating=True)
        check_late_join(ref, Path(directory))
        for size in (4095, 4096, 4097):
            check(size, ref, Path(directory))
        check_continuous(ref, Path(directory))
        for generation_count in range(2, 27):
            check_continuous(ref, Path(directory), alternate=True, generation_count=generation_count)
        for generation_count in (13, 14, 18, 21, 23):
            check_continuous(ref, Path(directory), alternate=True, generation_count=generation_count, rounds=130)
