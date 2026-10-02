package cn.familylearning.study;

import java.util.*;

/** Pure selection/name tests; does not exercise Android system folder picker or dialog. */
public final class PhotoSelectionTest {
    private static int checks=0;
    private static void check(boolean condition,String name){if(!condition)throw new AssertionError(name);checks++;}
    private static void rejects(Runnable action){try{action.run();}catch(IllegalArgumentException expected){checks++;return;}throw new AssertionError("expected rejection");}
    public static void main(String[] args) {
        String name=".IMG_20261002 数学作业 001.JPG";
        check(PhotoSelection.name(name).equals(name),"original filename case, spaces, Unicode and leading dot");
        check(PhotoSelection.name("path/photo\n.jpg").equals("path-photo.jpg"),"untrusted path/control characters");
        check(PhotoSelection.name(null).isEmpty(),"unknown name stays unknown");
        String longName=".IMG_"+"x".repeat(150)+".JPG";
        check(CloudOriginalDownload.safeName(longName,"image/jpeg").equals(longName),"Android download retains a legal long filename and extension case");
        List<PhotoSelection.Entry> input=new ArrayList<>();
        for(int i=450;i>=1;i--)input.add(new PhotoSelection.Entry("content://test/"+i,String.format(Locale.ROOT,"IMG_%04d.JPG",i)));
        List<PhotoSelection.Entry> sorted=PhotoSelection.sorted(input);
        check(sorted.get(0).name.equals("IMG_0001.JPG")&&sorted.get(449).name.equals("IMG_0450.JPG"),"frozen filename order");
        List<String> all=PhotoSelection.range(sorted,0,449);check(all.size()==450,"all photos without 100/200 cap");
        List<String> middle=PhotoSelection.range(sorted,49,399);
        check(middle.size()==351&&middle.get(0).endsWith("/50")&&middle.get(350).endsWith("/400"),"both endpoints included");
        check(PhotoSelection.range(sorted,199,199).size()==1,"single-photo range");
        rejects(()->PhotoSelection.range(sorted,5,4));rejects(()->PhotoSelection.range(sorted,-1,5));rejects(()->PhotoSelection.range(sorted,0,450));
        List<PhotoSelection.Entry> duplicate=PhotoSelection.sorted(List.of(new PhotoSelection.Entry("content://test/a","same.jpg"),new PhotoSelection.Entry("content://test/b","same.jpg"),new PhotoSelection.Entry("content://test/a","same.jpg")));
        check(duplicate.size()==2,"same names are distinct photos; duplicate URI only deduped");
        rejects(()->PhotoSelection.sorted(List.of(new PhotoSelection.Entry("file:///outside","x.jpg"))));
        System.out.println("PASS "+checks+" filename and range checks; Android picker/dialog not exercised.");
    }
}
