package cn.familylearning.study;

import java.nio.file.Files;
import java.util.*;

public final class AlbumRangeSelectionTest {
    private static int checks;
    private static void check(boolean value){if(!value)throw new AssertionError("check "+(checks+1));checks++;}
    public static void main(String[] args)throws Exception{
        AlbumRangeSelection s=new AlbumRangeSelection();
        s.tap(9,1000);check(s.count()==1&&s.anchor()==9);
        s.tap(459,1000);check(s.count()==451&&s.anchor()==-1);check(s.contains(9)&&s.contains(459)&&!s.contains(8)&&!s.contains(460));
        check(s.indexes()[0]==9&&s.indexes()[450]==459);
        s.clear();s.tap(459,1000);s.tap(9,1000);check(s.count()==451&&s.indexes()[0]==9);
        s.tap(400,1000);s.tap(499,1000);check(s.count()==491); // overlapping ranges add once
        s.setRangeMode(false);s.tap(10,1000);check(!s.contains(10)&&s.count()==490);s.tap(10,1000);check(s.contains(10));
        s.clear();s.setRangeMode(true);s.tap(7,1000);s.tap(7,1000);check(s.count()==1&&s.anchor()==-1);
        s.clear();s.tap(0,1000);s.tap(999,1000);check(s.count()==1000);
        s.all(100000);check(s.count()==100000);check(s.savedBits().length*8<13000);
        AlbumRangeSelection restored=new AlbumRangeSelection();restored.restore(s.savedBits(),s.anchor(),s.rangeMode,100000);check(restored.count()==100000);
        s.clear();s.tap(12,1000);restored.restore(s.savedBits(),s.anchor(),true,1000);restored.tap(999,1000);check(restored.count()==988);
        int rejected=0;try{s.tap(-1,1000);}catch(IllegalArgumentException e){rejected++;}try{s.tap(1000,1000);}catch(IllegalArgumentException e){rejected++;}
        try{restored.restore(s.savedBits(),12,true,10);}catch(IllegalArgumentException e){rejected++;}check(rejected==3);
        s.all(450);List<String> uris=new ArrayList<>();for(int index:s.indexes())uris.add("content://media/external/images/media/"+(10000-index));
        java.io.File root=Files.createTempDirectory("album-range-metadata-").toFile();
        PhotoBatchStore b=PhotoBatchStore.create(root,"child","cloud-original",200);b.select(uris);
        PhotoBatchStore persisted=PhotoBatchStore.load(root,b.id,"child");check(persisted.items.size()==450&&persisted.limit==450);
        check(persisted.items.get(0).uri.equals(uris.get(0))&&persisted.items.get(449).uri.equals(uris.get(449)));
        check(new HashSet<>(persisted.items.stream().map(i->i.originalId).toList()).size()==450);
        s.clear();check(s.count()==0&&s.anchor()==-1);s.all(0);check(s.count()==0);
        System.out.println("Album range selection: "+checks+" checks passed (pure Java; no native UI/device claims)");
    }
}
