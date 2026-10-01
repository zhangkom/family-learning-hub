package cn.familylearning.study;

/** Conservative illumination correction; no thresholding, inpainting or sharpening. */
public final class PhotoLight {
    private PhotoLight() {}
    public static int luminance(int c) { return (77*((c>>16)&255)+150*((c>>8)&255)+29*(c&255))>>8; }
    public static final class Analysis {
        public final int columns, rows, percentile10, percentile90;
        public final double[] background;
        public final double laplacianVariance, darkFraction, backgroundRange;
        Analysis(int columns,int rows,int low,int high,double[] background,double sharp,double dark,double range) {
            this.columns=columns; this.rows=rows; percentile10=low; percentile90=high;
            this.background=background; laplacianVariance=sharp; darkFraction=dark; backgroundRange=range;
        }
        public double gain(double x,double y) {
            double gx=Math.max(0,Math.min(columns-1,x*columns-.5)), gy=Math.max(0,Math.min(rows-1,y*rows-.5));
            int ix=(int)gx, iy=(int)gy, nx=Math.min(ix+1,columns-1), ny=Math.min(iy+1,rows-1);
            double tx=gx-ix, ty=gy-iy;
            double local=(background[iy*columns+ix]*(1-tx)+background[iy*columns+nx]*tx)*(1-ty)
                +(background[ny*columns+ix]*(1-tx)+background[ny*columns+nx]*tx)*ty;
            // Never darken or boost more than 18%; retain dark strokes and RGB ratios.
            return Math.max(1,Math.min(1.18, Math.min(245,percentile90)/Math.max(1,local)));
        }
    }
    public static Analysis analyze(int[] pixels,int width,int height) {
        if(width<1||height<1||pixels.length!=width*height) throw new IllegalArgumentException("图片像素无效");
        int cols=Math.max(1,(width+31)/32), rows=Math.max(1,(height+31)/32);
        int[][] hist=new int[cols*rows][256]; int[] total=new int[256], counts=new int[cols*rows];
        long dark=0,n=0; double sum=0,sq=0;
        for(int y=0;y<height;y++) for(int x=0;x<width;x++) {
            int v=luminance(pixels[y*width+x]), tile=(y/32)*cols+x/32;
            hist[tile][v]++;counts[tile]++;total[v]++;if(v<50) dark++;
            if(x>0&&y>0&&x+1<width&&y+1<height) {
                double lap=4*v-luminance(pixels[y*width+x-1])-luminance(pixels[y*width+x+1])
                    -luminance(pixels[(y-1)*width+x])-luminance(pixels[(y+1)*width+x]);
                sum+=lap;sq+=lap*lap;n++;
            }
        }
        double[] bg=new double[cols*rows], smooth=new double[cols*rows];
        for(int i=0;i<bg.length;i++) bg[i]=percentile(hist[i],counts[i],.9);
        double lo=255, hi=0;
        for(int y=0;y<rows;y++) for(int x=0;x<cols;x++) {
            double acc=0,weight=0;
            for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++) {
                int nx=Math.max(0,Math.min(cols-1,x+dx)),ny=Math.max(0,Math.min(rows-1,y+dy));
                int w=(dx==0?2:1)*(dy==0?2:1);acc+=bg[ny*cols+nx]*w;weight+=w;
            }
            double v=acc/weight;smooth[y*cols+x]=v;lo=Math.min(lo,v);hi=Math.max(hi,v);
        }
        return new Analysis(cols,rows,percentile(total,pixels.length,.1),percentile(total,pixels.length,.9),smooth,
            n==0?0:Math.max(0,sq/n-(sum/n)*(sum/n)),(double)dark/pixels.length,hi-lo);
    }
    private static int percentile(int[] hist,int n,double p) {
        int target=Math.max(1,(int)Math.ceil(n*p)),sum=0;
        for(int i=0;i<256;i++){sum+=hist[i];if(sum>=target)return i;}return 255;
    }
    public static int brighten(int argb,double gain) {
        int r=(argb>>16)&255,g=(argb>>8)&255,b=argb&255;
        double safe=Math.min(Math.max(1,gain), Math.max(1,250.0/Math.max(1,Math.max(r,Math.max(g,b)))));
        return (argb&0xff000000)|((int)Math.round(r*safe)<<16)|((int)Math.round(g*safe)<<8)|(int)Math.round(b*safe);
    }
}
