package cn.familylearning.study;

import java.util.BitSet;

/** Selection indexes belong to one frozen, displayed album order. No image bytes. */
final class AlbumRangeSelection {
    private final BitSet selected = new BitSet();
    private int anchor = -1;
    boolean rangeMode = true;

    void tap(int index, int size) {
        check(index, size);
        if (!rangeMode) { selected.flip(index); anchor = -1; return; }
        if (anchor < 0) { anchor = index; selected.set(index); }
        else { selected.set(Math.min(anchor, index), Math.max(anchor, index) + 1); anchor = -1; }
    }
    void setRangeMode(boolean value) { rangeMode = value; anchor = -1; }
    void clear() { selected.clear(); anchor = -1; }
    void all(int size) { if (size < 0) throw new IllegalArgumentException(); clear(); selected.set(0, size); }
    boolean contains(int index) { return index >= 0 && selected.get(index); }
    int count() { return selected.cardinality(); }
    int anchor() { return anchor; }
    int[] indexes() { return selected.stream().toArray(); }
    long[] savedBits() { return selected.toLongArray(); }
    void restore(long[] bits, int start, boolean mode, int size) {
        BitSet saved = BitSet.valueOf(bits == null ? new long[0] : bits);
        if (saved.length() > size || start < -1 || start >= size || (start >= 0 && !saved.get(start)))
            throw new IllegalArgumentException("相册选择已变化，请重新选择");
        selected.clear(); selected.or(saved); rangeMode = mode; anchor = mode ? start : -1;
    }
    private static void check(int index, int size) {
        if (index < 0 || index >= size) throw new IllegalArgumentException("照片不在当前相册中");
    }
}
