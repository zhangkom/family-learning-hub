package cn.familylearning.study;

import java.util.*;

/** Metadata only. A range uses the frozen, displayed order and includes both endpoints. */
final class PhotoSelection {
    static final class Entry {
        final String uri, name;
        Entry(String uri, String name) { this.uri=uri; this.name=name; }
    }
    static String name(String value) {
        if(value==null)return "";
        String clean=value.replaceAll("[\\x00-\\x1f\\x7f]","").replace('/','-').replace('\\','-');
        return clean.length()>1024?clean.substring(0,1024):clean;
    }
    static List<Entry> sorted(List<Entry> input) {
        Map<String,Entry> unique=new LinkedHashMap<>();
        for(Entry entry:input) {
            if(entry.uri==null||!entry.uri.startsWith("content://")||entry.uri.length()>8192)throw new IllegalArgumentException("图片地址无效");
            unique.putIfAbsent(entry.uri,entry);
        }
        List<Entry> entries=new ArrayList<>(unique.values());
        entries.sort(Comparator.comparing((Entry item)->item.name,String.CASE_INSENSITIVE_ORDER).thenComparing(item->item.name).thenComparing(item->item.uri));
        return entries;
    }
    static List<String> range(List<Entry> entries,int first,int last) {
        if(first<0||last<first||last>=entries.size())throw new IllegalArgumentException("结束图片不能在起始图片之前");
        List<String> result=new ArrayList<>();for(int n=first;n<=last;n++)result.add(entries.get(n).uri);return result;
    }
}
