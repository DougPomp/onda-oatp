"""Check production browser frames against the Python and independent Node codecs."""
import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "interop"))
from test_interop import reference

ref = reference()
with tempfile.TemporaryDirectory() as tmp:
    directory = Path(tmp)
    for length in (0, 65, 4097):
        data = hashlib.shake_256(str(length).encode()).digest(length)
        original, wire = directory / "original", directory / "wire"
        original.write_bytes(data)
        script = """
        import fs from 'node:fs';
        import {sender, Receiver} from './web/protocol.mjs';
        const [original, output] = process.argv.slice(1);
        const data = fs.readFileSync(original);
        const tx = await sender(data);
        const rx = new Receiver();
        for (const f of tx.initial) await rx.accept(f);
        if (!data.equals(rx.object)) throw Error('reconstruction');
        fs.writeFileSync(output, Buffer.concat(tx.initial));
        """
        subprocess.run(["node","--input-type=module","-e",script,str(original),str(wire)], cwd=ROOT, check=True)
        browser = wire.read_bytes()
        expected = b"".join(ref["initial_batch"](data, ref["make_manifest"](data)))
        assert browser == expected
        subprocess.run(["node", str(ROOT / "interop/oatp.mjs"), "encode", original, wire], check=True)
        assert wire.read_bytes() == browser
        receiver = ref["ObjectReceiver"](browser[:100])
        for start in range(100, len(browser), 100):
            receiver.ingest(browser[start:start+100])
        assert receiver.finish() == data
print("Browser, Python and Node agree on 0, 65 and 4097 bytes.")
