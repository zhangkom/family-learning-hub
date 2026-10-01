package cn.familylearning.study;

import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.GZIPOutputStream;

/** Runs the production Java decoder with no Android/device dependency. */
public final class DeltaApplierTest {
    private static byte[] digest(byte[] bytes) throws Exception { return MessageDigest.getInstance("SHA-256").digest(bytes); }
    private static String hex(byte[] bytes) { return HexFormat.of().formatHex(bytes); }
    private static byte[] patch(byte[] base, byte[] target) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        out.writeBytes("ZAI-DLT1"); out.writeLong(base.length); out.writeLong(target.length);
        out.write(digest(base)); out.write(digest(target)); out.writeInt(3);
        out.writeByte(0); out.writeLong(5); out.writeInt(5);
        out.writeByte(1); out.writeInt(3); out.writeBytes("new");
        out.writeByte(0); out.writeLong(0); out.writeInt(5);
        return bytes.toByteArray();
    }
    private static void gzip(Path file, byte[] bytes) throws Exception {
        try (GZIPOutputStream out = new GZIPOutputStream(Files.newOutputStream(file))) { out.write(bytes); }
    }
    public static void main(String[] args) throws Exception {
        Path directory = Files.createTempDirectory("zai-delta-test-");
        File base = directory.resolve("base.apk").toFile(), compressed = directory.resolve("patch.gz").toFile(), output = directory.resolve("out.apk").toFile();
        byte[] oldBytes = "0123456789".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        byte[] nextBytes = "56789new01234".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        Files.write(base.toPath(), oldBytes);
        byte[] valid = patch(oldBytes, nextBytes);
        String baseHash = hex(digest(oldBytes)), targetHash = hex(digest(nextBytes));
        try {
            gzip(compressed.toPath(), valid);
            DeltaApplier.apply(base, compressed, output, 10, baseHash, 13, targetHash);
            if (!Arrays.equals(Files.readAllBytes(output.toPath()), nextBytes)) throw new AssertionError("roundtrip mismatch");
            Files.delete(output.toPath());
            List<byte[]> malformed = new ArrayList<>();
            byte[] changed = valid.clone(); changed[0] = 0; malformed.add(changed);
            changed = valid.clone(); changed[23] = 14; malformed.add(changed);
            changed = valid.clone(); changed[24] ^= 1; malformed.add(changed);
            changed = valid.clone(); changed[56] ^= 1; malformed.add(changed);
            changed = valid.clone(); changed[88] = 1; malformed.add(changed);
            changed = valid.clone(); changed[91] = 0; malformed.add(changed);
            changed = valid.clone(); changed[92] = 2; malformed.add(changed);
            changed = valid.clone(); changed[93] = (byte) 0x80; malformed.add(changed);
            changed = valid.clone(); changed[100] = 10; malformed.add(changed);
            changed = valid.clone(); changed[104] = 0; malformed.add(changed);
            changed = valid.clone(); changed[101] = (byte) 0xff; malformed.add(changed);
            changed = valid.clone(); changed[110] ^= 1; malformed.add(changed);
            malformed.add(Arrays.copyOf(valid, valid.length - 1));
            malformed.add(Arrays.copyOf(valid, valid.length + 1));
            for (byte[] invalid : malformed) {
                gzip(compressed.toPath(), invalid);
                try { DeltaApplier.apply(base, compressed, output, 10, baseHash, 13, targetHash); throw new AssertionError("accepted malformed patch"); }
                catch (IOException expected) { if (output.exists()) throw new AssertionError("partial output retained"); }
            }
            gzip(compressed.toPath(), valid);
            byte[] corruptGzip = Files.readAllBytes(compressed.toPath()); corruptGzip[corruptGzip.length - 8] ^= 1;
            Files.write(compressed.toPath(), corruptGzip);
            try { DeltaApplier.apply(base, compressed, output, 10, baseHash, 13, targetHash); throw new AssertionError("accepted bad CRC"); }
            catch (IOException expected) { if (output.exists()) throw new AssertionError("CRC output retained"); }
            gzip(compressed.toPath(), valid);
            byte[] single = Files.readAllBytes(compressed.toPath());
            ByteArrayOutputStream emptyBytes = new ByteArrayOutputStream();
            try (GZIPOutputStream empty = new GZIPOutputStream(emptyBytes)) { empty.finish(); }
            byte[] joined = Arrays.copyOf(single, single.length + emptyBytes.size());
            System.arraycopy(emptyBytes.toByteArray(), 0, joined, single.length, emptyBytes.size());
            for (byte[] invalidGzip : List.of(joined, Arrays.copyOf(single, single.length + 1), Arrays.copyOf(single, single.length - 1))) {
                Files.write(compressed.toPath(), invalidGzip);
                try { DeltaApplier.apply(base, compressed, output, 10, baseHash, 13, targetHash); throw new AssertionError("accepted trailing/truncated gzip"); }
                catch (IOException expected) { if (output.exists()) throw new AssertionError("gzip wrote output"); }
            }
            gzip(compressed.toPath(), valid);
            Files.writeString(base.toPath(), "different!");
            try { DeltaApplier.apply(base, compressed, output, 10, baseHash, 13, targetHash); throw new AssertionError("accepted wrong base"); }
            catch (IOException expected) { if (output.exists()) throw new AssertionError("wrong base wrote output"); }
            Files.write(base.toPath(), oldBytes);
            if (!DeltaApplier.sha256(base).equals(baseHash)) throw new AssertionError("base modified");
            System.out.println("Production Java decoder: valid COPY/DATA + 19 corrupt/boundary cases passed.");
            if (args.length == 3) {
                File actualBase = new File(args[0]), actualPatch = new File(args[1]), actualTarget = new File(args[2]);
                DeltaApplier.apply(actualBase, actualPatch, output, actualBase.length(), DeltaApplier.sha256(actualBase), actualTarget.length(), DeltaApplier.sha256(actualTarget));
                if (Files.mismatch(output.toPath(), actualTarget.toPath()) != -1) throw new AssertionError("actual APK mismatch");
                System.out.println("Actual signed APK: byte-for-byte reconstruction passed (" + actualTarget.length() + " bytes).");
            }
        } finally {
            for (File item : Objects.requireNonNull(directory.toFile().listFiles())) Files.delete(item.toPath());
            Files.delete(directory);
        }
    }
}
