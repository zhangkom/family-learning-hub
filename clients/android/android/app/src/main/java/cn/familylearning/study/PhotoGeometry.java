package cn.familylearning.study;

/** Pure geometry. Coordinates describe image edges, not pixel centres. */
public final class PhotoGeometry {
    private PhotoGeometry() {}
    public static final double[] FULL = {0, 0, 1, 0, 1, 1, 0, 1};

    public static void validateQuad(double[] q) {
        if (q == null || q.length != 8) throw new IllegalArgumentException("需要四个边角");
        for (double v : q) if (!Double.isFinite(v) || v < 0 || v > 1)
            throw new IllegalArgumentException("边角超出图片范围");
        double area = 0;
        for (int i = 0; i < 4; i++) {
            int a = i * 2, b = ((i + 1) % 4) * 2, c = ((i + 2) % 4) * 2;
            double cross = (q[b] - q[a]) * (q[c + 1] - q[b + 1]) - (q[b + 1] - q[a + 1]) * (q[c] - q[b]);
            if (cross <= 1e-5 || Math.hypot(q[b] - q[a], q[b + 1] - q[a + 1]) < .005)
                throw new IllegalArgumentException("请按左上、右上、右下、左下选取不交叉的四角");
            area += q[a] * q[b + 1] - q[b] * q[a + 1];
        }
        if (area / 2 < .005) throw new IllegalArgumentException("选取范围太小");
    }

    /** Unit rectangle -> quadrilateral, row-major projective matrix. */
    public static double[] rectangleToQuad(double[] q) {
        validateQuad(q);
        double[][] a = new double[8][9];
        for (int i = 0; i < 4; i++) {
            double x = FULL[2*i], y = FULL[2*i+1], u = q[2*i], v = q[2*i+1];
            a[2*i] = new double[]{x,y,1,0,0,0,-u*x,-u*y,u};
            a[2*i+1] = new double[]{0,0,0,x,y,1,-v*x,-v*y,v};
        }
        for (int col = 0; col < 8; col++) {
            int pivot = col;
            for (int r = col+1; r < 8; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
            if (Math.abs(a[pivot][col]) < 1e-10) throw new IllegalArgumentException("选框无法校正");
            double[] swap = a[col]; a[col] = a[pivot]; a[pivot] = swap;
            double scale = a[col][col];
            for (int k = col; k < 9; k++) a[col][k] /= scale;
            for (int r = 0; r < 8; r++) if (r != col) {
                double f = a[r][col];
                for (int k = col; k < 9; k++) a[r][k] -= f * a[col][k];
            }
        }
        double[] h = new double[9]; h[8] = 1;
        for (int i=0; i<8; i++) h[i] = a[i][8];
        return h;
    }

    public static double[] multiply(double[] a, double[] b) {
        double[] r = new double[9];
        for (int y=0; y<3; y++) for (int x=0; x<3; x++)
            for (int k=0; k<3; k++) r[y*3+x] += a[y*3+k]*b[k*3+x];
        return r;
    }
    public static double[] inverse(double[] m) {
        double a=m[0], b=m[1], c=m[2], d=m[3], e=m[4], f=m[5], g=m[6], h=m[7], i=m[8];
        double det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
        if (!Double.isFinite(det) || Math.abs(det)<1e-12) throw new IllegalArgumentException("无效变换");
        double[] r={e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d};
        for(int k=0;k<9;k++) r[k]/=det;
        return r;
    }
    public static double[] map(double[] h, double x, double y) {
        double z=h[6]*x+h[7]*y+h[8];
        if (!Double.isFinite(z) || Math.abs(z)<1e-10) throw new IllegalArgumentException("坐标无法映射");
        return new double[]{(h[0]*x+h[1]*y+h[2])/z,(h[3]*x+h[4]*y+h[5])/z};
    }
    public static double[] scale(double x, double y) { return new double[]{x,0,0,0,y,0,0,0,1}; }
    public static double[] rotation(int turns) {
        switch(turns) {
            case 0: return scale(1,1);
            case 1: return new double[]{0,-1,1,1,0,0,0,0,1};
            case 2: return new double[]{-1,0,1,0,-1,1,0,0,1};
            case 3: return new double[]{0,1,0,-1,0,1,0,0,1};
            default: throw new IllegalArgumentException("旋转次数无效");
        }
    }
    public static double[] exif(int orientation) {
        switch(orientation) {
            case 1: return scale(1,1);
            case 2: return new double[]{-1,0,1,0,1,0,0,0,1};
            case 3: return rotation(2);
            case 4: return new double[]{1,0,0,0,-1,1,0,0,1};
            case 5: return new double[]{0,1,0,1,0,0,0,0,1};
            case 6: return rotation(1);
            case 7: return new double[]{0,-1,1,-1,0,1,0,0,1};
            case 8: return rotation(3);
            default: throw new IllegalArgumentException("照片方向无效");
        }
    }
    public static int[] outputSize(double[] q, int uprightWidth, int uprightHeight, int maxEdge, int turns) {
        validateQuad(q); rotation(turns);
        if (uprightWidth<1 || uprightHeight<1 || maxEdge<256 || maxEdge>4096)
            throw new IllegalArgumentException("图片尺寸无效");
        double w=(distance(q,0,2,uprightWidth,uprightHeight)+distance(q,6,4,uprightWidth,uprightHeight))/2;
        double h=(distance(q,0,6,uprightWidth,uprightHeight)+distance(q,2,4,uprightWidth,uprightHeight))/2;
        double s=Math.min(1, Math.min(maxEdge/Math.max(w,h),Math.sqrt(8000000/(w*h))));
        int ow=Math.max(1,(int)Math.round(w*s)), oh=Math.max(1,(int)Math.round(h*s));
        return turns%2==0 ? new int[]{ow,oh} : new int[]{oh,ow};
    }
    private static double distance(double[] q,int a,int b,int w,int h) {
        return Math.hypot((q[a]-q[b])*w,(q[a+1]-q[b+1])*h);
    }
}
