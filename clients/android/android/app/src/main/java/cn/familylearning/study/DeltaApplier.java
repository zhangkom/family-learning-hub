package cn.familylearning.study;

import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.zip.GZIPInputStream;
import java.util.zip.Inflater;

/** Bounded COPY/DATA reconstruction. Never extracts paths or executes downloaded code. */
final class DeltaApplier {
    static final long MAX_BYTES = 256L * 1024 * 1024;
    private static final byte[] MAGIC = "ZAI-DLT1".getBytes(StandardCharsets.US_ASCII);
    private DeltaApplier() {}

    static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[65536]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("interrupted");
                digest.update(buffer, 0, count);
            }
        }
        return hex(digest.digest());
    }

    static void apply(File base, File patch, File output, long baseBytes, String baseHash,
                      long targetBytes, String targetHash) throws Exception {
        if (baseBytes < 1 || baseBytes > MAX_BYTES || targetBytes < 1 || targetBytes > MAX_BYTES ||
            !baseHash.matches("[a-fA-F0-9]{64}") || !targetHash.matches("[a-fA-F0-9]{64}") ||
            !base.isFile() || base.length() != baseBytes || patch.length() > MAX_BYTES ||
            output.getCanonicalFile().equals(base.getCanonicalFile()) ||
            output.getCanonicalFile().equals(patch.getCanonicalFile())) throw new IOException("invalid delta files");
        if (!sha256(base).equalsIgnoreCase(baseHash)) throw new IOException("base mismatch");
        checkSingleGzip(patch, targetBytes + 92 + 13L * 100000);
        boolean complete = false;
        long deadline = System.nanoTime() + 60_000_000_000L;
        try (DataInputStream input = new DataInputStream(new GZIPInputStream(new BufferedInputStream(new FileInputStream(patch))));
             RandomAccessFile source = new RandomAccessFile(base, "r");
             FileOutputStream target = new FileOutputStream(output)) {
            byte[] magic = new byte[8], hash = new byte[32];
            input.readFully(magic);
            if (!Arrays.equals(magic, MAGIC) || input.readLong() != baseBytes || input.readLong() != targetBytes)
                throw new IOException("invalid delta header");
            input.readFully(hash);
            if (!hex(hash).equalsIgnoreCase(baseHash)) throw new IOException("base hash header mismatch");
            input.readFully(hash);
            if (!hex(hash).equalsIgnoreCase(targetHash)) throw new IOException("target hash header mismatch");
            int operations = input.readInt();
            if (operations < 1 || operations > 100000) throw new IOException("invalid operation count");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[65536];
            long total = 0;
            for (int operation = 0; operation < operations; operation++) {
                int opcode = input.readUnsignedByte();
                if (opcode != 0 && opcode != 1) throw new IOException("unknown delta operation");
                long offset = opcode == 0 ? input.readLong() : 0;
                long length = Integer.toUnsignedLong(input.readInt());
                if (length == 0 || length > targetBytes - total ||
                    (opcode == 0 && (offset < 0 || offset > baseBytes || length > baseBytes - offset)))
                    throw new IOException("delta out of bounds");
                if (opcode == 0) source.seek(offset);
                long remaining = length;
                while (remaining > 0) {
                    if (Thread.currentThread().isInterrupted() || System.nanoTime() > deadline)
                        throw new IOException("delta time limit");
                    int count = (int) Math.min(buffer.length, remaining);
                    if (opcode == 0) source.readFully(buffer, 0, count); else input.readFully(buffer, 0, count);
                    target.write(buffer, 0, count); digest.update(buffer, 0, count);
                    remaining -= count; total += count;
                }
            }
            if (total != targetBytes || input.read() != -1 || !hex(digest.digest()).equalsIgnoreCase(targetHash))
                throw new IOException("invalid delta output");
            target.getFD().sync();
            complete = true;
        } finally {
            if (!complete && output.exists()) output.delete();
        }
    }

    // GZIPInputStream accepts concatenated members and some trailing bytes. Our format does not.
    private static void checkSingleGzip(File patch, long limit) throws Exception {
        Inflater inflater = new Inflater(true);
        long deadline = System.nanoTime() + 60_000_000_000L;
        try (DataInputStream input = new DataInputStream(new FileInputStream(patch))) {
            byte[] header = new byte[10]; input.readFully(header);
            if ((header[0] & 255) != 31 || (header[1] & 255) != 139 || header[2] != 8 || header[3] != 0)
                throw new IOException("unsupported gzip header");
            byte[] compressed = new byte[65536], expanded = new byte[65536];
            long total = 0;
            while (!inflater.finished()) {
                if (Thread.currentThread().isInterrupted() || System.nanoTime() > deadline) throw new IOException("gzip time limit");
                if (inflater.needsInput()) {
                    int count = input.read(compressed);
                    if (count == -1) throw new IOException("truncated gzip");
                    inflater.setInput(compressed, 0, count);
                }
                int count = inflater.inflate(expanded);
                total += count;
                if (total > limit || inflater.needsDictionary()) throw new IOException("gzip bounds");
                if (count == 0 && !inflater.finished() && !inflater.needsInput()) throw new IOException("invalid gzip stream");
            }
            if (patch.length() != 10 + inflater.getBytesRead() + 8) throw new IOException("trailing gzip data");
        } finally { inflater.end(); }
    }

    private static String hex(byte[] data) {
        StringBuilder result = new StringBuilder(data.length * 2);
        for (byte value : data) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }
}
