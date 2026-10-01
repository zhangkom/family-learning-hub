package cn.familylearning.study;

import java.util.Arrays;
import java.util.Random;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

/** Desktop tests exercise the SAME geometry and illumination code used on Android. */
public final class PhotoProcessingCoreTest {
    private static int assertions;
    private static void check(boolean ok,String message){assertions++;if(!ok)throw new AssertionError(message);}
    private static void near(double a,double b){check(Math.abs(a-b)<1e-7,"expected "+b+", got "+a);}
    private static void fails(Runnable r){try{r.run();}catch(IllegalArgumentException e){assertions++;return;}throw new AssertionError("expected rejection");}
    public static void main(String[] args) throws Exception {
        double[] q={.12,.08,.87,.17,.94,.92,.04,.83};
        double[] h=PhotoGeometry.rectangleToQuad(q), inv=PhotoGeometry.inverse(h);
        for(int i=0;i<4;i++){double[] p=PhotoGeometry.map(h,PhotoGeometry.FULL[i*2],PhotoGeometry.FULL[i*2+1]);near(p[0],q[i*2]);near(p[1],q[i*2+1]);}
        Random random=new Random(42);
        for(int i=0;i<1000;i++){double x=random.nextDouble(),y=random.nextDouble();double[] p=PhotoGeometry.map(h,x,y),r=PhotoGeometry.map(inv,p[0],p[1]);near(r[0],x);near(r[1],y);}
        double[][] expected={{.2,.3},{.8,.3},{.8,.7},{.2,.7},{.3,.2},{.7,.2},{.7,.8},{.3,.8}};
        for(int o=1;o<=8;o++){
            double[] m=PhotoGeometry.exif(o),p=PhotoGeometry.map(m,.2,.3);near(p[0],expected[o-1][0]);near(p[1],expected[o-1][1]);
            for(int t=0;t<4;t++){
                double[] pipeline=PhotoGeometry.multiply(PhotoGeometry.rotation(t),PhotoGeometry.multiply(inv,m));
                double[] forward=PhotoGeometry.map(pipeline,.4,.6),back=PhotoGeometry.map(PhotoGeometry.inverse(pipeline),forward[0],forward[1]);
                near(back[0],.4);near(back[1],.6);
            }
        }
        check(Arrays.equals(PhotoGeometry.outputSize(PhotoGeometry.FULL,4000,3000,2000,0),new int[]{2000,1500}),"landscape scale");
        check(Arrays.equals(PhotoGeometry.outputSize(PhotoGeometry.FULL,4000,3000,2000,1),new int[]{1500,2000}),"rotated scale");
        check(Arrays.equals(PhotoGeometry.outputSize(PhotoGeometry.FULL,200,100,3072,0),new int[]{200,100}),"no upscaling");
        fails(()->PhotoGeometry.validateQuad(new double[]{0,0,1,1,1,0,0,1}));
        fails(()->PhotoGeometry.validateQuad(new double[]{0,0,1,0,Double.NaN,1,0,1}));
        fails(()->PhotoGeometry.validateQuad(new double[]{0,0,1,0,1,0,0,1}));
        fails(()->PhotoGeometry.validateQuad(new double[]{0,0,.01,0,.01,.01,0,.01}));
        fails(()->PhotoGeometry.outputSize(PhotoGeometry.FULL,200,100,10000,0));
        fails(()->PhotoGeometry.exif(9));

        int w=512,height=384;int[] pixels=new int[w*height];
        for(int y=0;y<height;y++)for(int x=0;x<w;x++){
            int paper=x<w/2?180:240;
            int c=0xff000000|paper<<16|paper<<8|paper;
            // Repeated one-pixel strokes, dots and a red annotation remain distinct from the page.
            if(y%32==15&&x%24>=8&&x%24<=16)c=0xff000000;
            if(y%32==16&&x%24==19)c=0xff333333;
            if(y>160&&y<165&&x>80&&x<120)c=0xffa02030;
            pixels[y*w+x]=c;
        }
        PhotoLight.Analysis a=PhotoLight.analyze(pixels,w,height);
        int[] enhanced=new int[pixels.length];
        for(int y=0;y<height;y++)for(int x=0;x<w;x++){
            double gain=a.gain((x+.5)/w,(y+.5)/height);check(gain>=1&&gain<=1.18,"gain bound");
            int i=y*w+x;enhanced[i]=PhotoLight.brighten(pixels[i],gain);
            if(pixels[i]==0xff000000)check(enhanced[i]==pixels[i],"black thin stroke unchanged");
            check(PhotoLight.luminance(enhanced[i])>=PhotoLight.luminance(pixels[i]),"never darken");
        }
        int gapBefore=PhotoLight.luminance(pixels[400])-PhotoLight.luminance(pixels[100]);
        int gapAfter=PhotoLight.luminance(enhanced[400])-PhotoLight.luminance(enhanced[100]);
        check(gapAfter<gapBefore,"synthetic shadow difference reduced");
        check(PhotoLight.brighten(0xffffffff,1.18)==0xffffffff,"white unchanged");
        check(PhotoLight.brighten(0xff000000,1.18)==0xff000000,"black unchanged");
        if(args.length==1){
            File dest=new File(args[0]);if(!dest.isDirectory()&&!dest.mkdirs())throw new Exception("QA directory missing");
            BufferedImage before=new BufferedImage(w,height,BufferedImage.TYPE_INT_RGB),after=new BufferedImage(w,height,BufferedImage.TYPE_INT_RGB);
            before.setRGB(0,0,w,height,pixels,0,w);after.setRGB(0,0,w,height,enhanced,0,w);
            ImageIO.write(before,"png",new File(dest,"synthetic-before.png"));ImageIO.write(after,"png",new File(dest,"synthetic-after.png"));
        }
        System.out.println("PASS: "+assertions+" assertions; perspective round trips, 8 EXIF orientations, rotations, invalid crops and synthetic stroke retention. Shadow luminance gap "+gapBefore+" -> "+gapAfter+". No Android runtime/device measurement.");
    }
}
